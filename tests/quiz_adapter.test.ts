// tests/quiz_adapter.test.ts
// 测验与答题模块单元测试套件

import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// 1. Browser Environment Polyfill for Node.js Runner
if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = {
    innerWidth: 1920,
    innerHeight: 1080,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  };
}

if (typeof (globalThis as any).localStorage === 'undefined') {
  const storeMap = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => storeMap.get(k) ?? null,
    setItem: (k: string, v: string) => storeMap.set(k, String(v)),
    removeItem: (k: string) => storeMap.delete(k),
    clear: () => storeMap.clear()
  };
}

// 2. Import modules under test
import {
  cleanQuestionTitle,
  normalizeText,
  matchFallbackAnswer,
  detectQuestionType,
  detectQuestionSubType,
  matchOptionToAnswer,
  selectBestOptions,
  isQuestionAnswered,
  extractQuestionImages,
  hasMeaningfulContent
} from '../src/adapters/quiz';
import { parseAiResponse } from '../src/adapters/ai-solver/parser';
import { buildAiPrompt } from '../src/adapters/ai-solver/prompt';
import {
  escapeHtml,
  cleanRichTextAnswer,
  formatToUEditorParagraphs,
  isAiRefusalOrApology
} from '../src/utils/text-sanitizer';
import {
  fetchRemoteModels,
  detectModelReasoningCapability,
  getModelSupportedReasoningEfforts,
  queryAiAnswer
} from '../src/adapters/ai-solver/client';
import { store } from '../src/store';
import { isFinishedTask, isInternalChildOfTask } from '../src/core/iframe';
import {
  decryptString,
  base64ToUint8Array,
  decryptDomElement,
  clearChaoxingFontMap
} from '../src/adapters/font-decoder';

describe('Quiz Adapter 单元测试', () => {

  describe('【第 1 关】AI 响应解析器 (parseAiResponse) 鲁棒性测试', () => {
    it('1.1 应该正确解析标准 JSON 字符串数组', () => {
      const input = '["A", "B", "C"]';
      const result = parseAiResponse(input);
      assert.deepEqual(result, ['A', 'B', 'C']);
    });

    it('1.2 应该解析被 ```json Markdown 代码块包裹的内容', () => {
      const input = '```json\n["温迪", "钟离"]\n```';
      const result = parseAiResponse(input);
      assert.deepEqual(result, ['温迪', '钟离']);
    });

    it('1.3 应该解析被无语言标识 ``` 包裹的内容', () => {
      const input = '```\n["7种"]\n```';
      const result = parseAiResponse(input);
      assert.deepEqual(result, ['7种']);
    });

    it('1.4 应该在存在前置导语和后缀废话时通过正则提取 JSON 数组', () => {
      const input = '你好！根据题目要求，提瓦特的元素答案如下：\n["7种", "七种"]\n希望对你有所帮助！';
      const result = parseAiResponse(input);
      assert.deepEqual(result, ['7种', '七种']);
    });

    it('1.5 应该容错解析单个 JSON 字符串', () => {
      const input = '"吟游诗人温迪"';
      const result = parseAiResponse(input);
      assert.deepEqual(result, ['吟游诗人温迪']);
    });

    it('1.6 应该容错解析纯多行文本格式', () => {
      const input = '选项A\n选项B\n选项D';
      const result = parseAiResponse(input);
      assert.deepEqual(result, ['选项A', '选项B', '选项D']);
    });

    it('1.7 应该对空字符串、纯空格和非字符串输入安全返回空数组', () => {
      assert.deepEqual(parseAiResponse(''), []);
      assert.deepEqual(parseAiResponse('   \n  '), []);
      // @ts-ignore
      assert.deepEqual(parseAiResponse(null), []);
      // @ts-ignore
      assert.deepEqual(parseAiResponse(undefined), []);
    });

    it('1.8 应该处理包含特殊字符、转义符号和空格的数组项', () => {
      const input = '["A. \\"北京\\"", " B. 上海 "]';
      const result = parseAiResponse(input);
      assert.deepEqual(result, ['A. "北京"', 'B. 上海']);
    });

    it('1.9 应该成功剥离 <think>...</think> 内部推理链并提取最终 JSON 数组', () => {
      const input = `<think>
用户问的是提瓦特大陆的风神是谁。
根据游戏背景：
A 是钟离（岩神）
B 是雷电将军（雷神）
C 是温迪（风神巴巴托斯）
所以答案应该是 C。
</think>
["C"]`;
      const result = parseAiResponse(input);
      assert.deepEqual(result, ['C']);
    });

    it('1.10 应该在非标准 JSON 下通过智能语义正则抽取答案字母（故选、正确答案是、应选等）', () => {
      const inputSingle = '经过认真分析，本题正确答案是：B。';
      assert.deepEqual(parseAiResponse(inputSingle), ['B']);

      const inputMulti = '综上所述，故选 A、C 两项。';
      assert.deepEqual(parseAiResponse(inputMulti), ['A', 'C']);

      const inputJudge = '根据相关定义，该命题错误。故选：错误';
      assert.deepEqual(parseAiResponse(inputJudge), ['错误']);
    });

    it('1.11 应该在思维链之后抽取非 JSON 格式的语义结论', () => {
      const input = `<think>
这是一道单选题。
解析过程如下...
因此排除 A 和 D。
</think>
综合上述考点，本题应选：B`;
      const result = parseAiResponse(input);
      assert.deepEqual(result, ['B']);
    });
  });

  describe('【第 2 关】题型识别逻辑 (detectQuestionType) 测试', () => {
    it('2.1 识别显式中文标签题型', () => {
      assert.equal(detectQuestionType('【单选题】提瓦特大陆有几个国家？'), 'single');
      assert.equal(detectQuestionType('【多选题】下列属于蒙德城角色的有'), 'multiple');
      assert.equal(detectQuestionType('【判断题】派蒙是最好的应急食品吗？'), 'judge');
      assert.equal(detectQuestionType('【填空题】尘世七执政共有___位。'), 'fill');
      assert.equal(detectQuestionType('【简答题】请阐述岩神摩拉克斯的契约精神。'), 'essay');
      assert.equal(detectQuestionType('【论述题】试论稻妻锁国令的废除过程。'), 'essay');
      assert.equal(detectQuestionType('【名词解释】神之眼'), 'essay');
    });

    it('2.2 识别圆括号与前缀带题号和分值的复杂格式', () => {
      assert.equal(detectQuestionType('1. (多选题) (5.0分) 下列哪些是四星角色'), 'multiple');
      assert.equal(detectQuestionType('12、 (判断题) [10分] 雷电将军擅长做饭'), 'judge');
      assert.equal(detectQuestionType('3. (填空题) 原神开服时间为____'), 'fill');
    });

    it('2.3 识别简写标签格式', () => {
      assert.equal(detectQuestionType('【单选】题目内容'), 'single');
      assert.equal(detectQuestionType('【多选】题目内容'), 'multiple');
      assert.equal(detectQuestionType('【判断】题目内容'), 'judge');
      assert.equal(detectQuestionType('【填空】题目内容'), 'fill');
    });

    it('2.4 DOM 启发式识别：存在 checkbox 复选框时判定为 multiple', () => {
      const detected = detectQuestionType('未标记题型的题目标题', true, 4, '');
      assert.equal(detected, 'multiple');
    });

    it('2.5 DOM 启发式识别：存在 2 个单选框且包含对错文本时判定为 judge', () => {
      const detected = detectQuestionType('未标记题型的题目标题', false, 2, 'A. 正确 B. 错误');
      assert.equal(detected, 'judge');
    });

    it('2.6 兜底默认：无特殊特征时默认判定为 single', () => {
      const detected = detectQuestionType('普通题目标题没有任何特征', false, 4, 'A. 选项1 B. 选项2');
      assert.equal(detected, 'single');
    });
  });

  describe('【第 3 关】题目标题净化规范化 (cleanQuestionTitle) 测试', () => {
    it('3.1 消除中括号与圆括号题型标签', () => {
      assert.equal(cleanQuestionTitle('【单选题】世界树被污染的原因是什么？'), '世界树被污染的原因是什么？');
      assert.equal(cleanQuestionTitle('(多选题) 下列属于元素反应的是'), '下列属于元素反应的是');
    });

    it('3.2 消除序号与前缀点号、顿号', () => {
      assert.equal(cleanQuestionTitle('1. 蒙德城的风神是谁？'), '蒙德城的风神是谁？');
      assert.equal(cleanQuestionTitle('15、 璃月港的统治组织是？'), '璃月港的统治组织是？');
      assert.equal(cleanQuestionTitle('999 提瓦特元素种类？'), '提瓦特元素种类？');
    });

    it('3.3 消除分值标识 (X分) 与 [X分]', () => {
      assert.equal(cleanQuestionTitle('1. 【单选题】(5.0分) 原神主角的名字是'), '原神主角的名字是');
      assert.equal(cleanQuestionTitle('2. [10分] 须弥的教令院有几个学派'), '须弥的教令院有几个学派');
    });

    it('3.4 压缩多余连续空格并去除首尾空白', () => {
      assert.equal(cleanQuestionTitle('   【填空题】   风   神    '), '风 神');
    });
  });

  describe('【第 4 关】文本与选项归一化 (normalizeText) 测试', () => {
    it('4.1 去除开头的选项字母与各种分隔符（英文句号、顿号、冒号、下划线）', () => {
      assert.equal(normalizeText('A. 7种'), '7种');
      assert.equal(normalizeText('B、温迪'), '温迪');
      assert.equal(normalizeText('c: 原神'), '原神');
      assert.equal(normalizeText('D - 钟离'), '钟离');
    });

    it('4.2 过滤标点符号、空格与特殊字符，保留中文、数字与英文字母', () => {
      assert.equal(normalizeText('Hello, World! (世界) 2026'), 'helloworld世界2026');
      assert.equal(normalizeText('【正确答案】: 7 种！'), '正确答案7种');
    });

    it('4.3 将英文字符统一转为小写', () => {
      assert.equal(normalizeText('GENSHIN IMPACT'), 'genshinimpact');
    });
  });

  describe('【第 5 关】保底答题匹配算法 (matchFallbackAnswer) 验收', () => {
    it('5.1 《原神学》测试课程：提瓦特元素种类题目应命中 7 种', () => {
      const answers = matchFallbackAnswer('请问提瓦特大陆一共有几种元素力？', ['3种', '5种', '7种', '9种']);
      assert.ok(answers.length > 0);
      assert.ok(answers.includes('7种') || answers.includes('7'));
    });

    it('5.2 《原神学》测试课程：蒙德风神/巴巴托斯应命中温迪', () => {
      const answers = matchFallbackAnswer('蒙德城的风神化身是哪位角色？', ['温迪', '琴', '迪卢克']);
      assert.ok(answers.length > 0);
      assert.ok(answers.some(a => a.includes('温迪')));
    });

    it('5.3 《原神学》测试课程：拥有神之眼的人应命中原神', () => {
      const answers = matchFallbackAnswer('在提瓦特大陆，被神认可拥有神之眼的人被称为？', ['原神', '行者', '天理']);
      assert.ok(answers.length > 0);
      assert.ok(answers.includes('原神'));
    });

    it('5.4 未知题目兜底匹配：当传入 options 时返回第 1 个选项防卡死', () => {
      const answers = matchFallbackAnswer('某未知高数积分题目', ['选项A解答', '选项B解答']);
      assert.deepEqual(answers, ['选项A解答']);
    });

    it('5.5 未知题目兜底匹配：当无 options 时安全返回空数组', () => {
      const answers = matchFallbackAnswer('完全未知的题目且无选项', []);
      assert.deepEqual(answers, []);
    });

    it('5.6 基于题目索引的保底匹配（防御字体混淆乱码）', () => {
      // 即使题目内容是混淆乱码，基于索引 1, 2, 3 也精准命中预设满分答案
      const ans1 = matchFallbackAnswer('', [], 1);
      assert.deepEqual(ans1, ['C', '7', '7种']);

      const ans2 = matchFallbackAnswer('', [], 2);
      assert.deepEqual(ans2, ['C', '温迪', '吟游诗人温迪']);

      const ans3 = matchFallbackAnswer('', [], 3);
      assert.deepEqual(ans3, ['B', '原神']);
    });

    it('5.7 《原神学》第 1.1 节真实混淆题目保底匹配验收', () => {
      // 真实 Q1: 嵊嵉故事开端，旅嵈嵍嵋次踏上的嵏瓦嵎大陆国度是？
      const q1 = matchFallbackAnswer('嵊嵉故事开端，旅嵈嵍嵋次踏上的嵏瓦嵎大陆国度是？', ['A. 蒙嵑', 'B. 璃月', 'C. 稻妻', 'D. 须弥'], 1);
      assert.ok(q1.includes('A') || q1.includes('蒙德'));

      // 真实 Q2: 嶸嵗食品“派蒙”最嵋嵚嵙哪个水域嵜旅嵈者钓上来的？
      const q2 = matchFallbackAnswer('嶸嵗食品“派蒙”最嵋嵚嵙哪个水域嵜旅嵈者钓上来的？', ['A. 星落湖', 'B. 果酒湖', 'C. 渌华池', 'D. 荻花洲'], 2);
      assert.ok(q2.includes('A') || q2.includes('星落湖'));

      // 真实 Q3: 蒙德城被嵪称嵩嵭嵨嵫么嵦城嵧？
      const q3 = matchFallbackAnswer('蒙德城被嵪称嵩嵭嵨嵫么嵦城嵧？', ['A. 自由之城', 'B. 契约之城', 'C. 永恒之城', 'D. 智慧之城'], 3);
      assert.ok(q3.includes('A') || q3.includes('自由之城'));
    });
  });

  describe('【第 6 关】选项与答案模糊匹配算法 (matchOptionToAnswer) 极限测试', () => {
    it('6.1 字母直选匹配（大小写容错）', () => {
      const optA = { letter: 'A', cleanText: '7种', rawText: 'A. 7种' };
      const optB = { letter: 'B', cleanText: '温迪', rawText: 'B. 温迪' };

      assert.equal(matchOptionToAnswer(optA, 'A', 'single'), true);
      assert.equal(matchOptionToAnswer(optA, 'a', 'single'), true);
      assert.equal(matchOptionToAnswer(optB, 'b', 'single'), true);
      assert.equal(matchOptionToAnswer(optB, 'A', 'single'), false);
    });

    it('6.2 文本双向包含模糊匹配', () => {
      const opt = { letter: 'C', cleanText: '吟游诗人温迪', rawText: 'C. 吟游诗人温迪' };
      // 答案是部分文本
      assert.equal(matchOptionToAnswer(opt, '温迪', 'single'), true);
      // 答案比选项更详细
      assert.equal(matchOptionToAnswer(opt, '风神吟游诗人温迪阁下', 'single'), true);
    });

    it('6.3 判断题正向断言覆盖（对、正确、true、t、√、是、A）', () => {
      const optTrue1 = { letter: 'A', cleanText: '正确', rawText: 'A. 正确' };
      const optTrue2 = { letter: 'A', cleanText: '对', rawText: 'A. 对' };

      assert.equal(matchOptionToAnswer(optTrue1, '对', 'judge'), true);
      assert.equal(matchOptionToAnswer(optTrue1, '正确', 'judge'), true);
      assert.equal(matchOptionToAnswer(optTrue1, 'true', 'judge'), true);
      assert.equal(matchOptionToAnswer(optTrue1, 'T', 'judge'), true);
      assert.equal(matchOptionToAnswer(optTrue1, '√', 'judge'), true);
      assert.equal(matchOptionToAnswer(optTrue1, '是', 'judge'), true);
      assert.equal(matchOptionToAnswer(optTrue2, '正确', 'judge'), true);
    });

    it('6.4 判断题负向断言覆盖（错、错误、false、f、×、否、B）', () => {
      const optFalse1 = { letter: 'B', cleanText: '错误', rawText: 'B. 错误' };
      const optFalse2 = { letter: 'B', cleanText: '错', rawText: 'B. 错' };

      assert.equal(matchOptionToAnswer(optFalse1, '错', 'judge'), true);
      assert.equal(matchOptionToAnswer(optFalse1, '错误', 'judge'), true);
      assert.equal(matchOptionToAnswer(optFalse1, 'false', 'judge'), true);
      assert.equal(matchOptionToAnswer(optFalse1, 'F', 'judge'), true);
      assert.equal(matchOptionToAnswer(optFalse1, '×', 'judge'), true);
      assert.equal(matchOptionToAnswer(optFalse1, '否', 'judge'), true);
      assert.equal(matchOptionFalse2Match(optFalse2), true);
    });

    function matchOptionFalse2Match(opt: any) {
      return matchOptionToAnswer(opt, '错误', 'judge');
    }

    it('6.5 防误匹配隔离测试：错误答案不应匹配任意无关项', () => {
      const opt = { letter: 'D', cleanText: '岩王帝君', rawText: 'D. 岩王帝君' };
      assert.equal(matchOptionToAnswer(opt, '风神', 'single'), false);
      assert.equal(matchOptionToAnswer(opt, '错', 'single'), false);
    });

    it('6.6 字母优先匹配：输入 "B. 消费者"、"【B】"、"(B)" 应直接命中 letter: "B" 的选项', () => {
      const optB = { letter: 'B', cleanText: '分解者', rawText: 'B. 分解者' };
      assert.equal(matchOptionToAnswer(optB, 'B. 消费者', 'single'), true);
      assert.equal(matchOptionToAnswer(optB, 'B、消费者', 'single'), true);
      assert.equal(matchOptionToAnswer(optB, '【B】', 'single'), true);
      assert.equal(matchOptionToAnswer(optB, '(B)', 'single'), true);
      assert.equal(matchOptionToAnswer(optB, 'B: 消费者', 'single'), true);
      assert.equal(matchOptionToAnswer(optB, 'B', 'single'), true);

      // 非 B 字母不应匹配
      assert.equal(matchOptionToAnswer(optB, 'A. 生产者', 'single'), false);
    });

    it('6.7 判断题兼容字母标号与正负向语义互通', () => {
      const optTrue = { letter: 'A', cleanText: '正确', rawText: 'A. 正确' };
      const optFalse = { letter: 'B', cleanText: '错误', rawText: 'B. 错误' };

      // AI 给出字母标号 "A" 或 "A. 正确" 应能命中选项 A (正确)
      assert.equal(matchOptionToAnswer(optTrue, 'A', 'judge'), true);
      assert.equal(matchOptionToAnswer(optTrue, 'A. 正确', 'judge'), true);
      assert.equal(matchOptionToAnswer(optTrue, '【A】', 'judge'), true);

      // AI 给出字母标号 "B" 应命中选项 B (错误)
      assert.equal(matchOptionToAnswer(optFalse, 'B', 'judge'), true);
      assert.equal(matchOptionToAnswer(optFalse, 'B、错误', 'judge'), true);
    });

    it('6.8 文本归一化匹配：去除前缀字母后能正常比对选项核心文本', () => {
      const opt = { letter: 'C', cleanText: '生态系统中的次级消费者', rawText: 'C. 生态系统中的次级消费者' };
      assert.equal(matchOptionToAnswer(opt, '次级消费者', 'single'), true);
      assert.equal(matchOptionToAnswer(opt, '生态系统中的次级消费者', 'single'), true);
    });
  });

  describe('【第 7 关】构建产物与静态元数据完整性验收', () => {
    it('7.1 验证 dist/Kasa-xuexitong-helper.user.js 构建产物存在且体积正常', () => {
      const distPath = path.resolve(process.cwd(), 'dist/Kasa-xuexitong-helper.user.js');
      assert.ok(fs.existsSync(distPath), 'dist 构建产物文件必须存在');
      const stats = fs.statSync(distPath);
      assert.ok(stats.size > 20 * 1024, `构建产物体积应 > 20KB，当前为 ${Math.round(stats.size / 1024)}KB`);
    });

    it('7.2 验证产物包含油猴脚本元数据头部与核心授权声明', () => {
      const distPath = path.resolve(process.cwd(), 'dist/Kasa-xuexitong-helper.user.js');
      const content = fs.readFileSync(distPath, 'utf-8');
      assert.ok(content.includes('==UserScript=='), '必须包含 UserScript 声明头');
      assert.ok(content.includes('@name'), '必须声明脚本名称');
      assert.ok(content.includes('@match'), '必须声明网址匹配规则');
      assert.ok(content.includes('GM_xmlhttpRequest'), '必须包含 GM_xmlhttpRequest 权限配置');
    });
  });

  describe('【第 8 关】Iframe 边界跨越与内部子任务过滤测试', () => {
    it('8.1 isFinishedTask 能够识别包含 ans-job-finished 的元素', () => {
      const el = {
        className: 'ans-job-finished',
        parentElement: null
      } as any;
      assert.equal(isFinishedTask(el), true);
    });

    it('8.2 isFinishedTask 能够沿着 parentElement 向上追溯完成标记', () => {
      const parent = {
        className: 'ans-job-finished',
        parentElement: null
      } as any;
      const child = {
        className: 'inner-card',
        parentElement: parent
      } as any;
      assert.equal(isFinishedTask(child), true);
    });

    it('8.3 isFinishedTask 能够跨越 window.frameElement 边界追溯外层完成标记', () => {
      const outerJobCard = {
        className: 'ans-job-finished',
        parentElement: null
      } as any;
      const outerIframe = {
        className: 'ans-insertvideo-module',
        parentElement: outerJobCard
      } as any;

      const innerDoc = {
        defaultView: {
          frameElement: outerIframe
        }
      } as any;

      const innerEl = {
        className: 'inner-video',
        parentElement: null,
        ownerDocument: innerDoc
      } as any;

      assert.equal(isFinishedTask(innerEl), true);
    });

    it('8.4 isInternalChildOfTask 识别嵌套在视频任务 iframe 内的子 iframe', () => {
      const parentTaskIframe = {
        className: 'ans-insertvideo-module',
        src: 'https://mooc1.chaoxing.com/ananas/modules/video/index.html',
        parentElement: null
      } as any;

      const subIframe = {
        className: 'ans-attach-online',
        src: 'https://mooc1.chaoxing.com/ananas/modules/video/sub.html',
        ownerDocument: {
          defaultView: {
            frameElement: parentTaskIframe
          }
        },
        parentElement: null
      } as any;

      assert.equal(isInternalChildOfTask(subIframe), true);
    });

    it('8.5 isInternalChildOfTask 对顶层主任务 iframe 判定为 false', () => {
      const rootTaskIframe = {
        className: 'ans-insertvideo-module',
        src: 'https://mooc1.chaoxing.com/ananas/modules/video/index.html',
        ownerDocument: {
          defaultView: {
            frameElement: null
          }
        },
        parentElement: null
      } as any;

      assert.equal(isInternalChildOfTask(rootTaskIframe), false);
    });
  });

  describe('【第 9 关】font-cxsecret 字体解密与字符串还原测试', () => {
    it('9.1 base64ToUint8Array 能够正确转换二进制数组', () => {
      const bytes = base64ToUint8Array('SGVsbG8=');
      assert.equal(bytes.length, 5);
      assert.equal(String.fromCharCode(...bytes), 'Hello');
    });

    it('9.2 decryptString 能够根据映射字典还原混淆字符', () => {
      // 模拟混淆字符映射
      const mockMap: Record<number, string> = {
        [('纂'.charCodeAt(0))]: '下',
        [('裔'.charCodeAt(0))]: '列',
        [('奁'.charCodeAt(0))]: '属',
        [('斐'.charCodeAt(0))]: '易',
        [('蘚'.charCodeAt(0))]: '学',
        [('奚'.charCodeAt(0))]: '品'
      };

      const encrypted = '纂裔一项奁于斐制爆危化蘚奚？';
      const decrypted = decryptString(encrypted, mockMap);
      assert.equal(decrypted, '下列一项属于易制爆危化学品？');
    });

    it('9.3 decryptString 对未混淆字符保持原样不变', () => {
      const normal = '请问提瓦特大陆一共有几种元素力？';
      const result = decryptString(normal, {});
      assert.equal(result, normal);
    });

    it('9.4 题目容器叶子节点去重算法能够过滤外层大包装器并保留所有具体题目', () => {
      // 模拟一个包含 3 道题目的外层容器结构
      class MockElement {
        children: MockElement[] = [];
        className: string;
        constructor(className: string, children: MockElement[] = []) {
          this.className = className;
          this.children = children;
        }
        contains(other: MockElement): boolean {
          if (this === other) return true;
          return this.children.some(c => c.contains(other));
        }
      }

      const q1 = new MockElement('TiMu');
      const q2 = new MockElement('TiMu');
      const q3 = new MockElement('TiMu');
      const wrapper = new MockElement('sectionWrapper', [q1, q2, q3]);

      const candidates = [wrapper, q1, q2, q3];
      // 算法：排除包含其他候选者的大容器，保留叶子节点单题
      const leafNodes = candidates.filter(node => {
        return !candidates.some(other => other !== node && node.contains(other));
      });

      assert.equal(leafNodes.length, 3);
      assert.ok(!leafNodes.includes(wrapper));
      assert.ok(leafNodes.includes(q1));
      assert.ok(leafNodes.includes(q2));
      assert.ok(leafNodes.includes(q3));
    });
  });

  describe('【第 10 关】已作答题目识别逻辑 (isQuestionAnswered) 验收测试', () => {
    it('10.1 识别包含 checked radio 或 checkbox 的已作答题目', () => {
      const mockEl = {
        querySelector: (sel: string) => {
          if (sel.includes(':checked')) return { checked: true };
          return null;
        },
        querySelectorAll: () => []
      } as any;
      assert.equal(isQuestionAnswered(mockEl), true);
    });

    it('10.2 识别 check_answer 类或 aria-checked="true" 的已选状态', () => {
      const selectors = [
        '.check_answer',
        '.check_answer_dx',
        '.num_option.check_answer',
        'li.check_answer',
        'li.check_answer_dx',
        '[aria-checked="true"]',
        '.answerBg.cur'
      ];
      for (const sel of selectors) {
        const mockEl = {
          querySelector: (s: string) => {
            if (s.includes(sel)) return { className: sel.replace(/[.[]/g, '') };
            return null;
          },
          querySelectorAll: () => []
        } as any;
        assert.equal(isQuestionAnswered(mockEl), true, `未能识别选中类: ${sel}`);
      }
    });

    it('10.3 识别填空/简答题中真正有内容的答案文本框 (如 textarea.answerText 或 input.answerInput)', () => {
      const mockEl = {
        querySelector: () => null,
        querySelectorAll: (sel: string) => {
          if (sel.includes('textarea') || sel.includes('input.answerInput')) {
            return [{ value: '已填入答案', type: 'text', name: 'answerContent', id: 'ans1' }];
          }
          return [];
        }
      } as any;
      assert.equal(isQuestionAnswered(mockEl), true);
    });

    it('10.4 严格排除隐藏系统元数据字段 (如 answertype=1、type=hidden、score 等)，坚决返回 false', () => {
      const mockEl = {
        querySelector: () => null,
        querySelectorAll: (sel: string) => {
          return [
            { name: 'answertype123', value: '1', type: 'hidden' },
            { id: 'question_score_123', value: '5', type: 'text' },
            { name: 'timu_type', value: 'single', type: 'text' }
          ];
        }
      } as any;
      assert.equal(isQuestionAnswered(mockEl), false);
    });

    it('10.5 泛化未带类名的系统 input[type="text"] 或空填空框不得误判为已作答', () => {
      const mockEl = {
        querySelector: () => null,
        querySelectorAll: (sel: string) => {
          return [
            { value: '   ', type: 'text', name: 'myAnswer' }
          ];
        }
      } as any;
      assert.equal(isQuestionAnswered(mockEl), false);
    });

    it('10.6 对完全未作答、所有选项呈灰色未选中状态的题目坚决返回 false', () => {
      const mockEl = {
        querySelector: () => null,
        querySelectorAll: () => []
      } as any;
      assert.equal(isQuestionAnswered(mockEl), false);
    });
  });

  describe('【第 11 关】AI 客户端思考强度与模型列表拉取测试', () => {
    it('11.1 fetchRemoteModels 在 baseUrl 为空时安全返回空数组', async () => {
      const result = await fetchRemoteModels('', 'sk-test');
      assert.deepEqual(result, []);
    });

    it('11.2 fetchRemoteModels 支持原生 fetch 降级并正确按字母升序排序与去重', async () => {
      const originalFetch = (globalThis as any).window.fetch;
      try {
        (globalThis as any).window.fetch = async (url: string, opts: any) => {
          assert.ok(url.endsWith('/models'));
          assert.equal(opts.headers.Authorization, 'Bearer sk-mock-key');
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                { id: 'deepseek-chat' },
                { id: 'deepseek-reasoner' },
                { id: 'deepseek-chat' },
                { id: 'gpt-4o' }
              ]
            })
          };
        };

        const models = await fetchRemoteModels('https://api.deepseek.com/v1', 'sk-mock-key');
        assert.deepEqual(models, ['deepseek-chat', 'deepseek-reasoner', 'gpt-4o']);
      } finally {
        (globalThis as any).window.fetch = originalFetch;
      }
    });

    it('11.3 detectModelReasoningCapability 正确识别支持 reasoning_effort 参数的模型 (supported)', () => {
      assert.equal(detectModelReasoningCapability('o1'), 'supported');
      assert.equal(detectModelReasoningCapability('o1-preview'), 'supported');
      assert.equal(detectModelReasoningCapability('o1-mini'), 'supported');
      assert.equal(detectModelReasoningCapability('o3'), 'supported');
      assert.equal(detectModelReasoningCapability('o3-mini'), 'supported');
      assert.equal(detectModelReasoningCapability('gpt-o1'), 'supported');
      assert.equal(
        detectModelReasoningCapability('custom-reasoning-model', {
          supported_parameters: ['reasoning_effort']
        }),
        'supported'
      );
    });

    it('11.4 detectModelReasoningCapability 正确识别内置固定思考模型 (built_in)', () => {
      assert.equal(detectModelReasoningCapability('deepseek-reasoner'), 'built_in');
      assert.equal(detectModelReasoningCapability('deepseek-r1'), 'built_in');
      assert.equal(detectModelReasoningCapability('r1'), 'built_in');
      assert.equal(detectModelReasoningCapability('deepseek/deepseek-r1-distill-qwen-32b'), 'built_in');
      assert.equal(detectModelReasoningCapability('qwq-32b'), 'built_in');
    });

    it('11.5 detectModelReasoningCapability 正确识别普通/不支持模型 (unsupported)', () => {
      assert.equal(detectModelReasoningCapability('deepseek-chat'), 'unsupported');
      assert.equal(detectModelReasoningCapability('gpt-4o'), 'unsupported');
      assert.equal(detectModelReasoningCapability('gpt-4o-mini'), 'unsupported');
      assert.equal(detectModelReasoningCapability('qwen-plus'), 'unsupported');
      assert.equal(detectModelReasoningCapability('claude-3-5-sonnet'), 'unsupported');
      assert.equal(detectModelReasoningCapability('gemini-2.0-flash'), 'unsupported');
      assert.equal(detectModelReasoningCapability(''), 'unsupported');
    });

    it('11.6 fetchRemoteModels 能够将原始元数据全量保留在 store.config.cachedModelItems 中', async () => {
      const originalFetch = (globalThis as any).window.fetch;
      try {
        (globalThis as any).window.fetch = async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: 'custom-o3-turbo',
                name: 'Custom O3 Turbo',
                supported_reasoning_effort: ['low', 'medium', 'high', 'max'],
                supported_parameters: ['reasoning_effort']
              },
              {
                id: 'deepseek-v3',
                name: 'DeepSeek V3'
              }
            ]
          })
        });

        const models = await fetchRemoteModels('https://api.openai.com/v1', 'sk-test');
        assert.deepEqual(models, ['custom-o3-turbo', 'deepseek-v3']);
        assert.ok(Array.isArray(store.config.cachedModelItems));
        const found = store.config.cachedModelItems?.find((m) => m.id === 'custom-o3-turbo');
        assert.ok(found);
        assert.deepEqual(found?.supported_reasoning_effort, ['low', 'medium', 'high', 'max']);
      } finally {
        (globalThis as any).window.fetch = originalFetch;
      }
    });

    it('11.7 getModelSupportedReasoningEfforts 能直接读取并返回上游显式声明的 supported_reasoning_effort 列表（含 none）', () => {
      const mockMeta = [
        {
          id: 'upstream-model-1',
          supported_reasoning_effort: ['low', 'high', 'max']
        },
        {
          id: 'upstream-model-2',
          supported_reasoning_effort: ['none', 'medium', 'max']
        }
      ];

      const efforts1 = getModelSupportedReasoningEfforts('upstream-model-1', mockMeta);
      assert.deepEqual(efforts1, ['none', 'low', 'high', 'max']);

      const efforts2 = getModelSupportedReasoningEfforts('upstream-model-2', mockMeta);
      assert.deepEqual(efforts2, ['none', 'medium', 'max']);
    });

    it('11.8 getModelSupportedReasoningEfforts 在未显式声明时通用提供完整五档思考强度 (含 max)，绝不锁定', () => {
      // 常见模型及自定义模型均应开放全档位选择权
      const expected = ['none', 'low', 'medium', 'high', 'max'];

      assert.deepEqual(getModelSupportedReasoningEfforts('deepseek-chat'), expected);
      assert.deepEqual(getModelSupportedReasoningEfforts('gpt-4o'), expected);
      assert.deepEqual(getModelSupportedReasoningEfforts('o1'), expected);
      assert.deepEqual(getModelSupportedReasoningEfforts('o3-mini'), expected);
      assert.deepEqual(getModelSupportedReasoningEfforts('deepseek-reasoner'), expected);
      assert.deepEqual(getModelSupportedReasoningEfforts('custom-arbitrary-model'), expected);
    });

    it('11.9 getModelSupportedReasoningEfforts 支持大小写不敏感模型匹配与空输入优雅兜底', () => {
      const mockMeta = [
        {
          id: 'DeepSeek-R1-Custom',
          supported_reasoning_effort: ['low', 'max']
        }
      ];

      // 大小写不敏感
      assert.deepEqual(
        getModelSupportedReasoningEfforts('deepseek-r1-custom', mockMeta),
        ['none', 'low', 'max']
      );

      // 空模型名或未识别模型返回通用全档位
      assert.deepEqual(
        getModelSupportedReasoningEfforts(''),
        ['none', 'low', 'medium', 'high', 'max']
      );
    });
  });

  describe('【第 12 关】Prompt 体系重构与推理模型温度自适应测试', () => {
    it('12.1 buildAiPrompt 应该采用友好引导型助教指令，解除思维链压制并支持字母回答', () => {
      const singlePrompt = buildAiPrompt('single', '以下哪个是生态系统中的生产者？', ['草', '羊', '狼']);
      const sysSingle = singlePrompt.find((m) => m.role === 'system')?.content || '';
      assert.ok(sysSingle.includes('字母标号'), '单选题系统提示词应包含字母标号指引');
      assert.ok(!sysSingle.includes('严禁输出任何分析过程'), '坚决移除对抗性压制禁令');
      assert.ok(sysSingle.includes('助教'), '采用高校答题助教角色设定');

      const multiPrompt = buildAiPrompt('multiple', '下列哪些属于可再生能源？', ['太阳能', '煤炭', '风能']);
      const sysMulti = multiPrompt.find((m) => m.role === 'system')?.content || '';
      assert.ok(sysMulti.includes('字母标号数组'), '多选题系统提示词应指示字母标号数组');

      const judgePrompt = buildAiPrompt('judge', '光合作用在叶绿体中进行。', ['对', '错']);
      const sysJudge = judgePrompt.find((m) => m.role === 'system')?.content || '';
      assert.ok(sysJudge.includes('字母标号'), '判断题系统提示词应支持字母标号');
    });

    it('12.2 detectModelReasoningCapability 能够准确识别推理模型与极速模型以适应 0.6 / 0.1 温度', () => {
      // 思考模型 -> built_in 或 supported -> 映射官方推荐 0.6 温度
      assert.equal(detectModelReasoningCapability('deepseek-reasoner'), 'built_in');
      assert.equal(detectModelReasoningCapability('deepseek-r1'), 'built_in');
      assert.equal(detectModelReasoningCapability('QwQ-32B'), 'built_in');
      assert.equal(detectModelReasoningCapability('o1'), 'supported');
      assert.equal(detectModelReasoningCapability('o3-mini'), 'supported');

      // 普通极速模型 -> unsupported -> 映射 0.1 温度
      assert.equal(detectModelReasoningCapability('deepseek-chat'), 'unsupported');
      assert.equal(detectModelReasoningCapability('gpt-4o'), 'unsupported');
    });
  });

  describe('【第 13 关】高精度防错机制与《市场营销学》真实易错题集验收测试', () => {
    it('13.1 严格防范子串包含引发的选项覆盖（如“生产者——中间商——消费者”与“中间商——消费者”）', () => {
      const options = [
        { letter: 'A', rawText: '生产者——中间商——消费者', cleanText: normalizeText('生产者——中间商——消费者') },
        { letter: 'B', rawText: '生产者——消费者', cleanText: normalizeText('生产者——消费者') },
        { letter: 'C', rawText: '中间商——消费者', cleanText: normalizeText('中间商——消费者') },
        { letter: 'D', rawText: '生产者——中间商', cleanText: normalizeText('生产者——中间商') }
      ];

      // 即使 A 项包含 C 项和 D 项的子串，当 AI 给出 C 或 D（无论带字母或纯文本）时，必须精准唯一命中对应项，绝不能误选 A
      assert.equal(matchOptionToAnswer(options[0], 'C. 中间商——消费者', 'single'), false);
      assert.equal(matchOptionToAnswer(options[2], 'C. 中间商——消费者', 'single'), true);

      const bestB = selectBestOptions(options, ['生产者——消费者'], 'single');
      assert.equal(bestB.length, 1);
      assert.equal(bestB[0].letter, 'B');

      const bestC = selectBestOptions(options, ['中间商——消费者'], 'single');
      assert.equal(bestC.length, 1);
      assert.equal(bestC[0].letter, 'C');

      const bestD = selectBestOptions(options, ['生产者——中间商'], 'single');
      assert.equal(bestD.length, 1);
      assert.equal(bestD[0].letter, 'D');
    });

    it('13.2 严格防范短词被长词反包含误选（如“新产品” vs “全新产品”、“营销渠道” vs “市场营销渠道”）', () => {
      const prodOptions = [
        { letter: 'A', rawText: '新产品', cleanText: normalizeText('新产品') },
        { letter: 'B', rawText: '全新产品', cleanText: normalizeText('全新产品') },
        { letter: 'C', rawText: '换代新产品', cleanText: normalizeText('换代新产品') },
        { letter: 'D', rawText: '改进新产品', cleanText: normalizeText('改进新产品') }
      ];

      // 当 AI 返回“全新产品”时，Tier 2 精确相等匹配必须唯一命中 B，绝不能因为“全新产品”.includes(“新产品”) 而误选 A
      const pickedB = selectBestOptions(prodOptions, ['全新产品'], 'single');
      assert.equal(pickedB.length, 1);
      assert.equal(pickedB[0].letter, 'B');

      // 当 AI 返回“新产品”时，必须唯一命中 A，绝不能同时选中 B/C/D 导致单选被 D 覆盖
      const pickedA = selectBestOptions(prodOptions, ['新产品'], 'single');
      assert.equal(pickedA.length, 1);
      assert.equal(pickedA[0].letter, 'A');
    });

    it('13.3 parseAiResponse 在含前置分析、干扰数组、否定排除语境下始终提取最终结论', () => {
      // 场景 1：分析中出现干扰 JSON 数组，末尾给出【最终答案】
      const out1 = `【考点分析】：A项["市场营销渠道"]包含供应商和辅助商；而题干强调取得所有权，对应B项["分销渠道"]。\n【最终答案】：["B"]`;
      assert.deepEqual(parseAiResponse(out1), ['B']);

      // 场景 2：分析中出现“若选 A 则错，不选 C，排除选 D，因此正确答案是：B”
      const out2 = `本题容易误选 A，但骑自行车与坐公交满足同一出行愿望，不选 A，排除选 C 和 D，因此正确答案是：B`;
      assert.deepEqual(parseAiResponse(out2), ['B']);

      // 场景 3：判断题返回 "答案是: false" 绝不能被拆分为 ['F', 'A', 'L', 'S', 'E'] 导致误选 A
      const out3 = `根据教材定义，该命题混淆了直接渠道与间接渠道，答案是: false`;
      const parsed3 = parseAiResponse(out3);
      assert.deepEqual(parsed3, ['false']);
      const judgeOpts = [
        { letter: 'A', rawText: '对', cleanText: '对' },
        { letter: 'B', rawText: '错', cleanText: '错' }
      ];
      const bestJudge = selectBestOptions(judgeOpts, parsed3, 'judge');
      assert.equal(bestJudge.length, 1);
      assert.equal(bestJudge[0].letter, 'B');
    });

    it('13.4 cleanQuestionTitle 保留题干开头的年份与专有数字（如 2024年、4P营销理论）且支持全角括号', () => {
      assert.equal(
        cleanQuestionTitle('1. （单选题） (5.0分) 4P营销理论中最核心的要素是( )。'),
        '4P营销理论中最核心的要素是( )。'
      );
      assert.equal(
        cleanQuestionTitle('12. (判断题) 2024年某企业的市场占有率属于相对市场占有率。'),
        '2024年某企业的市场占有率属于相对市场占有率。'
      );
    });

    it('13.5 queryAiAnswer 在遇到 HTTP 400 参数冲突或空响应时具备自动降级重试能力且支持提取 reasoning_content', async () => {
      const originalFetch = (globalThis as any).window.fetch;
      const oldKey = store.config.aiApiKey;
      const oldEffort = store.config.reasoningEffort;
      try {
        store.config.aiApiKey = 'sk-test-retry-key';
        store.config.reasoningEffort = 'max';
        let callCount = 0;

        (globalThis as any).window.fetch = async (_url: string, opts: any) => {
          callCount++;
          const body = JSON.parse(opts.body);
          if (callCount === 1) {
            // 模拟上游网关对 reasoning_effort="max" 返回 400
            assert.equal(body.reasoning_effort, 'max');
            return {
              ok: false,
              status: 400,
              text: async () => 'Unsupported reasoning_effort: max'
            };
          }
          // 第 2 次自动降级为 'high' 并成功返回
          assert.equal(body.reasoning_effort, 'high');
          return {
            ok: true,
            status: 200,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: '',
                    reasoning_content: '分析完毕，本题最终答案：["B"]'
                  }
                }
              ]
            })
          };
        };

        const ans = await queryAiAnswer(
          {
            id: 'q-13',
            index: 13,
            type: 'single',
            title: '某人从城东去城西上班，选择了骑自行车而放弃了乘坐公共汽车，则自行车生产厂和公共汽车公司之间是( )',
            options: ['愿望竞争者', '属类竞争者', '产品形式竞争者', '品牌竞争者'],
            status: 'searching'
          },
          '测验名称：市场营销学作业二'
        );

        assert.equal(callCount, 2);
        assert.deepEqual(ans, ['B']);
      } finally {
        (globalThis as any).window.fetch = originalFetch;
        store.config.aiApiKey = oldKey;
        store.config.reasoningEffort = oldEffort;
      }
    });
  });

  describe('【第 14 关】配置持久化与一键备份恢复 (Store Persistence & Backup) 验收测试', () => {
    it('14.1 exportConfigString 能够将当前配置正确编码导出', () => {
      const oldKey = store.config.aiApiKey;
      const oldModel = store.config.aiModel;
      try {
        store.config.aiApiKey = 'sk-backup-test-key-12345';
        store.config.aiModel = 'deepseek-reasoner';
        const exported = store.exportConfigString();
        assert.ok(exported && exported.length > 20);
        const decoded = JSON.parse(decodeURIComponent(escape(atob(exported))));
        assert.equal(decoded.aiApiKey, 'sk-backup-test-key-12345');
        assert.equal(decoded.aiModel, 'deepseek-reasoner');
      } finally {
        store.config.aiApiKey = oldKey;
        store.config.aiModel = oldModel;
      }
    });

    it('14.2 importConfigString 能够成功解析配置代码并一键还原设置', () => {
      const payload = {
        aiProvider: 'custom',
        aiApiKey: 'sk-imported-key-67890',
        aiBaseUrl: 'https://api.my-custom-proxy.com/v1',
        aiModel: 'custom-model-v1',
        reasoningEffort: 'medium',
        autoNextChapter: false
      };
      const code = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
      const ok = store.importConfigString(code);
      assert.equal(ok, true);
      assert.equal(store.config.aiProvider, 'custom');
      assert.equal(store.config.aiApiKey, 'sk-imported-key-67890');
      assert.equal(store.config.aiModel, 'custom-model-v1');
      assert.equal(store.config.reasoningEffort, 'medium');
      assert.equal(store.config.autoNextChapter, false);
    });

    it('14.3 importConfigString 对非法字符串容错返回 false 且不崩溃', () => {
      assert.equal(store.importConfigString('not-a-base64'), false);
      assert.equal(store.importConfigString(''), false);
      assert.equal(store.importConfigString('  '), false);
    });

    it('14.4 loadConfig / importConfigString 遇到历史遗留 provider 自动平滑映射为 custom', () => {
      const payload = {
        aiProvider: 'siliconflow',
        aiApiKey: 'sk-legacy-key'
      };
      const code = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
      const ok = store.importConfigString(code);
      assert.equal(ok, true);
      assert.equal(store.config.aiProvider, 'custom');
    });
  });

  describe('【第 15 关】作答题型范围勾选过滤 (enabledQuestionTypes) 测试', () => {
    it('15.1 默认配置下 5 种核心题型均应默认启用 (true)', () => {
      const types = store.config.enabledQuestionTypes;
      assert.ok(types);
      assert.equal(types?.single !== false, true);
      assert.equal(types?.multiple !== false, true);
      assert.equal(types?.judge !== false, true);
      assert.equal(types?.fill !== false, true);
      assert.equal(types?.essay !== false, true);
    });

    it('15.2 当取消勾选某种题型时，能够精准识别为禁用', () => {
      store.updateConfig({
        enabledQuestionTypes: {
          single: true,
          multiple: true,
          judge: true,
          fill: false,
          essay: false
        }
      });
      const types = store.config.enabledQuestionTypes!;
      assert.equal(types.single, true);
      assert.equal(types.multiple, true);
      assert.equal(types.judge, true);
      assert.equal(types.fill, false);
      assert.equal(types.essay, false);

      // 恢复默认全选
      store.updateConfig({
        enabledQuestionTypes: {
          single: true,
          multiple: true,
          judge: true,
          fill: true,
          essay: true
        }
      });
    });
  });

  describe('【第 16 关】答题控制流与开始/暂停状态流转测试', () => {
    it('16.1 初始状态下 isQuizRunning 应为 false', () => {
      assert.equal(store.isQuizRunning, false);
    });

    it('16.2 setQuizRunning 能够正常切换答题运行态', () => {
      let notified = false;
      const unsubscribe = store.subscribe(() => {
        notified = true;
      });

      store.setQuizRunning(true);
      assert.equal(store.isQuizRunning, true);
      assert.equal(notified, true);

      store.setQuizRunning(false);
      assert.equal(store.isQuizRunning, false);
      unsubscribe();
    });

    it('16.3 queryAiAnswer 传入已中止的 AbortSignal 时应立即中断并不发起请求', async () => {
      const oldKey = store.config.aiApiKey;
      const originalFetch = (globalThis as any).window?.fetch;
      let fetchCalled = false;
      try {
        store.config.aiApiKey = 'sk-test-abort';
        (globalThis as any).window.fetch = async () => {
          fetchCalled = true;
          throw new Error('Should not be called');
        };
        const controller = new AbortController();
        controller.abort();

        const res = await queryAiAnswer(
          {
            id: 'q-abort',
            index: 1,
            type: 'single',
            title: '测试中断信号',
            options: ['A', 'B'],
            status: 'searching'
          },
          '',
          controller.signal
        );
        assert.deepEqual(res, []);
        assert.equal(fetchCalled, false);
      } finally {
        (globalThis as any).window.fetch = originalFetch;
        store.config.aiApiKey = oldKey;
      }
    });

    it('16.4 isQuestionAnswered 能够识别 UEditor 富文本编辑器 iframe 已填入内容的状态', () => {
      const mockTimuWithFilledUEditor: any = {
        querySelector: () => null,
        querySelectorAll: (sel: string) => {
          if (sel.includes('ueditor_')) {
            return [
              {
                contentDocument: {
                  body: {
                    textContent: '这是简答题的教材标准答案'
                  }
                }
              }
            ];
          }
          return [];
        }
      };
      assert.equal(isQuestionAnswered(mockTimuWithFilledUEditor), true);
    });
  });

  describe('【第 17 关】富文本净化与 HTML 转义验收测试 (text-sanitizer)', () => {
    it('17.1 escapeHtml 能够转义常见 HTML 特殊字符', () => {
      assert.equal(escapeHtml('<script>alert("xss")&\'test\'</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&amp;&#39;test&#39;&lt;/script&gt;');
      assert.equal(escapeHtml(''), '');
    });

    it('17.2 cleanRichTextAnswer 能够剥离 LaTeX 定界符、还原希腊字母与数学符号', () => {
      const input = '\\(\\alpha + \\beta = \\gamma\\), \\Delta T = 5^\\circ, \\lambda = 600';
      const cleaned = cleanRichTextAnswer(input);
      assert.equal(cleaned, 'α + β = γ, Δ T = 5°, λ = 600');
    });

    it('17.3 cleanRichTextAnswer 能够解包 LaTeX 宏与简化上下标花括号', () => {
      const input = '\\(^{13}\\mathrm{C}\\)-NMR 和 \\mathbf{DNA} 结构与 H_{2}O';
      const cleaned = cleanRichTextAnswer(input);
      assert.equal(cleaned, '13C-NMR 和 DNA 结构与 H2O');
    });

    it('17.4 cleanRichTextAnswer 能够消除 Markdown 格式符与标题', () => {
      const input = '### 核心定义\n**市场细分**是指企业根据*消费者需求*的差异性。\n> 依据马工程教材';
      const cleaned = cleanRichTextAnswer(input);
      assert.equal(cleaned, '核心定义\n市场细分是指企业根据消费者需求的差异性。\n依据马工程教材');
    });

    it('17.5 formatToUEditorParagraphs 能够将数组或换行文本转换为合规的 <p> HTML 标签', () => {
      const input = ['第一自然段：核心概念。', '第二自然段：特征与机理。'];
      const html = formatToUEditorParagraphs(input);
      assert.equal(html, '<p>第一自然段：核心概念。</p><p>第二自然段：特征与机理。</p>');

      const singleInput = '第一行\n\n第二行';
      const htmlSingle = formatToUEditorParagraphs(singleInput);
      assert.equal(htmlSingle, '<p>第一行</p><p>第二行</p>');

      assert.equal(formatToUEditorParagraphs(''), '<p></p>');
    });
  });

  describe('【第 18 关】细分子题型识别与主观题解析增强测试', () => {
    it('18.1 detectQuestionSubType 正确识别名词解释、简答题与论述题', () => {
      assert.equal(detectQuestionSubType('1. (名词解释) (5分) 机会成本'), 'definition');
      assert.equal(detectQuestionSubType('【名词解释】 边际效用'), 'definition');
      assert.equal(detectQuestionSubType('2. （简答题） 简述货币乘数的计算公式'), 'short_answer');
      assert.equal(detectQuestionSubType('【简答】 简述市场营销导向的历史演化'), 'short_answer');
      assert.equal(detectQuestionSubType('3. (论述题) 试论述宏观经济政策的目标协调'), 'discussion');
      assert.equal(detectQuestionSubType('【论述】 试述全球化对发展中国家的影响'), 'discussion');
      assert.equal(detectQuestionSubType('4. (单选题) 以下说法正确的是'), undefined);
    });

    it('18.2 parseAiResponse 针对主观 essay 题型保留完整段落，绝不强行截断为单字母', () => {
      const essayOutput = `机会成本（Opportunity Cost）是指在面临多方案择一决策时，被舍弃的选项中的最高价值。
它是经济学中权衡资源稀缺性与配置效率的核心概念。`;
      const result = parseAiResponse(essayOutput, 'essay');
      assert.equal(result.length, 1);
      assert.ok(result[0].includes('机会成本'));
      assert.ok(result[0].includes('最高价值'));
    });

    it('18.3 parseAiResponse 支持包裹符如 **D**、**A. 氯仿** 与 **A**、**C**', () => {
      assert.deepEqual(parseAiResponse('[答案: **D**, 解析: 此化合物为手性分子]'), ['D']);
      assert.deepEqual(parseAiResponse('经过判断，答案: **A. 氯仿**'), ['A']);
      assert.deepEqual(parseAiResponse('本题正确结论，答案：**A**、**C**'), ['A', 'C']);
      assert.deepEqual(parseAiResponse('根据综合分析，故选 **B**'), ['B']);
    });
  });

  describe('【第 19 关】高校真实考题样本与六大缺陷专项独立回归测试', () => {
    it('19.1 Q23 / Q22 / Q20 真实模型输出样本解析测试', () => {
      // Q23 真实样本解析（中括号+加粗字母+长解析）
      const q23Sample = '[答案: **D**, 解析: 大孔树脂的吸附性主要与范德华力、氢键有关，与分子的极性和氢键结合能力密切相关。由于大孔树脂吸附多属于物理吸附，当洗脱液的洗脱能力大于吸附力时，被吸附物即可被洗脱下来。]';
      assert.deepEqual(parseAiResponse(q23Sample), ['D']);

      // Q22 真实样本解析（加粗字母+选项文本）
      const q22Sample = '[答案: **A. 氯仿**, 氯仿适合提取亲脂性有机酸，极性较小，不易与亲脂性弱酸形成竞争。]';
      assert.deepEqual(parseAiResponse(q22Sample), ['A']);

      // Q20 真实样本解析（含多行与嵌套加粗解析）
      const q20Sample = '[答案: **D**, 解析: 聚酰胺色谱的吸附以**氢键吸附**为主，通常：\n- 形成氢键的数目越多，吸附力越强；\n- 酚羟基处于对位易形成分子间氢键，吸附力强于邻位；\n- 芳香核与共轭双键增多，吸附力相应增强。]';
      assert.deepEqual(parseAiResponse(q20Sample), ['D']);

      // 多选题加粗格式：中括号顿号分隔与无括号逗号分隔
      assert.deepEqual(parseAiResponse('[答案: **A**、**C**]'), ['A', 'C']);
      assert.deepEqual(parseAiResponse('答案: **A**, **C**'), ['A', 'C']);

      // 否定语境干扰测试（排除项不应被误判，精准抓取最终答案）
      const negativeContextSample = '经过分析，本题不选 A，也不选 B，最终答案：**C**';
      assert.deepEqual(parseAiResponse(negativeContextSample), ['C']);
    });

    it('19.2 Q41 LaTeX 与 Markdown 纯文本清洗测试 (text-sanitizer)', () => {
      // 19.2.1 cleanRichTextAnswer 剥离 LaTeX/Markdown 并保留希腊字母、同位素与普通文本
      const q41Sample = 'γ-效应（1,3-效应）：在 \\(^{13}\\mathrm{C}\\)-NMR 中，**化学位移** $\\delta$ 减小。';
      const cleaned = cleanRichTextAnswer(q41Sample);
      assert.equal(cleaned, 'γ-效应（1,3-效应）：在 13C-NMR 中，化学位移 δ 减小。');
      assert.ok(!cleaned.includes('\\('));
      assert.ok(!cleaned.includes('\\mathrm'));
      assert.ok(!cleaned.includes('$'));
      assert.ok(!cleaned.includes('**'));
      assert.ok(cleaned.includes('γ'));
      assert.ok(cleaned.includes('13C-NMR'));
      assert.ok(cleaned.includes('δ'));

      // 19.2.2 formatToUEditorParagraphs XSS 特殊字符转义与多段落封装
      const xssSample = '<script>alert(1)</script>\n第一点：A > B & C';
      const formattedHtml = formatToUEditorParagraphs(xssSample);
      assert.equal(
        formattedHtml,
        '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p><p>第一点：A &gt; B &amp; C</p>'
      );
    });

    it('19.3 Q48 主观简答题多行完整保留与 UEditor 段落转换测试', () => {
      const q48Sample = 'DHA 与 EPA 都属于 ω-3 多不饱和脂肪酸，生理活性侧重不同：\n1. DHA：促进大脑神经发育与视网膜光敏色素形成，改善记忆。\n2. EPA：具有显著降低血清三酰甘油、抗血小板聚集与抗炎作用。';
      
      // parseAiResponse 主观题不截断多行，保留完整文本
      const parsed = parseAiResponse(q48Sample, 'essay');
      assert.equal(parsed.length, 1);
      assert.ok(parsed[0].includes('DHA 与 EPA 都属于 ω-3 多不饱和脂肪酸'));
      assert.ok(parsed[0].includes('1. DHA：'));
      assert.ok(parsed[0].includes('2. EPA：'));

      // formatToUEditorParagraphs 确保完整转换为 3 个段落，绝不截断丢弃后续行
      const html = formatToUEditorParagraphs(parsed);
      const matchP = html.match(/<p>[\s\S]*?<\/p>/g);
      assert.ok(matchP !== null);
      assert.equal(matchP.length, 3);
      assert.ok(html.includes('&omega;-3') || html.includes('ω-3'));
      assert.ok(html.includes('促进大脑神经发育'));
      assert.ok(html.includes('抗血小板聚集'));
    });

    it('19.4 名词解释子题型识别与 Prompt 规范测试', () => {
      // 子题型精准识别
      const subType = detectQuestionSubType('41. (名词解释) γ-效应(1,3-效应)');
      assert.equal(subType, 'definition');

      // Prompt 构造无历史硬编码干扰、无选择题格式
      const messages = buildAiPrompt(
        'essay',
        'γ-效应(1,3-效应)',
        [],
        '天然药物化学',
        undefined,
        subType
      );
      assert.equal(messages.length, 2);

      const sysText = typeof messages[0].content === 'string' ? messages[0].content : '';
      const userText = typeof messages[1].content === 'string' ? messages[1].content : '';

      // 绝不包含市场营销硬编码
      assert.ok(!sysText.includes('分销渠道'));
      assert.ok(!sysText.includes('愿望竞争者'));
      assert.ok(!userText.includes('分销渠道'));
      assert.ok(!userText.includes('愿望竞争者'));

      // 绝不要求选择题 JSON 格式
      assert.ok(!sysText.includes('["B"]'));
      assert.ok(!userText.includes('["B"]'));

      // 明确包含教材名词解释定义规范与纯文本禁用 Markdown/LaTeX 指导
      assert.ok(sysText.includes('名词解释'));
      assert.ok(sysText.includes('教材'));
      assert.ok(sysText.includes('严禁使用 Markdown'));
      assert.ok(sysText.includes('LaTeX'));
      assert.ok(userText.includes('纯文本标准答案正文'));
    });

    it('19.5 Q50 多模态图片 Prompt 构造与思考模型能力适配测试', () => {
      // 多模态图片 Prompt 结构验证
      const imagePayload = ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='];
      const messages = buildAiPrompt('essay', '请根据图示写出该化合物的化学名称及所属结构类型', [], undefined, imagePayload);

      assert.equal(messages.length, 2);
      const userContent = messages[1].content;
      assert.ok(Array.isArray(userContent));
      assert.equal(userContent.length, 2);
      assert.equal(userContent[0].type, 'text');
      assert.ok(userContent[0].text.includes('请根据图示写出该化合物的化学名称'));
      assert.equal(userContent[1].type, 'image_url');
      assert.equal(userContent[1].image_url?.url, imagePayload[0]);

      // 推理能力探测验证
      assert.equal(detectModelReasoningCapability('deepseek-flash'), 'supported');
      assert.equal(detectModelReasoningCapability('deepseek-v4-pro'), 'supported');
      assert.equal(detectModelReasoningCapability('deepseek-chat'), 'unsupported');
      assert.equal(detectModelReasoningCapability('deepseek-reasoner'), 'built_in');
    });
  });

  describe('【第 20 关】风控审计致命缺陷与中度缺陷专项回归测试', () => {
    it('20.1 isAiRefusalOrApology 免责与无解文本高精度拦截测试', () => {
      // 各种免责/抱歉/缺少关键图片或结构式的模型输出必须被精准识别
      assert.equal(isAiRefusalOrApology('抱歉，本题缺少关键化学反应式图片，无法做出解答'), true);
      assert.equal(isAiRefusalOrApology('题目中没有给出图谱和结构式，无法唯一确定答案'), true);
      assert.equal(isAiRefusalOrApology('缺少选项对应图片，请提供选项图片以供分析'), true);
      assert.equal(isAiRefusalOrApology('由于没有提供结构式，无法回答该问题'), true);
      assert.equal(isAiRefusalOrApology('没有给出选项数据，无法解答'), true);

      // 正常主观题答案绝不应被误判为拒答
      assert.equal(isAiRefusalOrApology('本化合物结构式为 C6H12O6，属于单糖，具有较强还原性。'), false);
      assert.equal(isAiRefusalOrApology('市场细分是指企业根据消费者需求的差异性将市场进行细分。'), false);
      assert.equal(isAiRefusalOrApology('A. 氯仿提取亲脂性有机酸，极性较低。'), false);
      assert.equal(isAiRefusalOrApology(''), false);
      // @ts-ignore
      assert.equal(isAiRefusalOrApology(null), false);
    });

    it('20.2 parseAiResponse 汉字单词边界与科学术语单选/多选防御测试', () => {
      // 场景 1：含有科学术语后缀（B族维生素、A型肉毒毒素、D-构型、C环）绝不能被误判为多选项
      assert.deepEqual(parseAiResponse('答案: **A. 含有 B 族维生素**', 'single'), ['A']);
      assert.deepEqual(parseAiResponse('答案: A. 含有 B 族维生素'), ['A']);
      assert.deepEqual(parseAiResponse('经过分析，答案是: A. 本品含有A型肉毒毒素'), ['A']);
      assert.deepEqual(parseAiResponse('最终结论: D. 属于D-构型分子'), ['D']);
      assert.deepEqual(parseAiResponse('本题选择 A. 肽链与C环结构'), ['A']);

      // 场景 2：单选题传入时，即使 AI 给出多选混淆，也保底提取唯一首项
      assert.deepEqual(parseAiResponse('答案是 A、B', 'single'), ['A']);
      assert.deepEqual(parseAiResponse('["A", "B"]', 'single'), ['A']);

      // 场景 3：真实多选题格式正常提取
      assert.deepEqual(parseAiResponse('答案: **A**、**C**', 'multiple'), ['A', 'C']);
      assert.deepEqual(parseAiResponse('答案: A, C', 'multiple'), ['A', 'C']);
    });

    it('20.3 cleanRichTextAnswer 嵌套花括号解包、金融美元符号与算术乘号保护测试', () => {
      // 1. 嵌套花括号多轮安全解包：\mathrm{H_{2}O} -> H2O
      assert.equal(cleanRichTextAnswer('\\mathrm{H_{2}O}'), 'H2O');
      assert.equal(cleanRichTextAnswer('\\mathrm{Fe_{2}O_{3}} 沉淀'), 'Fe2O3 沉淀');

      // 2. 金融题中的单 $ 必须完整保留，不得无差别删除
      const financeText = '商品单价为 $100 每件，预计亏损 $50';
      assert.equal(cleanRichTextAnswer(financeText), '商品单价为 $100 每件，预计亏损 $50');

      // 3. 成对公式定界符仍能正常解包
      const formulaText = '在化学位移 $\\delta$ 处存在特征峰';
      assert.equal(cleanRichTextAnswer(formulaText), '在化学位移 δ 处存在特征峰');

      // 4. 算术乘号 2 * 3 = 6 绝不被误判为 Markdown 斜体
      const mathText = '计算过程：2 * 3 = 6 且 4 * 5 = 20';
      assert.equal(cleanRichTextAnswer(mathText), '计算过程：2 * 3 = 6 且 4 * 5 = 20');
    });

    it('20.4 extractQuestionImages 小图标与透明占位符过滤穿透防御', async () => {
      // 模拟 DOM 题目容器
      const fakeTimu = {
        querySelectorAll: (selector: string) => {
          if (selector === 'img') {
            return [
              // 1x1 透明 gif 占位符（应该被过滤）
              {
                src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
                className: '',
                getAttribute: () => null,
                style: {},
                complete: true,
                naturalWidth: 1,
                naturalHeight: 1
              },
              // 导航图标或按钮图标（应该被过滤）
              {
                src: 'https://example.com/assets/icon_arrow.png',
                className: 'arrow-icon btn-icon',
                getAttribute: () => null,
                style: {},
                complete: true,
                naturalWidth: 16,
                naturalHeight: 16
              },
              // width=16 的小图标（应该被过滤）
              {
                src: 'https://example.com/assets/badge.png',
                className: 'badge',
                getAttribute: (k: string) => (k === 'width' ? '16' : k === 'height' ? '16' : null),
                style: {},
                complete: false,
                naturalWidth: 0,
                naturalHeight: 0
              },
              // 真实题干图片（合规图片，长度超过 200 的合规 data URL）
              {
                src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==valid-long-image-data-string-with-extra-padding-to-exceed-two-hundred-characters-threshold-for-defense-testing',
                className: 'formula-img',
                getAttribute: () => null,
                style: { width: '300px', height: '200px' },
                complete: true,
                naturalWidth: 300,
                naturalHeight: 200
              }
            ];
          }
          return [];
        }
      } as any;

      const imgs = await extractQuestionImages(fakeTimu);
      assert.equal(imgs.length, 1);
      assert.ok(imgs[0].includes('valid-long-image-data-string'));
    });
  });

  describe('【第 21 关】v1.2.0 高优先级修复与高校主观题专项回归测试', () => {
    it('21.1 hasMeaningfulContent 彻底过滤富文本空标签、HTML 空白实体与零宽字符', () => {
      // 各种空值/伪空白
      assert.equal(hasMeaningfulContent(''), false);
      assert.equal(hasMeaningfulContent('   '), false);
      assert.equal(hasMeaningfulContent('\n\t  \r'), false);
      assert.equal(hasMeaningfulContent('<p><br></p>'), false);
      assert.equal(hasMeaningfulContent('<p><br/></p>'), false);
      assert.equal(hasMeaningfulContent('<div><p></p></div>'), false);
      assert.equal(hasMeaningfulContent('<p>&nbsp;</p>'), false);
      assert.equal(hasMeaningfulContent('<p>&nbsp;&nbsp;&nbsp;</p>'), false);
      assert.equal(hasMeaningfulContent('<p>&#160;</p>'), false);
      assert.equal(hasMeaningfulContent('<p>&zwnj;&zwj;&#8203;</p>'), false);
      assert.equal(hasMeaningfulContent('\u200B\u200C\u200D\uFEFF'), false);
      assert.equal(hasMeaningfulContent('<p>\u200B</p>'), false);
      // @ts-ignore
      assert.equal(hasMeaningfulContent(null), false);
      // @ts-ignore
      assert.equal(hasMeaningfulContent(undefined), false);

      // 实质性内容
      assert.equal(hasMeaningfulContent('这是有效作答'), true);
      assert.equal(hasMeaningfulContent('<p>这是有效作答</p>'), true);
      assert.equal(hasMeaningfulContent('<p>含硫氨基酸具有重要生理作用</p>'), true);
    });

    it('21.2 isQuestionAnswered 消除 UEditor 富文本空白占位符假阳性误判', () => {
      // 模拟 42 题仅有 <p><br></p> 的空富文本 iframe
      const emptyIframeTimu = {
        querySelector: () => null,
        querySelectorAll: (selector: string) => {
          if (selector.includes('iframe')) {
            return [
              {
                contentDocument: {
                  body: {
                    innerHTML: '<p><br></p>',
                    textContent: ''
                  }
                }
              }
            ];
          }
          return [];
        }
      } as any;
      assert.equal(isQuestionAnswered(emptyIframeTimu), false);

      // 模拟含 &nbsp; 或 \u200B 的空富文本
      const zeroWidthIframeTimu = {
        querySelector: () => null,
        querySelectorAll: (selector: string) => {
          if (selector.includes('iframe')) {
            return [
              {
                contentDocument: {
                  body: {
                    innerHTML: '<p>&nbsp;\u200B</p>',
                    textContent: ' \u200B'
                  }
                }
              }
            ];
          }
          return [];
        }
      } as any;
      assert.equal(isQuestionAnswered(zeroWidthIframeTimu), false);

      // 真实已填入回答的富文本
      const answeredIframeTimu = {
        querySelector: () => null,
        querySelectorAll: (selector: string) => {
          if (selector.includes('iframe')) {
            return [
              {
                contentDocument: {
                  body: {
                    innerHTML: '<p>牛磺酸是条件必需氨基酸</p>',
                    textContent: '牛磺酸是条件必需氨基酸'
                  }
                }
              }
            ];
          }
          return [];
        }
      } as any;
      assert.equal(isQuestionAnswered(answeredIframeTimu), true);
    });

    it('21.3 extractQuestionImages 确保超星官方 star3 图床题图 100% 正常保留', async () => {
      const mockTimuWithStar3 = {
        querySelectorAll: (selector: string) => {
          if (selector === 'img') {
            return [
              // 超星官方图床题图（包含 star3）必须 100% 被保留
              {
                src: 'http://p.ananas.chaoxing.com/star3/origin/a8b9c0d1e2f3456789.png',
                className: '',
                getAttribute: (k: string) => (k === 'src' ? 'http://p.ananas.chaoxing.com/star3/origin/a8b9c0d1e2f3456789.png' : null),
                style: { width: '400px', height: '300px' },
                complete: true,
                naturalWidth: 400,
                naturalHeight: 300
              },
              // 悬浮窗内部图片（必须被过滤）
              {
                src: 'http://p.ananas.chaoxing.com/star3/origin/inside_card.png',
                className: '',
                getAttribute: () => null,
                closest: (sel: string) => sel.includes('.kasa-card'),
                style: {},
                complete: true,
                naturalWidth: 100,
                naturalHeight: 100
              },
              // 评星图标但带有 icon class（必须被过滤）
              {
                src: 'http://example.com/assets/star.png',
                className: 'score-star icon',
                getAttribute: () => null,
                style: {},
                complete: true,
                naturalWidth: 16,
                naturalHeight: 16
              }
            ];
          }
          return [];
        }
      } as any;

      // 在 Node.js 环境下模拟网络不可达时返回原始 candidateUrls 或通过 Base64 提取
      const originalXHR = (globalThis as any).GM_xmlhttpRequest;
      try {
        (globalThis as any).GM_xmlhttpRequest = (opts: any) => {
          opts.onload?.({
            status: 200,
            response: new ArrayBuffer(8),
            getResponseHeader: () => 'image/png'
          });
        };

        const imgs = await extractQuestionImages(mockTimuWithStar3);
        assert.equal(imgs.length, 1);
        assert.ok(imgs[0].startsWith('data:image/png;base64,'));
      } finally {
        (globalThis as any).GM_xmlhttpRequest = originalXHR;
      }
    });

    it('21.4 isAiRefusalOrApology 覆盖第 46 题实际发生的未提供结构式变体', () => {
      assert.equal(isAiRefusalOrApology('由于题目未提供结构式，无法确定其名称和分类'), true);
      assert.equal(isAiRefusalOrApology('由于没有提供结构式，无法确定其名称'), true);
      assert.equal(isAiRefusalOrApology('未给出结构式，无法回答该问题'), true);
      assert.equal(isAiRefusalOrApology('未包含图片或结构式，请补充结构式'), true);
      assert.equal(isAiRefusalOrApology('无法确定答案，请提供题目结构式图片'), true);

      // 正常主观题答案不误杀
      assert.equal(isAiRefusalOrApology('该化合物为牛磺酸，属于含硫氨基酸衍生物。'), false);
    });

    it('21.5 cleanRichTextAnswer 剥离生硬冗余的别名括号补丁', () => {
      const input = '牛磺酸（又称2-氨基乙磺酸）是一种含硫的非蛋白氨基酸（亦称氨基磺酸），在体内具有重要生理功能。';
      const cleaned = cleanRichTextAnswer(input);
      assert.ok(!cleaned.includes('（又称2-氨基乙磺酸）'));
      assert.ok(!cleaned.includes('（亦称氨基磺酸）'));
      assert.ok(cleaned.includes('牛磺酸是一种含硫的非蛋白氨基酸'));
    });

    it('21.6 buildAiPrompt 主观题 Prompt 高校优秀考生答题风格与去 AI 味约束', () => {
      const messages = buildAiPrompt('essay', '简述牛磺酸的生理功能', []);
      const sys = typeof messages[0].content === 'string' ? messages[0].content : '';
      const user = typeof messages[1].content === 'string' ? messages[1].content : '';

      assert.ok(sys.includes('高校优秀考生'));
      assert.ok(sys.includes('杜绝维基百科式报户口'));
      assert.ok(sys.includes('严禁解释性括号与别名打补丁'));
      assert.ok(user.includes('高校优秀考生手写答案口吻'));
      assert.ok(user.includes('聚焦核心采分点'));
    });
  });
});
