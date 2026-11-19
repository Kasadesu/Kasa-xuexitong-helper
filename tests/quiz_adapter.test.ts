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

if (typeof (globalThis as any).HTMLElement === 'undefined') {
  (globalThis as any).HTMLElement = class MockHTMLElement {
    style: any = {};
    attachShadow() {
      return {
        replaceChildren: () => {},
        querySelector: () => null,
        querySelectorAll: () => []
      };
    }
    getBoundingClientRect() {
      return { left: 100, top: 100, width: 340, height: 400 };
    }
  };
}

if (typeof (globalThis as any).customElements === 'undefined') {
  (globalThis as any).customElements = {
    define: () => {}
  };
}

if (typeof (globalThis as any).document === 'undefined') {
  (globalThis as any).document = {
    title: '测试文档',
    createElement: (tag: string) => ({
      tagName: tag,
      style: {},
      innerHTML: '',
      textContent: '',
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {}
    })
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
  extractExplicitOptionLetter,
  isQuestionAnswered,
  extractQuestionImages,
  hasMeaningfulContent,
  blobToDataUrl,
  compressImageBlob,
  doQuizTask,
  findNextQuestionBtn,
  getExamScope,
  getExamAutoResumeState,
  setExamAutoResumeState,
  clearExamAutoResumeState
} from '../src/adapters/quiz';
import { ChapterScheduler } from '../src/core/scheduler';
import { PANEL_STYLES } from '../src/ui/style';
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

  describe('【第 22 关】v1.3.0 多模态硬超时防假死、图片压缩白底防护与去答字前缀专项回归测试', () => {
    it('22.1 blobToDataUrl 支持 Node Buffer 并具备超时防御能力', async () => {
      const buffer = Buffer.from('fake-image-bytes');
      const dataUrl = await blobToDataUrl(buffer);
      assert.ok(dataUrl.startsWith('data:image/png;base64,'));
    });

    it('22.2 compressImageBlob 降级保护：非浏览器环境或 SVG / 小体积直接返回原始 dataUrl', async () => {
      const raw = 'data:image/png;base64,12345';
      const resNonBrowser = await compressImageBlob(null, raw);
      assert.equal(resNonBrowser, raw);

      const svgBlob = { type: 'image/svg+xml', size: 1000 };
      const resSvg = await compressImageBlob(svgBlob, raw);
      assert.equal(resSvg, raw);

      const smallBlob = { type: 'image/png', size: 50 * 1024 };
      const resSmall = await compressImageBlob(smallBlob, raw);
      assert.equal(resSmall, raw);
    });

    it('22.3 cleanRichTextAnswer 彻底剥离“答：”、“答案：”、“解：”等开篇前缀，且不误伤正文“水解：”', () => {
      assert.equal(
        cleanRichTextAnswer('答：牛磺酸是一种非蛋白氨基酸。'),
        '牛磺酸是一种非蛋白氨基酸。'
      );
      assert.equal(
        cleanRichTextAnswer('答案：牛磺酸是一种非蛋白氨基酸。'),
        '牛磺酸是一种非蛋白氨基酸。'
      );
      assert.equal(
        cleanRichTextAnswer('【参考答案】：牛磺酸是一种非蛋白氨基酸。'),
        '牛磺酸是一种非蛋白氨基酸。'
      );
      assert.equal(
        cleanRichTextAnswer('解：首先计算其分子量。'),
        '首先计算其分子量。'
      );
      assert.equal(
        cleanRichTextAnswer('解答：\n牛磺酸具有调节渗透压等功能。'),
        '牛磺酸具有调节渗透压等功能。'
      );

      // 严防误伤正文句中及科学术语（如 水解：、电解：）
      const chemicalText = '该反应分两步进行：\n水解：在酸性催化下生成羧酸；\n电解：在阳极发生氧化。';
      const resChem = cleanRichTextAnswer(chemicalText);
      assert.ok(resChem.includes('水解：在酸性催化下生成羧酸；'));
      assert.ok(resChem.includes('电解：在阳极发生氧化。'));
    });

    it('22.4 buildAiPrompt 主观题拆分为优秀考生直答人设，严禁前缀复述与八股排比', () => {
      const essayPrompt = buildAiPrompt('essay', '请简述紫外光谱与红外光谱的区别', []);
      const sys = typeof essayPrompt[0].content === 'string' ? essayPrompt[0].content : '';
      const user = typeof essayPrompt[1].content === 'string' ? essayPrompt[1].content : '';

      // 验证已剥离“助教”说教腔，改为优秀考生直答人设
      assert.ok(!sys.includes('高校答题助教'));
      assert.ok(sys.includes('高校优秀考生'));

      // 验证新增的禁止前缀、禁止提纲复述、禁止八股排比与禁止总结升华
      assert.ok(sys.includes('严禁前缀与题干复述'));
      assert.ok(sys.includes('杜绝八股排比与去 AI 味'));
      assert.ok(sys.includes('杜绝说教总结与升华废话'));

      assert.ok(user.includes('严禁开篇写“答：”、“答案：”、“解：”'));
      assert.ok(user.includes('严禁机械使用“一、…… 二、……”八股排比'));
      assert.ok(user.includes('严禁在结尾写“综上所述”'));

      // 验证客观题保留助教人设不受影响
      const singlePrompt = buildAiPrompt('single', '1+1=?', ['1', '2']);
      const sysSingle = typeof singlePrompt[0].content === 'string' ? singlePrompt[0].content : '';
      assert.ok(sysSingle.includes('高校答题助教'));
    });

    it('22.5 extractQuestionImages 在 GM_xmlhttpRequest 存在静默中止或丢包时具备外层超时与 abort 防护', async () => {
      const originalXHR = (globalThis as any).GM_xmlhttpRequest;
      const originalDoc = (globalThis as any).document;

      try {
        const dom = {
          querySelectorAll: () => [
            {
              currentSrc: 'https://pan-yz.chaoxing.com/star3/origin/hanging-test.png',
              className: '',
              getAttribute: () => null,
              style: {},
              width: 200,
              height: 200,
              complete: true,
              naturalWidth: 200,
              naturalHeight: 200,
              closest: () => null
            }
          ]
        };

        const controller = new AbortController();
        // 模拟外部主动中止
        (globalThis as any).GM_xmlhttpRequest = (opts: any) => {
          assert.ok(typeof opts.onabort === 'function', '必须提供原生 onabort 回调');
          assert.equal(opts.timeout, 6000, '内部 timeout 必须为 6000ms');
          // 模拟静默挂起：不调用 onload/onerror，等待外部 abort
          return {
            abort: () => {
              if (opts.onabort) opts.onabort();
            }
          };
        };

        const promise = extractQuestionImages(dom as any, controller.signal);
        controller.abort();
        const res = await promise;
        assert.deepEqual(res, [], '外部中止后应安全返回空数组');
      } finally {
        (globalThis as any).GM_xmlhttpRequest = originalXHR;
        (globalThis as any).document = originalDoc;
      }
    });

    it('22.6 compressImageBlob 纯白底色 #ffffff 铺设与异常路径下 100% 释放 objectUrl', async () => {
      const originalDoc = (globalThis as any).document;
      const originalImage = (globalThis as any).Image;
      const originalURL = (globalThis as any).URL;

      let fillStyleApplied = '';
      let fillRectCalls: any[] = [];
      let drawImageCalls: any[] = [];
      let revokedUrls: string[] = [];

      try {
        (globalThis as any).URL = {
          createObjectURL: () => 'blob:mock-url-123',
          revokeObjectURL: (url: string) => revokedUrls.push(url)
        };

        (globalThis as any).document = {
          createElement: (tag: string) => {
            if (tag === 'canvas') {
              return {
                width: 0,
                height: 0,
                getContext: () => ({
                  set fillStyle(val: string) {
                    fillStyleApplied = val;
                  },
                  get fillStyle() {
                    return fillStyleApplied;
                  },
                  fillRect: (x: number, y: number, w: number, h: number) => {
                    fillRectCalls.push({ x, y, w, h, currentFill: fillStyleApplied });
                  },
                  drawImage: (img: any, x: number, y: number, w: number, h: number) => {
                    drawImageCalls.push({ x, y, w, h });
                  }
                }),
                toDataURL: (mime: string, quality: number) => 'data:image/jpeg;base64,mocked-compressed'
              };
            }
            return {};
          }
        };

        // 1. 模拟正常加载：必须先铺纯白底色 #ffffff，再 drawImage
        (globalThis as any).Image = class {
          width = 800;
          height = 600;
          naturalWidth = 800;
          naturalHeight = 600;
          onload: any = null;
          onerror: any = null;
          set src(_: string) {
            setTimeout(() => this.onload?.(), 5);
          }
        };

        const bigBlob = { type: 'image/png', size: 300 * 1024 };
        const raw = 'data:image/png;base64,very-long-raw-uncompressed-data-string';
        const compressed = await compressImageBlob(bigBlob, raw);

        assert.equal(compressed, 'data:image/jpeg;base64,mocked-compressed');
        assert.equal(fillStyleApplied, '#ffffff', '必须先设置纯白底色');
        assert.equal(fillRectCalls.length, 1);
        assert.equal(fillRectCalls[0].currentFill, '#ffffff');
        assert.equal(drawImageCalls.length, 1);
        assert.ok(revokedUrls.includes('blob:mock-url-123'), '必须调用 URL.revokeObjectURL 释放内存');

        // 2. 模拟图片加载失败：必须安全降级返回原始 rawDataUrl，且依然释放 objectUrl
        revokedUrls = [];
        (globalThis as any).Image = class {
          onload: any = null;
          onerror: any = null;
          set src(_: string) {
            setTimeout(() => this.onerror?.(new Error('Image decode error')), 5);
          }
        };

        const fallbackRes = await compressImageBlob(bigBlob, raw);
        assert.equal(fallbackRes, raw, '图片报错时必须安全回退原始 rawDataUrl');
        assert.ok(revokedUrls.includes('blob:mock-url-123'), '图片报错时依然必须释放 URL.revokeObjectURL');
      } finally {
        (globalThis as any).document = originalDoc;
        (globalThis as any).Image = originalImage;
        (globalThis as any).URL = originalURL;
      }
    });

    it('22.7 blobToDataUrl FileReader 异常分支与 abort 安全机制', async () => {
      const originalFileReader = (globalThis as any).FileReader;

      try {
        // 1. 模拟 FileReader 成功读取
        (globalThis as any).FileReader = class {
          result = 'data:image/png;base64,file-reader-ok';
          onloadend: any = null;
          onerror: any = null;
          onabort: any = null;
          readAsDataURL() {
            setTimeout(() => this.onloadend?.(), 5);
          }
        };
        const okRes = await blobToDataUrl({ type: 'image/png' });
        assert.equal(okRes, 'data:image/png;base64,file-reader-ok');

        // 2. 模拟 FileReader 出错
        (globalThis as any).FileReader = class {
          result = null;
          onloadend: any = null;
          onerror: any = null;
          onabort: any = null;
          readAsDataURL() {
            setTimeout(() => this.onerror?.(new Error('read failed')), 5);
          }
        };
        await assert.rejects(async () => {
          await blobToDataUrl({ type: 'image/png' });
        }, /read failed/);

        // 3. 模拟 FileReader 中止
        (globalThis as any).FileReader = class {
          result = null;
          onloadend: any = null;
          onerror: any = null;
          onabort: any = null;
          readAsDataURL() {
            setTimeout(() => this.onabort?.(), 5);
          }
        };
        await assert.rejects(async () => {
          await blobToDataUrl({ type: 'image/png' });
        }, /FileReader 已中止/);
      } finally {
        (globalThis as any).FileReader = originalFileReader;
      }
    });

    it('22.8 queryAiAnswer 在外部信号预先 abort 时秒级响应且绝无 TDZ 崩溃', async () => {
      const ac = new AbortController();
      ac.abort();

      const q: Question = {
        id: 'tdz-test-1',
        index: 1,
        title: '测试预中止信号',
        type: 'single',
        options: ['A', 'B'],
        status: 'searching'
      };

      const result = await queryAiAnswer(q, undefined, ac.signal);
      assert.deepEqual(result, [], '已中止的信号必须立即返回空数组且无任何异常抛出');
    });

    it('22.10 runGuardedXhr 与 extractQuestionImages 原生 onabort 回调直接解除挂起防御测试', async () => {
      const originalXHR = (globalThis as any).GM_xmlhttpRequest;
      const oldKey = store.config.aiApiKey;

      try {
        // 1. 验证 queryAiAnswer 进入 runGuardedXhr 后遭遇在途 abort 且无 TDZ 崩溃
        store.updateConfig({ aiApiKey: 'test-key-v13' });
        let abortMethodCalled = false;
        let onabortRegistered = false;
        const ac = new AbortController();

        (globalThis as any).GM_xmlhttpRequest = (opts: any) => {
          onabortRegistered = typeof opts.onabort === 'function';
          setTimeout(() => ac.abort(), 10);
          return {
            abort: () => {
              abortMethodCalled = true;
              if (opts.onabort) opts.onabort();
            }
          };
        };

        const q: Question = {
          id: 'xhr-abort-1',
          index: 1,
          title: '测试在途 GM_xmlhttpRequest 中止',
          type: 'single',
          options: ['A', 'B'],
          status: 'searching'
        };
        const aiRes = await queryAiAnswer(q, undefined, ac.signal);
        assert.deepEqual(aiRes, []);
        assert.equal(onabortRegistered, true);
        assert.equal(abortMethodCalled, true);

        // 2. 验证 extractQuestionImages 在未中止 signal 但 GM_xmlhttpRequest 自身触发 onabort 时不会永久挂起
        const dom = {
          querySelectorAll: () => [
            {
              currentSrc: 'https://pan-yz.chaoxing.com/star3/origin/internal-abort.png',
              className: '',
              getAttribute: () => null,
              style: {},
              width: 200,
              height: 200,
              complete: true,
              naturalWidth: 200,
              naturalHeight: 200,
              closest: () => null
            }
          ]
        };

        (globalThis as any).GM_xmlhttpRequest = (opts: any) => {
          setTimeout(() => opts.onabort?.(), 10);
          return { abort: () => {} };
        };

        const imgs = await extractQuestionImages(dom as any);
        assert.deepEqual(imgs, []);
      } finally {
        (globalThis as any).GM_xmlhttpRequest = originalXHR;
        store.updateConfig({ aiApiKey: oldKey });
      }
    });

    it('22.9 cleanRichTextAnswer 全方位生化/物理专业术语防误伤与复合答案前缀彻底剥离', () => {
      // 复合前缀彻底剥离
      assert.equal(cleanRichTextAnswer('【标准答案】：本反应属于亲电加成反应。'), '本反应属于亲电加成反应。');
      assert.equal(cleanRichTextAnswer('【参考答案】\n核酸是遗传信息的携带者。'), '核酸是遗传信息的携带者。');
      assert.equal(cleanRichTextAnswer('【解】：设 x=1，y=2。'), '设 x=1，y=2。');
      assert.equal(cleanRichTextAnswer('【答】：线粒体是细胞的动力车间。'), '线粒体是细胞的动力车间。');
      assert.equal(cleanRichTextAnswer('参考答案：酶具有高效性与专一性。'), '酶具有高效性与专一性。');
      assert.equal(cleanRichTextAnswer('答案: 细胞膜具有流动镶嵌特征。'), '细胞膜具有流动镶嵌特征。');

      // 专业术语防误伤：水解、电解、酶解、氧化分解、裂解、光解
      const fullBioText = [
        '物质代谢主要包括以下过程：',
        '水解：在酸性或碱性催化下发生水解；',
        '电解：溶液中阴阳离子在电极表面放电；',
        '酶解：淀粉在淀粉酶作用下酶解为麦芽糖；',
        '氧化分解：葡萄糖在线粒体内氧化分解为二氧化碳和水；',
        '光解：叶绿体类囊体薄膜上水的光解产生氧气；',
        '裂解：石油重油在催化裂化装置中裂解为低碳烯烃。'
      ].join('\n');

      const cleanedBio = cleanRichTextAnswer(fullBioText);
      assert.ok(cleanedBio.includes('水解：在酸性或碱性催化下发生水解；'));
      assert.ok(cleanedBio.includes('电解：溶液中阴阳离子在电极表面放电；'));
      assert.ok(cleanedBio.includes('酶解：淀粉在淀粉酶作用下酶解为麦芽糖；'));
      assert.ok(cleanedBio.includes('氧化分解：葡萄糖在线粒体内氧化分解为二氧化碳和水；'));
      assert.ok(cleanedBio.includes('光解：叶绿体类囊体薄膜上水的光解产生氧气；'));
      assert.ok(cleanedBio.includes('裂解：石油重油在催化裂化装置中裂解为低碳烯烃。'));
    });
  });

  describe('【第 23 关】红色置顶待确认日志与 Store 告警状态流转测试', () => {
    it('23.1 普通日志 (info, warning, success) 仅进入 logs 绝不进入 pinnedErrors', () => {
      store.acknowledgeAllErrors();
      const prevPinnedCount = store.pinnedErrors.length;
      assert.equal(prevPinnedCount, 0);

      store.addLog('普通信息日志', 'info');
      store.addLog('警告信息日志', 'warning');
      store.addLog('成功信息日志', 'success');

      assert.equal(store.pinnedErrors.length, 0);
      assert.equal(store.logs[0].message, '成功信息日志');
      assert.equal(store.logs[1].message, '警告信息日志');
      assert.equal(store.logs[2].message, '普通信息日志');
    });

    it('23.2 错误日志 (error) 同步进入 pinnedErrors 且初始 count 为 1', () => {
      store.acknowledgeAllErrors();
      let notified = false;
      const unsub = store.subscribe(() => {
        notified = true;
      });

      store.addLog('测试致命错误：网络超时', 'error');
      unsub();

      assert.ok(notified);
      assert.equal(store.pinnedErrors.length, 1);
      assert.equal(store.pinnedErrors[0].message, '测试致命错误：网络超时');
      assert.equal(store.pinnedErrors[0].count, 1);
      assert.equal(store.pinnedErrors[0].level, 'error');
      assert.ok(store.pinnedErrors[0].id);
    });

    it('23.3 相同错误文案查重并置顶，累加 count 并不新增重复项', () => {
      store.acknowledgeAllErrors();
      store.addLog('第 1 题错误 A', 'error');
      store.addLog('第 2 题错误 B', 'error');
      assert.equal(store.pinnedErrors.length, 2);
      assert.equal(store.pinnedErrors[0].message, '第 2 题错误 B');

      // 再次报出第 1 题错误 A（即使带前后空格也查重）
      store.addLog('  第 1 题错误 A  ', 'error');
      assert.equal(store.pinnedErrors.length, 2);
      // 应被置顶到首位
      assert.equal(store.pinnedErrors[0].message, '  第 1 题错误 A  ');
      assert.equal(store.pinnedErrors[0].count, 2);
    });

    it('23.4 acknowledgeError(id) 精准移除指定告警，acknowledgeAllErrors() 一键清空', () => {
      store.acknowledgeAllErrors();
      store.addLog('错误 1', 'error');
      store.addLog('错误 2', 'error');
      store.addLog('错误 3', 'error');
      assert.equal(store.pinnedErrors.length, 3);

      const targetId = store.pinnedErrors[1].id;
      const targetMsg = store.pinnedErrors[1].message;
      store.acknowledgeError(targetId);

      assert.equal(store.pinnedErrors.length, 2);
      assert.ok(!store.pinnedErrors.some((p) => p.id === targetId || p.message === targetMsg));

      store.acknowledgeAllErrors();
      assert.equal(store.pinnedErrors.length, 0);
    });

    it('23.5 pinnedErrors 最大容量限制为 20 条，溢出时丢弃末尾最早条目', () => {
      store.acknowledgeAllErrors();
      for (let i = 1; i <= 25; i++) {
        store.addLog(`系统错误编号 #${i}`, 'error');
      }

      assert.equal(store.pinnedErrors.length, 20);
      assert.equal(store.pinnedErrors[0].message, '系统错误编号 #25');
      assert.equal(store.pinnedErrors[19].message, '系统错误编号 #6');
    });

    it('23.6 doQuizTask 真实集成场景：当填空/主观题 AI 拒答时，写入 pinnedErrors、置 status=failed、取消自动提交并继续作答后续题目', async () => {
      store.acknowledgeAllErrors();
      store.config.autoSubmitWork = true;
      store.config.aiApiKey = 'sk-mock-key';
      store.config.aiBaseUrl = 'https://api.mock.com';

      // 模拟第 1 题：填空题（AI 拒答），第 2 题：单选题（AI 正常作答）
      const mockTimu1: any = {
        getAttribute: (k: string) => (k === 'data-id' ? 'q-refusal-1' : null),
        contains: () => false,
        querySelector: (sel: string) => {
          if (sel.includes(':checked')) return null;
          if (sel.includes('.Zy_TItle') || sel.includes('mark_name') || sel.includes('timu-title')) {
            return { textContent: '1. 【填空题】分析下图中分子的立体构型', innerText: '1. 【填空题】分析下图中分子的立体构型' };
          }
          if (sel.includes('input') || sel.includes('textarea')) {
            return { type: 'text', name: 'answer1', value: '', dispatchEvent: () => true, getAttribute: () => null };
          }
          return null;
        },
        querySelectorAll: (sel: string) => {
          if (sel.includes('textarea') || sel.includes('input')) {
            return [{ type: 'text', name: 'answer1', value: '', dispatchEvent: () => true, getAttribute: () => null }];
          }
          return [];
        },
        cloneNode: function() { return this; }
      };

      const clickedOptions: string[] = [];
      const createOpt = (letter: string, text: string) => ({
        innerText: `${letter}. ${text}`,
        textContent: `${letter}. ${text}`,
        getAttribute: () => null,
        setAttribute: () => {},
        contains: () => false,
        classList: { contains: () => false, add: () => {}, remove: () => {} },
        querySelector: (sel: string) => {
          if (sel.includes(':checked') || sel.includes('check_answer')) return null;
          if (sel.includes('num_option')) {
            return {
              classList: { contains: () => false, add: () => {}, remove: () => {} },
              getAttribute: () => null,
              click: () => clickedOptions.push(letter)
            };
          }
          return {
            click: () => clickedOptions.push(letter),
            dispatchEvent: () => true,
            getAttribute: () => null,
            setAttribute: () => {},
            classList: { contains: () => false, add: () => {}, remove: () => {} }
          };
        },
        click: () => clickedOptions.push(letter),
        dispatchEvent: () => true
      });

      const mockTimu2: any = {
        getAttribute: (k: string) => (k === 'data-id' ? 'q-normal-2' : null),
        contains: () => false,
        querySelector: (sel: string) => {
          if (sel.includes('check_answer') || sel.includes(':checked') || sel.includes('cur') || sel.includes('aria-checked')) return null;
          if (sel.includes('.Zy_TItle') || sel.includes('mark_name') || sel.includes('timu-title')) {
            return { textContent: '2. 【单选题】提瓦特大陆的风神是谁？', innerText: '2. 【单选题】提瓦特大陆的风神是谁？' };
          }
          if (sel.includes('li') || sel.includes('num_option') || sel.includes('input')) {
            return createOpt('A', '温迪');
          }
          return null;
        },
        querySelectorAll: (sel: string) => {
          if (sel.includes('li')) {
            return [createOpt('A', '温迪'), createOpt('B', '钟离')];
          }
          return [];
        },
        cloneNode: function() { return this; }
      };

      const mockDoc: any = {
        querySelector: (sel: string) => {
          if (sel.includes('.questionLi') || sel.includes('.TiMu') || sel.includes('div[data-id]')) {
            return mockTimu1;
          }
          if (sel.includes('.ceyan_name') || sel.includes('title')) {
            return { textContent: '有机化学与提瓦特常识期末测验' };
          }
          if (sel.includes('.btnSubmit') || sel.includes('btnSave') || sel.includes('暂存')) {
            return { click: () => {}, dispatchEvent: () => true };
          }
          return null;
        },
        querySelectorAll: (sel: string) => {
          if (sel.includes('questionLi') || sel.includes('TiMu')) {
            return [mockTimu1, mockTimu2];
          }
          return [];
        }
      };

      const prevXhr = (globalThis as any).GM_xmlhttpRequest;
      let queryCount = 0;
      (globalThis as any).GM_xmlhttpRequest = (opts: any) => {
        queryCount++;
        setTimeout(() => {
          if (opts.url.includes('/chat/completions')) {
            if (queryCount === 1) {
              opts.onload({
                status: 200,
                responseText: JSON.stringify({
                  choices: [{ message: { content: '抱歉，由于题目未提供关键图片或数据，无法为您解答。' } }]
                })
              });
            } else {
              opts.onload({
                status: 200,
                responseText: JSON.stringify({
                  choices: [{ message: { content: '["A"]' } }]
                })
              });
            }
          }
        }, 10);
      };

      try {
        const controller = new AbortController();
        await doQuizTask(null, mockDoc, {
          signal: controller.signal,
          isCurrent: () => true
        });

        assert.equal(store.questions.length, 2);
        assert.equal(store.questions[0].status, 'failed', '第 1 题因拒答应置为 failed');
        assert.equal(store.questions[1].status, 'success', '第 2 题应正常作答完成');

        const errorMsgs = store.pinnedErrors.map((p) => p.message);
        assert.ok(
          errorMsgs.some((m) => m.includes('第 1 题 AI 反映缺少关键图片或数据')),
          'pinnedErrors 必须记录第 1 题缺图拒答错误'
        );
        assert.ok(
          errorMsgs.some((m) => m.includes('已自动取消自动提交，请人工复核后手动提交')),
          'pinnedErrors 必须记录取消自动提交的错误'
        );
        assert.ok(
          errorMsgs.some((m) => m.includes('因存在未成功有效作答的题目，为防学业事故已自动取消自动提交，转为暂存模式')),
          '最终日志必须转为暂存模式告警'
        );

        assert.ok(clickedOptions.includes('A'), '连续作答流程不应中断，第 2 题应成功作答');
      } finally {
        (globalThis as any).GM_xmlhttpRequest = prevXhr;
      }
    });

    it('23.7 doQuizTask 真实集成场景：当 AI 返回空答案且无保底匹配时，置 status=failed、记录错误并取消自动提交', async () => {
      store.acknowledgeAllErrors();
      store.config.autoSubmitWork = true;
      store.config.aiApiKey = 'sk-mock-key';

      // 构造前 3 题已答题跳过，第 4 题（避开 index 1-3 保底）AI 返回空答案
      const makeDoneTimu = (idx: number) => ({
        getAttribute: () => `q-done-${idx}`,
        contains: () => false,
        querySelector: (sel: string) => {
          if (sel.includes('.Zy_TItle') || sel.includes('mark_name')) {
            return { textContent: `${idx}. 【单选题】已作答测试题` };
          }
          if (sel.includes(':checked')) return { checked: true };
          if (sel.includes('input') || sel.includes('li')) return { type: 'radio', checked: true };
          return null;
        },
        querySelectorAll: (sel: string) => {
          if (sel.includes('li') || sel.includes('input')) return [{ type: 'radio', checked: true }];
          return [];
        },
        cloneNode: function() { return this; }
      });

      const mockTimu4: any = {
        getAttribute: () => 'q-empty-ans-4',
        contains: () => false,
        querySelector: (sel: string) => {
          if (sel.includes(':checked')) return null;
          if (sel.includes('.Zy_TItle') || sel.includes('mark_name')) {
            return { textContent: '4. 【简答题】请阐述量子纠缠超距相关的微观物理机制与对称性破缺' };
          }
          if (sel.includes('textarea') || sel.includes('input')) {
            return { type: 'text', name: 'ans', value: '', dispatchEvent: () => true, getAttribute: () => null };
          }
          return null;
        },
        querySelectorAll: (sel: string) => {
          if (sel.includes('textarea') || sel.includes('input')) {
            return [{ type: 'text', name: 'ans', value: '', dispatchEvent: () => true, getAttribute: () => null }];
          }
          return [];
        },
        cloneNode: function() { return this; }
      };

      const mockDoc: any = {
        querySelector: (sel: string) => {
          if (sel.includes('.questionLi') || sel.includes('.TiMu') || sel.includes('div[data-id]')) {
            return mockTimu4;
          }
          return { click: () => {}, dispatchEvent: () => true };
        },
        querySelectorAll: (sel: string) =>
          sel.includes('TiMu') ? [makeDoneTimu(1), makeDoneTimu(2), makeDoneTimu(3), mockTimu4] : []
      };

      const prevXhr = (globalThis as any).GM_xmlhttpRequest;
      (globalThis as any).GM_xmlhttpRequest = (opts: any) => {
        setTimeout(() => {
          opts.onload({
            status: 200,
            responseText: JSON.stringify({
              choices: [{ message: { content: '   ' } }]
            })
          });
        }, 10);
      };

      try {
        await doQuizTask(null, mockDoc, {
          signal: new AbortController().signal,
          isCurrent: () => true
        });

        // 前 3 题已跳过，第 4 题（索引 3）为 failed
        assert.equal(store.questions[3].status, 'failed');
        assert.ok(
          store.pinnedErrors.some((p) => p.message.includes('第 4 题未获取到有效答案，已保留空白')),
          '未获取到有效答案必须写入 pinnedErrors'
        );
      } finally {
        (globalThis as any).GM_xmlhttpRequest = prevXhr;
      }
    });

    it('23.8 doQuizTask 真实集成场景：当 AI 返回了有效答案但题目未检测到输入框时，记录未检测到输入框错误', async () => {
      store.acknowledgeAllErrors();
      store.config.autoSubmitWork = true;
      store.config.aiApiKey = 'sk-mock-key';

      const mockTimu: any = {
        getAttribute: () => 'q-no-input',
        contains: () => false,
        querySelector: (sel: string) => {
          if (sel.includes(':checked')) return null;
          if (sel.includes('.Zy_TItle') || sel.includes('mark_name')) {
            return { textContent: '1. 【填空题】光速在真空中的精确数值约为多少米每秒？' };
          }
          return null;
        },
        querySelectorAll: () => [],
        cloneNode: function() { return this; }
      };

      const mockDoc: any = {
        querySelector: (sel: string) => {
          if (sel.includes('.questionLi') || sel.includes('.TiMu') || sel.includes('div[data-id]')) {
            return mockTimu;
          }
          return { click: () => {}, dispatchEvent: () => true };
        },
        querySelectorAll: (sel: string) => (sel.includes('TiMu') ? [mockTimu] : [])
      };

      const prevXhr = (globalThis as any).GM_xmlhttpRequest;
      (globalThis as any).GM_xmlhttpRequest = (opts: any) => {
        setTimeout(() => {
          opts.onload({
            status: 200,
            responseText: JSON.stringify({
              choices: [{ message: { content: '["299792458"]' } }]
            })
          });
        }, 10);
      };

      try {
        await doQuizTask(null, mockDoc, {
          signal: new AbortController().signal,
          isCurrent: () => true
        });

        assert.equal(store.questions[0].status, 'failed');
        assert.ok(
          store.pinnedErrors.some((p) => p.message.includes('第 1 题未检测到可填入的输入框')),
          '缺少输入框必须记录专属 error 告警'
        );
      } finally {
        (globalThis as any).GM_xmlhttpRequest = prevXhr;
      }
    });

    it('23.9 doQuizTask 真实集成场景：当题目含图片且模型回答提示无法完整识别时，记录重点核对错误', async () => {
      store.acknowledgeAllErrors();
      store.config.aiApiKey = 'sk-mock-key';

      const mockTimu: any = {
        getAttribute: () => 'q-img-check',
        contains: () => false,
        querySelector: (sel: string) => {
          if (sel.includes(':checked')) return null;
          if (sel.includes('.Zy_TItle') || sel.includes('mark_name')) {
            return { textContent: '1. 【单选题】请观察下图反应式判断主产物' };
          }
          return null;
        },
        querySelectorAll: (sel: string) => {
          if (sel.includes('img')) {
            return [
              {
                src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==valid-img-data-long-enough-to-pass-filter-defense-check-for-testing-padding-extra-characters-exceeding-two-hundred-bytes-threshold',
                style: {},
                getAttribute: () => null,
                complete: true,
                naturalWidth: 200,
                naturalHeight: 200
              }
            ];
          }
          if (sel.includes('li')) {
            return [
              {
                innerText: 'A. 产物甲',
                textContent: 'A. 产物甲',
                getAttribute: () => null,
                setAttribute: () => {},
                classList: { contains: () => false, add: () => {}, remove: () => {} },
                querySelector: (sel: string) => {
                  if (sel.includes('num_option')) {
                    return {
                      classList: { contains: () => false, add: () => {}, remove: () => {} },
                      getAttribute: () => null
                    };
                  }
                  return {
                    click: () => {},
                    dispatchEvent: () => true,
                    getAttribute: () => null,
                    setAttribute: () => {},
                    classList: { contains: () => false, add: () => {}, remove: () => {} }
                  };
                },
                click: () => {},
                dispatchEvent: () => true
              }
            ];
          }
          return [];
        },
        cloneNode: function() { return this; }
      };

      const mockDoc: any = {
        querySelector: (sel: string) => {
          if (sel.includes('.questionLi') || sel.includes('.TiMu') || sel.includes('div[data-id]')) {
            return mockTimu;
          }
          return { click: () => {}, dispatchEvent: () => true };
        },
        querySelectorAll: (sel: string) => (sel.includes('TiMu') ? [mockTimu] : [])
      };

      const prevXhr = (globalThis as any).GM_xmlhttpRequest;
      (globalThis as any).GM_xmlhttpRequest = (opts: any) => {
        setTimeout(() => {
          opts.onload({
            status: 200,
            responseText: JSON.stringify({
              choices: [
                {
                  message: {
                    content: '["由于题目没有提供反应物结构式图片，无法确定答案"]'
                  }
                }
              ]
            })
          });
        }, 10);
      };

      try {
        await doQuizTask(null, mockDoc, {
          signal: new AbortController().signal,
          isCurrent: () => true
        });

        assert.ok(
          store.pinnedErrors.some((p) => p.message.includes('模型提示无法完整识别图片内容，请在交卷前重点人工核对')),
          '含图且模型提示缺图时必须记录重点核对错误'
        );
      } finally {
        (globalThis as any).GM_xmlhttpRequest = prevXhr;
      }
    });

    it('23.10 PANEL_STYLES 规范契约：Tokens 规范、focus-visible、prefers-reduced-motion、.kasa-card 及无 💯 / 一 图标', () => {
      // 1. CSS Tokens 规范检查
      assert.ok(PANEL_STYLES.includes('--kasa-bg: #FFFFFF;'), '必须定义 --kasa-bg');
      assert.ok(PANEL_STYLES.includes('--kasa-primary: #2563EB;'), '必须定义 --kasa-primary');
      assert.ok(PANEL_STYLES.includes('--kasa-danger: #DC2626;'), '必须定义 --kasa-danger');
      assert.ok(PANEL_STYLES.includes('--kasa-radius-lg: 12px;'), '必须定义 --kasa-radius-lg');

      // 2. 键盘与交互可访问性 :focus-visible
      assert.ok(PANEL_STYLES.includes(':focus-visible'), '必须包含 :focus-visible 样式规则');

      // 3. 动效降级 @media (prefers-reduced-motion: reduce)
      assert.ok(
        PANEL_STYLES.includes('@media (prefers-reduced-motion: reduce)'),
        '必须包含 prefers-reduced-motion 媒体查询'
      );

      // 4. 卡片容器类名保留
      assert.ok(PANEL_STYLES.includes('.kasa-card'), '必须保留 .kasa-card 核心容器样式');

      // 5. 移除了 💯 和字符 一
      assert.ok(!PANEL_STYLES.includes('💯'), 'PANEL_STYLES 中严禁包含 💯 emoji');
      assert.ok(PANEL_STYLES.includes('.minimized-ball'), '必须包含 .minimized-ball 样式');
      assert.ok(PANEL_STYLES.includes('.minimized-alert-dot'), '必须包含 .minimized-alert-dot 角标样式');
    });

    let FloatingCardClass: any;
    const getFloatingCard = async () => {
      if (!FloatingCardClass) {
        const mod = await import('../src/ui/floating-card');
        FloatingCardClass = mod.FloatingCard;
      }
      return new FloatingCardClass();
    };

    it('23.11 FloatingCard DOM 契约与无障碍属性：role=alert、aria-live=assertive、版本 v1.3、兄弟容器架构', async () => {
      const card = await getFloatingCard();
      const tabContentHtml = (card as any).getTabContentHtml();

      assert.ok(
        tabContentHtml.includes('id="kasa-pinned-alerts"'),
        'tab-content 下必须包含 #kasa-pinned-alerts 容器'
      );
      assert.ok(
        tabContentHtml.includes('role="alert"'),
        '#kasa-pinned-alerts 必须具备 role="alert"'
      );
      assert.ok(
        tabContentHtml.includes('aria-live="assertive"'),
        '#kasa-pinned-alerts 必须具备 aria-live="assertive"'
      );
      assert.ok(
        tabContentHtml.includes('id="kasa-log-list"'),
        'tab-content 下必须包含 #kasa-log-list 兄弟容器'
      );

      const cardRenderHtml = (card as any).render.toString();
      assert.ok(cardRenderHtml.includes('v1.3'), '面板必须标注 v1.3 版本');
      assert.ok(!cardRenderHtml.includes('v1.4'), '版本不可篡改为 v1.4');
      assert.ok(!cardRenderHtml.includes('💯'), '面板 HTML 不得包含 💯 emoji');
    });

    it('23.12 FloatingCard 增量渲染机制：普通日志高频进入时绝不重建 #kasa-pinned-alerts DOM，杜绝吞点击', async () => {
      store.acknowledgeAllErrors();
      store.addLog('置顶错误 A', 'error');

      const card = await getFloatingCard();
      (card as any).currentTab = 'log';

      let pinnedReplaced = false;
      let logReplaced = false;

      const mockPinnedEl = {
        style: { display: '' },
        set innerHTML(_v: string) { pinnedReplaced = true; },
        get innerHTML() { return '<div class="pinned-header">...</div>'; }
      };

      const mockLogListEl = {
        set innerHTML(_v: string) { logReplaced = true; },
        get innerHTML() { return '<div>log items</div>'; }
      };

      (card as any).shadow = {
        querySelector: (sel: string) => {
          if (sel === '#kasa-pinned-alerts') return mockPinnedEl;
          if (sel === '#kasa-log-list') return mockLogListEl;
          if (sel === '#tab-alert-badge') return { style: {}, textContent: '' };
          return null;
        }
      };

      (card as any).lastRenderedPinnedKey = store.pinnedErrors.map((p) => `${p.id}:${p.time}:${p.count || 1}`).join('|');
      (card as any).lastRenderedLogKey = `${store.logs.length}:${store.logs[0]?.id || ''}:p`;

      pinnedReplaced = false;
      logReplaced = false;
      store.addLog('第 1 题开始作答', 'info');
      (card as any).onStoreUpdate();

      assert.equal(pinnedReplaced, false, '普通日志产生时，#kasa-pinned-alerts 绝不可被重建，防止吞点击');
      assert.equal(logReplaced, true, '#kasa-log-list 日志流必须正常增量更新');
    });

    it('23.13 FloatingCard Tab 切换与事件委托：log -> setting -> log 切回后告警正确恢复且支持按钮确认', async () => {
      store.acknowledgeAllErrors();
      store.addLog('关键告警 X', 'error');
      const errId = store.pinnedErrors[0].id;

      const card = await getFloatingCard();
      (card as any).currentTab = 'log';

      let logHtml = (card as any).getTabContentHtml();
      assert.ok(logHtml.includes('关键告警 X'));
      assert.ok(logHtml.includes(`data-ack-id="${errId}"`));
      assert.ok(logHtml.includes('id="btn-ack-all"'));

      (card as any).currentTab = 'setting';
      let settingHtml = (card as any).getTabContentHtml();
      assert.ok(settingHtml.includes('cfg-api-key'), 'setting 页面应包含 API 配置');
      assert.ok(!settingHtml.includes('关键告警 X'), 'setting 页面不应展示告警列表');

      (card as any).currentTab = 'log';
      let restoredLogHtml = (card as any).getTabContentHtml();
      assert.ok(restoredLogHtml.includes('关键告警 X'), '切回 log 后告警必须正确渲染');

      let ackHandled = false;
      const fakeEvent = {
        target: {
          closest: (sel: string) => {
            if (sel === '[data-ack-id]') {
              return { dataset: { ackId: errId } };
            }
            return null;
          }
        },
        stopPropagation: () => { ackHandled = true; }
      };

      const tabContentClickHandler = (e: any) => {
        const target = e.target;
        const ackBtn = target.closest('[data-ack-id]');
        if (ackBtn) {
          e.stopPropagation();
          store.acknowledgeError(ackBtn.dataset.ackId);
        }
      };

      tabContentClickHandler(fakeEvent);
      assert.ok(ackHandled, '点击确认应阻止事件冒泡');
      assert.equal(store.pinnedErrors.length, 0, '调用 acknowledgeError 后告警应被消除');
    });

    it('23.14 FloatingCard 生命周期：disconnectedCallback 必须 100% 退订 Store 避免内存泄露', async () => {
      const card = await getFloatingCard();
      let unsubCalled = false;
      (card as any).storeUnsubscribe = () => {
        unsubCalled = true;
      };

      card.disconnectedCallback();
      assert.equal(unsubCalled, true, '组件销毁时必须调用 storeUnsubscribe');
      assert.equal((card as any).storeUnsubscribe, null, '退订后引用应置为 null');
    });

    it('23.15 空白消息错误防御与无日志状态回退：纯空格错误绝不污染 pinnedErrors，全确认后恢复待机占位', async () => {
      store.acknowledgeAllErrors();
      store.logs = [];

      store.addLog('   \n\t  ', 'error');
      assert.equal(store.pinnedErrors.length, 0, '纯空格错误绝不能作为置顶告警压入');

      store.addLog('真实告警 1', 'error');
      assert.equal(store.pinnedErrors.length, 1);

      // 清空 logs 模拟仅有置顶告警但无普通日志记录的状态
      store.logs = [];
      const card = await getFloatingCard();
      let logHtmlWithPinned = (card as any).getLogListHtml();
      assert.equal(logHtmlWithPinned, '', '当有置顶告警且无普通日志时，日志区域应为空，不产生重叠占位');

      store.acknowledgeAllErrors();
      assert.equal(store.pinnedErrors.length, 0);

      let logHtmlEmpty = (card as any).getLogListHtml();
      assert.ok(logHtmlEmpty.includes('等待任务开始...'), '无日志且告警清空后必须显示等待任务开始');
    });
  });

  describe('【第 24 关】考试单题自动翻页与多选题防漏选专项回归测试', () => {
    it('24.1 cleanQuestionTitle 与 detectQuestionType 对带分值多选题干的精准识别与清洗', () => {
      assert.equal(
        cleanQuestionTitle('11. (多选题, 6.0 分) 以下属于党的三大作风的是（ ）'),
        '以下属于党的三大作风的是（ ）'
      );
      assert.equal(
        cleanQuestionTitle('12、(多选, 5分) 下列关于市场营销组合的说法正确的有'),
        '下列关于市场营销组合的说法正确的有'
      );
      assert.equal(
        cleanQuestionTitle('13. 【多选题, 8.0 分】影响消费者购买行为的心理因素包括'),
        '影响消费者购买行为的心理因素包括'
      );

      assert.equal(detectQuestionType('11. (多选题, 6.0 分) 以下属于...'), 'multiple');
      assert.equal(detectQuestionType('12. [多选, 4.5分] 下列正确的有'), 'multiple');
      assert.equal(detectQuestionType('13. （多选，10 分）请选出全部正确项'), 'multiple');
      assert.equal(detectQuestionType('14. 【多选题, 8.0 分】题干'), 'multiple');
      assert.equal(detectQuestionType('15. (单选题, 2.0 分) 唯一正确项是'), 'single');
      assert.equal(detectQuestionType('16. (判断题, 2.0 分) 该说法是否正确'), 'judge');
      assert.equal(detectQuestionType('17. (填空题, 4.0 分) 请填写空白处'), 'fill');
    });

    it('24.2 parseAiResponse(..., "multiple") 全面容错、防小写英文单词误拆与第20关术语保留', () => {
      // 1. JSON 字符串内合并形式
      assert.deepEqual(parseAiResponse('["A、B、D"]', 'multiple'), ['A', 'B', 'D']);
      assert.deepEqual(parseAiResponse('["A, B, D"]', 'multiple'), ['A', 'B', 'D']);
      assert.deepEqual(parseAiResponse('["ABD"]', 'multiple'), ['A', 'B', 'D']);
      assert.deepEqual(parseAiResponse('"A、B、D"', 'multiple'), ['A', 'B', 'D']);

      // 2. 单引号 / 无引号数组
      assert.deepEqual(parseAiResponse("['A', 'B', 'D']", 'multiple'), ['A', 'B', 'D']);
      assert.deepEqual(parseAiResponse('[A, B, D]', 'multiple'), ['A', 'B', 'D']);
      assert.deepEqual(parseAiResponse('[A、B、D]', 'multiple'), ['A', 'B', 'D']);

      // 3. 带分号 / 换行 / 点号 / 选项内逗号 / 句末中文句号的混合输出
      assert.deepEqual(
        parseAiResponse('答案：A. 坚持全面从严治党；B. 坚持不忘初心；D. 坚持一体推进', 'multiple'),
        ['A', 'B', 'D']
      );
      assert.deepEqual(
        parseAiResponse(
          '答案：A. 坚持全面从严治党；B. 坚持不忘初心，牢记使命；D. 坚持一体推进',
          'multiple'
        ),
        ['A', 'B', 'D']
      );
      assert.deepEqual(
        parseAiResponse('正确答案：\nA. 选项1\nB. 选项2\nD. 选项4', 'multiple'),
        ['A', 'B', 'D']
      );
      assert.deepEqual(
        parseAiResponse('答案：A、B、D。解析如下：选项C不对', 'multiple'),
        ['A', 'B', 'D']
      );

      // 4. 标题加粗前缀
      assert.deepEqual(parseAiResponse('**答案**：**A**、**B**、**D**', 'multiple'), ['A', 'B', 'D']);
      assert.deepEqual(parseAiResponse('【最终答案】：A, B, D', 'multiple'), ['A', 'B', 'D']);

      // 5. 严格大写紧凑字母 vs 小写英文单词防护
      assert.deepEqual(parseAiResponse('正确答案：ABD', 'multiple'), ['A', 'B', 'D']);
      assert.deepEqual(parseAiResponse('答案: AC', 'multiple'), ['A', 'C']);
      assert.deepEqual(
        parseAiResponse('正确答案：each 都要分析，最终选 A、C', 'multiple'),
        ['A', 'C']
      );
      assert.deepEqual(
        parseAiResponse('答案：bad，实际选 A、B', 'multiple'),
        ['A', 'B']
      );

      // 6. 回归：第 20 关医学化学术语与 single / judge 行为 100% 保留
      assert.deepEqual(parseAiResponse('答案: **A. 含有 B 族维生素**', 'single'), ['A']);
      assert.deepEqual(parseAiResponse('经过分析，答案是: A. 本品含有A型肉毒毒素', 'single'), ['A']);
      assert.deepEqual(parseAiResponse('最终结论: D. 属于D-构型分子', 'single'), ['D']);
      assert.deepEqual(parseAiResponse('本题选择 A. 肽链与C环结构', 'single'), ['A']);
      assert.deepEqual(parseAiResponse('["A", "B"]', 'single'), ['A']);
      assert.deepEqual(parseAiResponse('结论：对', 'judge'), ['对']);
      assert.deepEqual(parseAiResponse('答案：B', 'judge'), ['B']);
    });

    it('24.3 client.ts recheckMultipleChoiceIfSingle 全路径防漏复核与安全降级测试', async () => {
      const prevXhr = (globalThis as any).GM_xmlhttpRequest;
      const prevKey = store.config.aiApiKey;
      const prevEffort = store.config.reasoningEffort;

      store.config.aiApiKey = 'sk-test-recheck';
      store.config.reasoningEffort = 'none';

      const baseMultiQuestion: any = {
        id: 'q-multi-1',
        index: 1,
        type: 'multiple',
        title: '以下属于中国共产党三大优良作风的有',
        options: ['理论联系实际', '密切联系群众', '独立自主', '批评与自我批评'],
        status: 'searching'
      };

      try {
        // 场景 1：Attempt 1 返回单选 ["A"] -> 触发二次复核并采纳完整结果 ["A", "B", "D"]
        let reqBodies: any[] = [];
        (globalThis as any).GM_xmlhttpRequest = (opts: any) => {
          const parsedBody = JSON.parse(opts.data);
          reqBodies.push(parsedBody);
          const idx = reqBodies.length;
          setTimeout(() => {
            opts.onload({
              status: 200,
              responseText: JSON.stringify({
                choices: [{ message: { content: idx === 1 ? '["A"]' : '["A", "B", "D"]' } }]
              })
            });
          }, 5);
        };
        const res1 = await queryAiAnswer(baseMultiQuestion);
        assert.deepEqual(res1, ['A', 'B', 'D']);
        assert.equal(reqBodies.length, 2);
        assert.ok(
          JSON.stringify(reqBodies[1].messages).includes('逐项重新核对'),
          '二次复核必须包含逐项复核提示词'
        );

        // 场景 2：识图纯文本降级成功但仅返回 ["A"] -> 触发纯文本二次复核并采纳 ["A", "B", "D"]
        reqBodies = [];
        const imgQuestion = { ...baseMultiQuestion, images: ['data:image/png;base64,abc'] };
        (globalThis as any).GM_xmlhttpRequest = (opts: any) => {
          const parsedBody = JSON.parse(opts.data);
          reqBodies.push(parsedBody);
          const idx = reqBodies.length;
          setTimeout(() => {
            if (idx === 1) {
              opts.onload({ status: 413, responseText: 'payload too large' });
            } else {
              opts.onload({
                status: 200,
                responseText: JSON.stringify({
                  choices: [{ message: { content: idx === 2 ? '["A"]' : '["A", "B", "D"]' } }]
                })
              });
            }
          }, 5);
        };
        const resVisionFallback = await queryAiAnswer(imgQuestion);
        assert.deepEqual(resVisionFallback, ['A', 'B', 'D']);
        assert.equal(reqBodies.length, 3);
        assert.ok(
          typeof reqBodies[2].messages[1].content === 'string',
          '识图降级后的二次复核必须保持纯文本'
        );

        // 场景 3：Attempt 2 成功但仅返回 ["A"] -> 触发二次复核并采纳 ["A", "C"]
        reqBodies = [];
        (globalThis as any).GM_xmlhttpRequest = (opts: any) => {
          const parsedBody = JSON.parse(opts.data);
          reqBodies.push(parsedBody);
          const idx = reqBodies.length;
          setTimeout(() => {
            if (idx === 1) {
              opts.onload({ status: 500, responseText: 'server error' });
            } else {
              opts.onload({
                status: 200,
                responseText: JSON.stringify({
                  choices: [{ message: { content: idx === 2 ? '["A"]' : '["A", "C"]' } }]
                })
              });
            }
          }, 5);
        };
        const resAttempt2 = await queryAiAnswer(baseMultiQuestion);
        assert.deepEqual(resAttempt2, ['A', 'C']);
        assert.equal(reqBodies.length, 3);

        // 场景 4：Attempt 3 成功但仅返回 ["B"] -> 触发二次复核并采纳 ["B", "D"]
        reqBodies = [];
        (globalThis as any).GM_xmlhttpRequest = (opts: any) => {
          const parsedBody = JSON.parse(opts.data);
          reqBodies.push(parsedBody);
          const idx = reqBodies.length;
          setTimeout(() => {
            if (idx <= 2) {
              opts.onload({ status: 502, responseText: 'bad gateway' });
            } else {
              opts.onload({
                status: 200,
                responseText: JSON.stringify({
                  choices: [{ message: { content: idx === 3 ? '["B"]' : '["B", "D"]' } }]
                })
              });
            }
          }, 5);
        };
        const resAttempt3 = await queryAiAnswer(baseMultiQuestion);
        assert.deepEqual(resAttempt3, ['B', 'D']);
        assert.equal(reqBodies.length, 4);

        // 场景 5a：复核失败（HTTP 500/网络异常）-> 安全降级回原 ["A"]
        reqBodies = [];
        (globalThis as any).GM_xmlhttpRequest = (opts: any) => {
          reqBodies.push(JSON.parse(opts.data));
          const idx = reqBodies.length;
          setTimeout(() => {
            if (idx === 1) {
              opts.onload({
                status: 200,
                responseText: JSON.stringify({ choices: [{ message: { content: '["A"]' } }] })
              });
            } else {
              opts.onerror(new Error('network down'));
            }
          }, 5);
        };
        const resRecheckFail = await queryAiAnswer(baseMultiQuestion);
        assert.deepEqual(resRecheckFail, ['A']);

        // 场景 5b：复核仍仅返回 1 项 -> 安全保留原 ["A"]
        reqBodies = [];
        (globalThis as any).GM_xmlhttpRequest = (opts: any) => {
          reqBodies.push(JSON.parse(opts.data));
          const idx = reqBodies.length;
          setTimeout(() => {
            opts.onload({
              status: 200,
              responseText: JSON.stringify({
                choices: [{ message: { content: idx === 1 ? '["A"]' : '["B"]' } }]
              })
            });
          }, 5);
        };
        const resRecheckSingle = await queryAiAnswer(baseMultiQuestion);
        assert.deepEqual(resRecheckSingle, ['A']);

        // 场景 6：拒答文案、选项不足 2 个、single/judge 均不触发多余复核请求
        const checkNoRecheck = async (q: any, content: string) => {
          reqBodies = [];
          (globalThis as any).GM_xmlhttpRequest = (opts: any) => {
            reqBodies.push(JSON.parse(opts.data));
            setTimeout(() => {
              opts.onload({
                status: 200,
                responseText: JSON.stringify({ choices: [{ message: { content } }] })
              });
            }, 5);
          };
          const out = await queryAiAnswer(q);
          assert.equal(reqBodies.length, 1, '不应触发多余复核请求');
          return out;
        };

        await checkNoRecheck(baseMultiQuestion, '["没有提供图片，无法判断"]');
        await checkNoRecheck({ ...baseMultiQuestion, options: ['唯一选项'] }, '["A"]');
        await checkNoRecheck({ ...baseMultiQuestion, type: 'single' }, '["A"]');
        await checkNoRecheck({ ...baseMultiQuestion, type: 'judge' }, '["对"]');
      } finally {
        (globalThis as any).GM_xmlhttpRequest = prevXhr;
        store.config.aiApiKey = prevKey;
        store.config.reasoningEffort = prevEffort;
      }
    });

    it('24.4 findNextQuestionBtn 精准定位下一题按钮并严格排除非目标与不可见控件', () => {
      const makeBtn = (opts: {
        id?: string;
        text?: string;
        value?: string;
        tag?: string;
        onclick?: string;
        cls?: string[];
        closestHits?: string[];
        disabled?: boolean;
        ariaDisabled?: string;
        display?: string;
        visibility?: string;
        computedDisplay?: string;
      }) => {
        const clsList = opts.cls || [];
        const tagName = (opts.tag || 'A').toUpperCase();
        return {
          id: opts.id || '',
          tagName,
          innerText: opts.text ?? '',
          textContent: opts.text ?? '',
          value: opts.value ?? '',
          disabled: Boolean(opts.disabled),
          style: {
            display: opts.display || '',
            visibility: opts.visibility || ''
          },
          classList: {
            contains: (c: string) => clsList.includes(c)
          },
          hasAttribute: (k: string) => (k === 'disabled' ? Boolean(opts.disabled) : false),
          getAttribute: (k: string) => {
            if (k === 'onclick') return opts.onclick || '';
            if (k === 'aria-disabled') return opts.ariaDisabled || '';
            if (k === 'value') return opts.value ?? '';
            return null;
          },
          closest: (sel: string) =>
            (opts.closestHits || []).some((hit) => sel.includes(hit)) ? {} : null,
          _computedDisplay: opts.computedDisplay
        } as any;
      };

      const makeDoc = (group1: any[], group2: any[] = []) =>
        ({
          defaultView: {
            getComputedStyle: (el: any) => ({
              display: el._computedDisplay || el.style?.display || 'inline-block',
              visibility: el.style?.visibility || 'visible'
            })
          },
          querySelectorAll: (sel: string) => {
            if (sel.includes('.nextDiv')) return group1;
            return group2;
          }
        }) as any;

      // 1. 排除悬浮窗内部、下一章、上一题、负向参数、disabled、display:none 后命中真正 #nextBtn
      const panelBtn = makeBtn({ text: '下一题', closestHits: ['kasa-helper-panel'] });
      const cardBtn = makeBtn({ text: '下一题', closestHits: ['.kasa-card'] });
      const nextChapterBtn = makeBtn({ text: '下一节', cls: ['nextChapter'] });
      const prevBtn = makeBtn({ text: '上一题', onclick: "getTheNextQuestion('exam-1', -1)" });
      const disabledBtn = makeBtn({ text: '下一题', cls: ['disabled'] });
      const ariaDisabledBtn = makeBtn({ text: '下一题', ariaDisabled: 'true' });
      const hiddenBtn = makeBtn({ text: '下一题', display: 'none' });
      const computedHiddenBtn = makeBtn({ text: '下一题', computedDisplay: 'none' });
      const realNextBtn = makeBtn({ id: 'nextBtn', text: '保存并下一题' });

      const found1 = findNextQuestionBtn(
        makeDoc([
          panelBtn,
          cardBtn,
          nextChapterBtn,
          prevBtn,
          disabledBtn,
          ariaDisabledBtn,
          hiddenBtn,
          computedHiddenBtn,
          realNextBtn
        ])
      );
      assert.equal(found1, realNextBtn);

      // 2. 命中 onclick="getTheNextQuestion('exam-1', 1)"
      const onclickBtn = makeBtn({ text: '继续', onclick: "getTheNextQuestion('exam-1', 1)" });
      assert.equal(findNextQuestionBtn(makeDoc([onclickBtn])), onclickBtn);

      // 3. 兜底选择器组命中 <input type="button" value="下一题">
      const inputBtn = makeBtn({ tag: 'INPUT', value: '下一题' });
      assert.equal(findNextQuestionBtn(makeDoc([], [prevBtn, inputBtn])), inputBtn);
    });

    it('24.5 doQuizTask 多页单题考试集成测试 — 场景 A：AJAX 3 题翻页、多选、自动提交及 cancelAutoSubmit 全程传递', async () => {
      const prevXhr = (globalThis as any).GM_xmlhttpRequest;
      const prevSession = (globalThis as any).sessionStorage;
      const prevKey = store.config.aiApiKey;
      const prevAutoSubmit = store.config.autoSubmitWork;

      const sMap = new Map<string, string>();
      (globalThis as any).sessionStorage = {
        getItem: (k: string) => sMap.get(k) ?? null,
        setItem: (k: string, v: string) => sMap.set(k, String(v)),
        removeItem: (k: string) => sMap.delete(k),
        clear: () => sMap.clear()
      };

      const buildOptionEl = (letter: string, text: string) => {
        const inputEl: any = {
          type: 'checkbox',
          value: letter,
          checked: false,
          dispatchEvent: () => true
        };
        const numEl: any = {
          classList: { contains: () => false, add: () => {}, remove: () => {} },
          getAttribute: () => letter,
          innerText: letter,
          textContent: letter
        };
        const el: any = {
          innerText: `${letter}. ${text}`,
          textContent: `${letter}. ${text}`,
          selected: false,
          getAttribute: () => null,
          setAttribute: (k: string, v: string) => {
            if (k === 'aria-checked' && v === 'true') el.selected = true;
          },
          classList: {
            contains: (c: string) => el.selected && (c === 'check_answer_dx' || c === 'check_answer'),
            add: () => {},
            remove: () => {}
          },
          contains: () => false,
          scrollIntoView: () => {},
          click: () => {
            el.selected = true;
            inputEl.checked = true;
          },
          dispatchEvent: () => true,
          querySelector: (sel: string) => {
            if (sel.includes('num_option')) return numEl;
            if (sel.includes('input')) return inputEl;
            if (sel.includes('.answer_p')) return { innerText: text, textContent: text };
            return null;
          }
        };
        return { el, inputEl };
      };

      const makeSinglePageTimu = (opts: {
        id: string;
        title: string;
        answered?: boolean;
        options?: Array<{ letter: string; text: string }>;
        noInputFill?: boolean;
      }) => {
        const optionObjs = (opts.options || []).map((o) => buildOptionEl(o.letter, o.text));
        const node: any = {
          style: {},
          getAttribute: (k: string) => (k === 'data-id' ? opts.id : null),
          closest: () => null,
          contains: () => false,
          cloneNode: function() {
            return this;
          },
          querySelector: (sel: string) => {
            if (sel.includes('.mark_name') || sel.includes('.Zy_TItle')) {
              return { innerText: opts.title, textContent: opts.title };
            }
            if (opts.answered && (sel.includes(':checked') || sel.includes('.check_answer'))) {
              return { checked: true };
            }
            if (sel.includes(':checked') || sel.includes('.check_answer')) return null;
            if (opts.options?.length && (sel.includes('input') || sel.includes('li'))) {
              return optionObjs[0].el;
            }
            return null;
          },
          querySelectorAll: (sel: string) => {
            if (sel === 'ul.Zy_ulTop, ul.Zy_ulBottom, ul.options, ul.mark_letter, .stem_answer') {
              return opts.options?.length ? [{}] : [];
            }
            if (sel.includes('input[type="checkbox"]')) {
              return opts.title.includes('多选') ? optionObjs.map((o) => o.inputEl) : [];
            }
            if (sel.includes('input[type="radio"]')) {
              return !opts.title.includes('多选') && opts.options?.length
                ? optionObjs.map((o) => o.inputEl)
                : [];
            }
            if (sel.includes('li') && opts.options?.length) {
              return optionObjs.map((o) => o.el);
            }
            if (opts.noInputFill && (sel.includes('textarea') || sel.includes('input'))) {
              return [];
            }
            return [];
          }
        };
        return { node, optionObjs };
      };

      try {
        store.config.aiApiKey = 'sk-test-ajax-exam';
        store.config.autoSubmitWork = true;
        store.acknowledgeAllErrors();

        // 子场景 A1：Q1 已答跳过 -> Q2 多选题选 A/B/D -> Q3 单选 -> 末题无下一题且自动提交
        let currentPage = 1;
        let submitClicked = 0;
        let saveClicked = 0;

        const q1 = makeSinglePageTimu({
          id: 'exam-q1',
          title: '1. (单选题, 2.0 分) 已作答第一题',
          answered: true,
          options: [
            { letter: 'A', text: '选项一' },
            { letter: 'B', text: '选项二' }
          ]
        });
        const q2 = makeSinglePageTimu({
          id: 'exam-q2',
          title: '2. (多选题, 6.0 分) 以下属于正确答案的有',
          options: [
            { letter: 'A', text: '核心一' },
            { letter: 'B', text: '核心二' },
            { letter: 'C', text: '干扰项' },
            { letter: 'D', text: '核心四' }
          ]
        });
        const q3 = makeSinglePageTimu({
          id: 'exam-q3',
          title: '3. (单选题, 2.0 分) 最终单选收尾题',
          options: [
            { letter: 'A', text: '错误项' },
            { letter: 'B', text: '正确收尾项' }
          ]
        });

        const nextBtnA1: any = {
          tagName: 'A',
          innerText: '下一题',
          textContent: '下一题',
          style: {},
          classList: { contains: () => false },
          hasAttribute: () => false,
          getAttribute: () => null,
          closest: () => null,
          click: () => {
            currentPage++;
          }
        };
        const submitBtnA1: any = {
          click: () => {
            submitClicked++;
          }
        };
        const saveBtnA1: any = {
          click: () => {
            saveClicked++;
          }
        };

        const docA1: any = {
          defaultView: {
            addEventListener: () => {},
            removeEventListener: () => {},
            getComputedStyle: () => ({ display: 'block', visibility: 'visible' })
          },
          querySelector: (sel: string) => {
            if (sel.includes('.TiMu') || sel.includes('.questionLi')) {
              return currentPage === 1 ? q1.node : currentPage === 2 ? q2.node : q3.node;
            }
            if (sel.includes('btnSubmit') || sel.includes('#submitBtn')) return submitBtnA1;
            if (sel.includes('btnSave') || sel.includes('#saveBtn')) return saveBtnA1;
            return null;
          },
          querySelectorAll: (sel: string) => {
            if (sel.includes('.questionLi') || sel.includes('.TiMu')) {
              return [currentPage === 1 ? q1.node : currentPage === 2 ? q2.node : q3.node];
            }
            if (sel.includes('.nextDiv') || sel.includes('#nextBtn')) {
              return currentPage < 3 ? [nextBtnA1] : [];
            }
            return [];
          }
        };

        (globalThis as any).GM_xmlhttpRequest = (opts: any) => {
          const body = JSON.parse(opts.data);
          const promptTxt = JSON.stringify(body.messages);
          setTimeout(() => {
            let content = '["B"]';
            if (promptTxt.includes('以下属于正确答案的有')) {
              content = '["A、B、D"]';
            }
            opts.onload({
              status: 200,
              responseText: JSON.stringify({ choices: [{ message: { content } }] })
            });
          }, 5);
        };

        await doQuizTask(null, docA1, {
          signal: new AbortController().signal,
          isCurrent: () => true
        });

        assert.equal(currentPage, 3, '应自动从第1页翻页至第3页');
        assert.equal(store.questions.length, 3, '三页题目必须全部记录到 store.questions');
        assert.equal(q2.optionObjs[0].inputEl.checked, true, '多选题 A 应被选中');
        assert.equal(q2.optionObjs[1].inputEl.checked, true, '多选题 B 应被选中');
        assert.equal(q2.optionObjs[2].inputEl.checked, false, '多选题干扰项 C 不应被选中');
        assert.equal(q2.optionObjs[3].inputEl.checked, true, '多选题 D 应被选中');
        assert.equal(q3.optionObjs[1].inputEl.checked, true, '第3题 B 应被选中');
        assert.equal(submitClicked, 1, '全部成功时末题应自动提交');
        assert.equal(saveClicked, 0);
        assert.equal(getExamAutoResumeState(), null, '末题结束后必须清空续跑状态');

        // 子场景 A2：Q2 无输入框失败置 cancelAutoSubmit=true，翻页到 Q3 完成后仍绝不自动提交
        currentPage = 1;
        submitClicked = 0;
        saveClicked = 0;
        const q2Fail = makeSinglePageTimu({
          id: 'exam-q2-fail',
          title: '2. (填空题, 4.0 分) 无输入框导致失败的题目',
          noInputFill: true
        });
        const q3Clean = makeSinglePageTimu({
          id: 'exam-q3-clean',
          title: '3. (单选题, 2.0 分) 后续正常单选题',
          options: [
            { letter: 'A', text: '错' },
            { letter: 'B', text: '对的选项' }
          ]
        });

        const docA2: any = {
          ...docA1,
          querySelector: (sel: string) => {
            if (sel.includes('.TiMu') || sel.includes('.questionLi')) {
              return currentPage === 1 ? q1.node : currentPage === 2 ? q2Fail.node : q3Clean.node;
            }
            if (sel.includes('btnSubmit') || sel.includes('#submitBtn')) return submitBtnA1;
            if (sel.includes('btnSave') || sel.includes('#saveBtn')) return saveBtnA1;
            return null;
          },
          querySelectorAll: (sel: string) => {
            if (sel.includes('.questionLi') || sel.includes('.TiMu')) {
              return [currentPage === 1 ? q1.node : currentPage === 2 ? q2Fail.node : q3Clean.node];
            }
            if (sel.includes('.nextDiv') || sel.includes('#nextBtn')) {
              return currentPage < 3 ? [nextBtnA1] : [];
            }
            return [];
          }
        };

        await doQuizTask(null, docA2, {
          signal: new AbortController().signal,
          isCurrent: () => true
        });

        assert.equal(currentPage, 3);
        assert.equal(submitClicked, 0, '中间题目失败后 cancelAutoSubmit 必须全程传递，绝不触发自动提交');
        assert.equal(saveClicked, 1, '取消自动提交后应改为点击暂存按钮');
      } finally {
        (globalThis as any).GM_xmlhttpRequest = prevXhr;
        (globalThis as any).sessionStorage = prevSession;
        store.config.aiApiKey = prevKey;
        store.config.autoSubmitWork = prevAutoSubmit;
      }
    });

    it('24.6 doQuizTask 场景 B：严格过滤隐藏题与 .topicNumber_list 答题卡容器中的 div[data-id]', async () => {
      const prevXhr = (globalThis as any).GM_xmlhttpRequest;
      const prevKey = store.config.aiApiKey;
      store.config.aiApiKey = 'sk-test-scene-b';

      try {
        let aiCalledCount = 0;
        let hiddenClicked = false;
        let cardClicked = false;
        let visibleClicked = false;

        const hiddenTimu: any = {
          style: { display: 'none' },
          getAttribute: (k: string) => (k === 'data-id' ? 'hidden-q1' : null),
          closest: () => null,
          contains: () => false,
          cloneNode: function() { return this; },
          querySelector: (sel: string) => {
            if (sel.includes('mark_name') || sel.includes('Zy_TItle')) {
              return { innerText: '1. (单选题) 隐藏题目不应作答' };
            }
            if (sel.includes('input') || sel.includes('li')) return {};
            return null;
          },
          querySelectorAll: (sel: string) => {
            if (sel === 'ul.Zy_ulTop, ul.Zy_ulBottom, ul.options, ul.mark_letter, .stem_answer') return [{}];
            if (sel.includes('li')) {
              return [
                {
                  innerText: 'A. 隐藏选项',
                  textContent: 'A. 隐藏选项',
                  getAttribute: () => null,
                  setAttribute: () => {},
                  contains: () => false,
                  classList: { contains: () => false, add: () => {} },
                  querySelector: () => null,
                  click: () => { hiddenClicked = true; }
                }
              ];
            }
            return [];
          }
        };

        const answerCardNode: any = {
          style: {},
          getAttribute: (k: string) => (k === 'data-id' ? 'card-1' : null),
          closest: (sel: string) => (sel.includes('.topicNumber_list') ? {} : null),
          contains: () => false,
          querySelector: () => ({ click: () => { cardClicked = true; } }),
          querySelectorAll: () => [{ click: () => { cardClicked = true; } }]
        };

        const visibleTimu: any = {
          style: {},
          getAttribute: (k: string) => (k === 'data-id' ? 'visible-q2' : null),
          closest: () => null,
          contains: () => false,
          cloneNode: function() { return this; },
          querySelector: (sel: string) => {
            if (sel.includes('mark_name') || sel.includes('Zy_TItle')) {
              return { innerText: '2. (单选题) 唯一可见题目' };
            }
            if (sel.includes(':checked') || sel.includes('.check_answer')) return null;
            if (sel.includes('input') || sel.includes('li')) return {};
            return null;
          },
          querySelectorAll: (sel: string) => {
            if (sel === 'ul.Zy_ulTop, ul.Zy_ulBottom, ul.options, ul.mark_letter, .stem_answer') return [{}];
            if (sel.includes('li')) {
              return [
                {
                  innerText: 'A. 可见选项',
                  textContent: 'A. 可见选项',
                  getAttribute: () => null,
                  setAttribute: () => {},
                  contains: () => false,
                  classList: { contains: () => false, add: () => {} },
                  querySelector: () => null,
                  click: () => { visibleClicked = true; }
                }
              ];
            }
            return [];
          }
        };

        const mockDoc: any = {
          defaultView: {
            getComputedStyle: (el: any) => ({
              display: el.style?.display || 'block',
              visibility: 'visible'
            })
          },
          querySelector: (sel: string) => {
            if (sel.includes('.questionLi') || sel.includes('.TiMu') || sel.includes('div[data-id]')) {
              return visibleTimu;
            }
            return null;
          },
          querySelectorAll: (sel: string) => {
            if (sel.includes('div[data-id]') || sel.includes('.TiMu')) {
              return [hiddenTimu, answerCardNode, visibleTimu];
            }
            return [];
          }
        };

        (globalThis as any).GM_xmlhttpRequest = (opts: any) => {
          aiCalledCount++;
          setTimeout(() => {
            opts.onload({
              status: 200,
              responseText: JSON.stringify({ choices: [{ message: { content: '["A"]' } }] })
            });
          }, 5);
        };

        await doQuizTask(null, mockDoc, {
          signal: new AbortController().signal,
          isCurrent: () => true
        });

        assert.equal(aiCalledCount, 1, '仅可请求 1 次 AI（唯一可见题）');
        assert.equal(visibleClicked, true, '必须点击唯一可见题选项');
        assert.equal(hiddenClicked, false, '绝不可点击隐藏题选项');
        assert.equal(cardClicked, false, '绝不可将 .topicNumber_list 中的 div[data-id] 当成题目');
        assert.equal(store.questions.length, 1);
        assert.equal(store.questions[0].id, 'visible-q2');
      } finally {
        (globalThis as any).GM_xmlhttpRequest = prevXhr;
        store.config.aiApiKey = prevKey;
      }
    });

    it('24.7 doQuizTask 场景 C：点击下一题后页面卡死未变化时置 paused、不调用 submitBtn', async () => {
      const prevXhr = (globalThis as any).GM_xmlhttpRequest;
      const prevSession = (globalThis as any).sessionStorage;
      const prevKey = store.config.aiApiKey;
      const prevAutoSubmit = store.config.autoSubmitWork;

      const sMap = new Map<string, string>();
      (globalThis as any).sessionStorage = {
        getItem: (k: string) => sMap.get(k) ?? null,
        setItem: (k: string, v: string) => sMap.set(k, String(v)),
        removeItem: (k: string) => sMap.delete(k),
        clear: () => sMap.clear()
      };

      try {
        store.config.aiApiKey = 'sk-test-stuck';
        store.config.autoSubmitWork = true;

        let nextClicks = 0;
        let submitClicks = 0;

        const stuckTimu: any = {
          style: {},
          getAttribute: (k: string) => (k === 'data-id' ? 'stuck-q1' : null),
          closest: () => null,
          contains: () => false,
          cloneNode: function() { return this; },
          querySelector: (sel: string) => {
            if (sel.includes('mark_name') || sel.includes('Zy_TItle')) {
              return { innerText: '1. (单选题) 翻页卡死测试题' };
            }
            if (sel.includes(':checked') || sel.includes('.check_answer')) return null;
            if (sel.includes('input') || sel.includes('li')) return {};
            return null;
          },
          querySelectorAll: (sel: string) => {
            if (sel === 'ul.Zy_ulTop, ul.Zy_ulBottom, ul.options, ul.mark_letter, .stem_answer') return [{}];
            if (sel.includes('li')) {
              return [
                {
                  innerText: 'A. 选项',
                  textContent: 'A. 选项',
                  getAttribute: () => null,
                  setAttribute: () => {},
                  contains: () => false,
                  classList: { contains: () => false, add: () => {} },
                  querySelector: () => null,
                  click: () => {}
                }
              ];
            }
            return [];
          }
        };

        const stuckNextBtn: any = {
          tagName: 'A',
          innerText: '下一题',
          textContent: '下一题',
          style: {},
          classList: { contains: () => false },
          hasAttribute: () => false,
          getAttribute: () => null,
          closest: () => null,
          click: () => {
            nextClicks++;
          }
        };

        const mockDoc: any = {
          defaultView: {
            addEventListener: () => {},
            removeEventListener: () => {},
            getComputedStyle: () => ({ display: 'block', visibility: 'visible' })
          },
          querySelector: (sel: string) => {
            if (sel.includes('.questionLi') || sel.includes('.TiMu')) return stuckTimu;
            if (sel.includes('btnSubmit') || sel.includes('#submitBtn')) {
              return { click: () => { submitClicks++; } };
            }
            return null;
          },
          querySelectorAll: (sel: string) => {
            if (sel.includes('.questionLi') || sel.includes('.TiMu')) return [stuckTimu];
            if (sel.includes('.nextDiv') || sel.includes('#nextBtn')) return [stuckNextBtn];
            return [];
          }
        };

        (globalThis as any).GM_xmlhttpRequest = (opts: any) => {
          setTimeout(() => {
            opts.onload({
              status: 200,
              responseText: JSON.stringify({ choices: [{ message: { content: '["A"]' } }] })
            });
          }, 5);
        };

        await doQuizTask(null, mockDoc, {
          signal: new AbortController().signal,
          isCurrent: () => true
        });

        assert.equal(nextClicks, 1, '应尝试点击一次下一题');
        assert.equal(submitClicks, 0, '翻页卡死退出时绝不可调用 submitBtn');
        assert.equal(store.progress.status, 'paused');
        assert.equal(store.progress.currentTime, '翻页未切换已停止');
        assert.equal(getExamAutoResumeState(), null, '卡死退出必须清除续跑态');
      } finally {
        (globalThis as any).GM_xmlhttpRequest = prevXhr;
        (globalThis as any).sessionStorage = prevSession;
        store.config.aiApiKey = prevKey;
        store.config.autoSubmitWork = prevAutoSubmit;
      }
    });

    it('24.8 getExamScope 与跨页续跑状态 (set/get/clear) 同作用域匹配、跨课程隔离与 10 分钟 TTL 过期清理', () => {
      const prevWin = (globalThis as any).window;
      const prevSession = (globalThis as any).sessionStorage;
      const sMap = new Map<string, string>();
      (globalThis as any).sessionStorage = {
        getItem: (k: string) => sMap.get(k) ?? null,
        setItem: (k: string, v: string) => sMap.set(k, String(v)),
        removeItem: (k: string) => sMap.delete(k),
        clear: () => sMap.clear()
      };

      try {
        // 1. 同作用域下 questionId / pageNum / index 变化仍精准命中
        (globalThis as any).window = {
          ...prevWin,
          location: {
            pathname: '/exam-ans/exam/test/reVersionTestStartNew',
            search: '?courseId=101&examId=202&questionId=11&pageNum=1&index=0'
          }
        };
        const scope1 = getExamScope();
        setExamAutoResumeState({ cancelAutoSubmit: true, solvedCount: 5 });

        (globalThis as any).window = {
          ...prevWin,
          location: {
            pathname: '/exam-ans/exam/test/reVersionTestStartNew',
            search: '?courseId=101&examId=202&questionId=12&pageNum=2&index=1'
          }
        };
        assert.equal(getExamScope(), scope1);
        const stateHit = getExamAutoResumeState();
        assert.ok(stateHit);
        assert.equal(stateHit!.cancelAutoSubmit, true);
        assert.equal(stateHit!.solvedCount, 5);

        // setExamAutoResumeState 保留 cancelAutoSubmit 的 OR 语义
        setExamAutoResumeState({ cancelAutoSubmit: false, solvedCount: 6 });
        assert.equal(getExamAutoResumeState()?.cancelAutoSubmit, true);
        assert.equal(getExamAutoResumeState()?.solvedCount, 6);

        // 2. 不同 courseId 或不同 pathname 严格隔离
        (globalThis as any).window = {
          ...prevWin,
          location: {
            pathname: '/exam-ans/exam/test/reVersionTestStartNew',
            search: '?courseId=999&examId=202&questionId=12'
          }
        };
        assert.equal(getExamAutoResumeState(), null, '不同 courseId 必须隔离');

        (globalThis as any).window = {
          ...prevWin,
          location: {
            pathname: '/exam-ans/exam/test/otherExam',
            search: '?courseId=101&examId=202'
          }
        };
        assert.equal(getExamAutoResumeState(), null, '不同 pathname 必须隔离');

        // 3. 10 分钟 TTL 过期自动清理
        (globalThis as any).window = {
          ...prevWin,
          location: {
            pathname: '/exam-ans/exam/test/reVersionTestStartNew',
            search: '?courseId=101&examId=202'
          }
        };
        setExamAutoResumeState({
          startedAt: Date.now() - (10 * 60 * 1000 + 1000),
          solvedCount: 2
        });
        assert.equal(getExamAutoResumeState(), null, '超过 10 分钟 TTL 必须返回 null');
        assert.equal(sMap.size, 0, 'TTL 过期后必须自动清理 sessionStorage');

        // 4. clearExamAutoResumeState 显式清理
        setExamAutoResumeState({ solvedCount: 1 });
        assert.ok(getExamAutoResumeState());
        clearExamAutoResumeState();
        assert.equal(getExamAutoResumeState(), null);
      } finally {
        (globalThis as any).window = prevWin;
        (globalThis as any).sessionStorage = prevSession;
      }
    });

    it('24.9 ChapterScheduler 跨页自动续跑、pauseQuiz 清理及心跳不覆盖已完成进度', async () => {
      const prevWin = (globalThis as any).window;
      const prevDoc = (globalThis as any).document;
      const prevSession = (globalThis as any).sessionStorage;
      const prevXhr = (globalThis as any).GM_xmlhttpRequest;
      const prevKey = store.config.aiApiKey;

      const sMap = new Map<string, string>();
      (globalThis as any).sessionStorage = {
        getItem: (k: string) => sMap.get(k) ?? null,
        setItem: (k: string, v: string) => sMap.set(k, String(v)),
        removeItem: (k: string) => sMap.delete(k),
        clear: () => sMap.clear()
      };

      const makeStandaloneDoc = (id: string, titleText: string) => {
        const timuEl: any = {
          style: {},
          getAttribute: (k: string) => (k === 'data-id' ? id : null),
          closest: () => null,
          contains: () => false,
          cloneNode: function() { return this; },
          querySelector: (sel: string) => {
            if (sel.includes('mark_name') || sel.includes('Zy_TItle')) {
              return { innerText: titleText, textContent: titleText };
            }
            if (sel.includes(':checked') || sel.includes('.check_answer')) return null;
            if (sel.includes('input') || sel.includes('li')) return {};
            return null;
          },
          querySelectorAll: (sel: string) => {
            if (sel === 'ul.Zy_ulTop, ul.Zy_ulBottom, ul.options, ul.mark_letter, .stem_answer') return [{}];
            if (sel.includes('li')) {
              return [
                {
                  innerText: 'A. 选项A',
                  textContent: 'A. 选项A',
                  getAttribute: () => null,
                  setAttribute: () => {},
                  contains: () => false,
                  classList: { contains: () => false, add: () => {} },
                  querySelector: () => null,
                  click: () => {}
                }
              ];
            }
            return [];
          }
        };
        return {
          title: '独立考试页面',
          defaultView: {
            getComputedStyle: () => ({ display: 'block', visibility: 'visible' })
          },
          querySelector: (sel: string) => {
            if (sel.includes('.questionLi') || sel.includes('.TiMu') || sel.includes('div[data-id]')) {
              return timuEl;
            }
            if (sel.includes('ul.Zy_ulTop') || sel.includes('input[type="radio"]')) return {};
            return null;
          },
          querySelectorAll: (sel: string) => {
            if (sel.includes('.questionLi') || sel.includes('.TiMu')) return [timuEl];
            return [];
          }
        };
      };

      try {
        store.config.aiApiKey = 'sk-test-scheduler';
        (globalThis as any).GM_xmlhttpRequest = (opts: any) => {
          setTimeout(() => {
            opts.onload({
              status: 200,
              responseText: JSON.stringify({ choices: [{ message: { content: '["A"]' } }] })
            });
          }, 5);
        };

        (globalThis as any).window = {
          ...prevWin,
          location: {
            href: 'https://mooc1.chaoxing.com/exam-ans/exam/test/reVersionTestStartNew?courseId=88',
            pathname: '/exam-ans/exam/test/reVersionTestStartNew',
            search: '?courseId=88'
          }
        };
        (globalThis as any).document = makeStandaloneDoc('sched-q1', '1. (单选题) 调度器测试题');

        // 1. triggerManualQuiz 完成后，心跳 runPipeline() 绝不把进度重置为 0% 未开始
        const scheduler1 = new ChapterScheduler();
        await scheduler1.triggerManualQuiz();
        assert.equal(store.progress.status, 'finished');
        assert.equal(store.progress.percent, 100);
        assert.equal(store.progress.currentTime, '已完成');

        await (scheduler1 as any).runPipeline();
        assert.equal(store.progress.status, 'finished', '心跳扫描绝不能重置已完成状态');
        assert.equal(store.progress.percent, 100, '心跳扫描绝不能把 100% 覆写为 0%');
        assert.equal(store.progress.currentTime, '已完成', '心跳扫描绝不能把已完成覆写为未开始');

        // 2. pauseQuiz 清空续跑状态并置 status = paused
        setExamAutoResumeState({ solvedCount: 3, cancelAutoSubmit: true });
        assert.ok(getExamAutoResumeState());
        scheduler1.pauseQuiz();
        assert.equal(getExamAutoResumeState(), null, 'pauseQuiz 必须清空续跑状态');
        assert.equal(store.progress.status, 'paused');

        // 3. 模拟页面重载（新 scheduler 实例）且 sessionStorage 含有效续跑态 -> runPipeline 自动触发 triggerManualQuiz
        store.updateProgress({ status: 'idle', percent: 0, currentTime: '未开始' });
        setExamAutoResumeState({ solvedCount: 2 });

        const scheduler2 = new ChapterScheduler();
        let resumedCalled = false;
        const origTrigger = scheduler2.triggerManualQuiz.bind(scheduler2);
        scheduler2.triggerManualQuiz = async () => {
          resumedCalled = true;
          return origTrigger();
        };

        await (scheduler2 as any).runPipeline();
        await new Promise((r) => setTimeout(r, 100));

        assert.equal(resumedCalled, true, '页面重载且含有效续跑态时，runPipeline 必须自动触发 triggerManualQuiz');
        // 等待触发后的异步答题收尾完成，防止残留定时污染后续环境
        for (let i = 0; i < 40 && store.isQuizRunning; i++) {
          await new Promise((r) => setTimeout(r, 100));
        }
        assert.equal(store.progress.status, 'finished');
      } finally {
        clearExamAutoResumeState();
        (globalThis as any).window = prevWin;
        (globalThis as any).document = prevDoc;
        (globalThis as any).sessionStorage = prevSession;
        (globalThis as any).GM_xmlhttpRequest = prevXhr;
        store.config.aiApiKey = prevKey;
      }
    });

    it('24.10 祖先不可见、双参数负向翻页、交卷排除及隐藏题干祖先过滤', async () => {
      const makeBtnWithAncestors = (opts: {
        id?: string;
        text?: string;
        onclick?: string;
        cls?: string[];
        parentElement?: any;
        computedDisplay?: string;
      }) => {
        const clsList = opts.cls || [];
        return {
          id: opts.id || '',
          tagName: 'A',
          innerText: opts.text ?? '',
          textContent: opts.text ?? '',
          disabled: false,
          style: { display: '', visibility: '' },
          parentElement: opts.parentElement ?? null,
          classList: { contains: (c: string) => clsList.includes(c) },
          hasAttribute: () => false,
          getAttribute: (k: string) => (k === 'onclick' ? opts.onclick || '' : null),
          closest: () => null,
          _computedDisplay: opts.computedDisplay
        } as any;
      };

      const makeDoc = (group1: any[], group2: any[] = []) =>
        ({
          defaultView: {
            getComputedStyle: (el: any) => ({
              display: el._computedDisplay || el.style?.display || 'block',
              visibility: el.style?.visibility || 'visible'
            })
          },
          querySelectorAll: (sel: string) => {
            if (sel.includes('.nextDiv')) return group1;
            return group2;
          }
        }) as any;

      // 1. 祖先容器 style.display === 'none' 或 getComputedStyle(ancestor).display === 'none' 时跳过内部 #nextBtn
      const hiddenParentStyle = { style: { display: 'none', visibility: '' }, parentElement: null };
      const hiddenParentComputed = { style: { display: '', visibility: '' }, _computedDisplay: 'none', parentElement: null };
      const btnInHiddenParent1 = makeBtnWithAncestors({ id: 'nextBtn', text: '下一题', parentElement: hiddenParentStyle });
      const btnInHiddenParent2 = makeBtnWithAncestors({ id: 'nextBtn', text: '下一题', parentElement: hiddenParentComputed });

      // 2. 双参数负向翻页（空文本）必须排除，正向翻页（空文本）正常命中
      const negTwoArgBtn = makeBtnWithAncestors({ text: '', onclick: "getTheNextQuestion('exam-1', -1)" });
      const posTwoArgBtn = makeBtnWithAncestors({ text: '', onclick: "getTheNextQuestion('exam-1', 1)" });

      // 3. 含 交卷 / 提交 / 结束考试 文案的按钮即使含 "下一题" 或 .nextBtn 类也必须排除
      const submitWordBtn1 = makeBtnWithAncestors({ text: '交卷并下一题', cls: ['nextBtn'] });
      const submitWordBtn2 = makeBtnWithAncestors({ text: '提交下一题', cls: ['nextBtn'] });
      const submitWordBtn3 = makeBtnWithAncestors({ text: '结束考试' });

      assert.equal(
        findNextQuestionBtn(
          makeDoc([btnInHiddenParent1, btnInHiddenParent2, negTwoArgBtn, submitWordBtn1, submitWordBtn2, submitWordBtn3])
        ),
        null,
        '祖先隐藏、负向翻页与交卷/提交按钮均不得被命中'
      );
      assert.equal(
        findNextQuestionBtn(makeDoc([btnInHiddenParent1, negTwoArgBtn, submitWordBtn1, posTwoArgBtn])),
        posTwoArgBtn,
        '正向双参数 getTheNextQuestion("exam-1", 1) 必须正常命中'
      );

      // 4. doQuizTask 过滤祖先存在 display:none 的题干容器，仅作答可见题干
      const prevXhr = (globalThis as any).GM_xmlhttpRequest;
      const prevKey = store.config.aiApiKey;
      store.config.aiApiKey = 'sk-test-ancestor-hidden';
      try {
        let hiddenAncestorClicked = false;
        let visibleClicked = false;
        let aiCount = 0;

        const hiddenAncestor = { style: { display: 'none', visibility: '' }, parentElement: null };
        const hiddenTimu: any = {
          style: {},
          parentElement: hiddenAncestor,
          getAttribute: (k: string) => (k === 'data-id' ? 'hidden-anc-q1' : null),
          closest: () => null,
          contains: () => false,
          cloneNode: function() { return this; },
          querySelector: (sel: string) => {
            if (sel.includes('mark_name') || sel.includes('Zy_TItle')) return { innerText: '1. (单选题) 祖先隐藏题目' };
            if (sel.includes('input') || sel.includes('li')) return {};
            return null;
          },
          querySelectorAll: (sel: string) => {
            if (sel === 'ul.Zy_ulTop, ul.Zy_ulBottom, ul.options, ul.mark_letter, .stem_answer') return [{}];
            if (sel.includes('li')) {
              return [
                {
                  innerText: 'A. 隐藏选项',
                  textContent: 'A. 隐藏选项',
                  getAttribute: () => null,
                  setAttribute: () => {},
                  contains: () => false,
                  classList: { contains: () => false, add: () => {} },
                  querySelector: () => null,
                  click: () => { hiddenAncestorClicked = true; }
                }
              ];
            }
            return [];
          }
        };

        const visibleTimu: any = {
          style: {},
          parentElement: { style: {}, parentElement: null },
          getAttribute: (k: string) => (k === 'data-id' ? 'visible-anc-q2' : null),
          closest: () => null,
          contains: () => false,
          cloneNode: function() { return this; },
          querySelector: (sel: string) => {
            if (sel.includes('mark_name') || sel.includes('Zy_TItle')) return { innerText: '2. (单选题) 祖先可见题目' };
            if (sel.includes(':checked') || sel.includes('.check_answer')) return null;
            if (sel.includes('input') || sel.includes('li')) return {};
            return null;
          },
          querySelectorAll: (sel: string) => {
            if (sel === 'ul.Zy_ulTop, ul.Zy_ulBottom, ul.options, ul.mark_letter, .stem_answer') return [{}];
            if (sel.includes('li')) {
              return [
                {
                  innerText: 'A. 可见选项',
                  textContent: 'A. 可见选项',
                  getAttribute: () => null,
                  setAttribute: () => {},
                  contains: () => false,
                  classList: { contains: () => false, add: () => {} },
                  querySelector: () => null,
                  click: () => { visibleClicked = true; }
                }
              ];
            }
            return [];
          }
        };

        const quizDoc: any = {
          defaultView: {
            getComputedStyle: (el: any) => ({
              display: el.style?.display || 'block',
              visibility: 'visible'
            })
          },
          querySelector: (sel: string) => {
            if (sel.includes('.questionLi') || sel.includes('.TiMu') || sel.includes('div[data-id]')) {
              return visibleTimu;
            }
            return null;
          },
          querySelectorAll: (sel: string) => {
            if (sel.includes('div[data-id]') || sel.includes('.TiMu')) {
              return [hiddenTimu, visibleTimu];
            }
            return [];
          }
        };

        (globalThis as any).GM_xmlhttpRequest = (opts: any) => {
          aiCount++;
          setTimeout(() => {
            opts.onload({
              status: 200,
              responseText: JSON.stringify({ choices: [{ message: { content: '["A"]' } }] })
            });
          }, 5);
        };

        await doQuizTask(null, quizDoc, { signal: new AbortController().signal, isCurrent: () => true });
        assert.equal(aiCount, 1);
        assert.equal(hiddenAncestorClicked, false, '祖先隐藏题绝不可被作答');
        assert.equal(visibleClicked, true);
      } finally {
        (globalThis as any).GM_xmlhttpRequest = prevXhr;
        store.config.aiApiKey = prevKey;
      }
    });

    it('24.11 doQuizTask 翻页等待期间 Abort 监听器 100% 释放与 jQuery 异步翻页无盲调竞态防护', async () => {
      const prevXhr = (globalThis as any).GM_xmlhttpRequest;
      const prevSession = (globalThis as any).sessionStorage;
      const prevKey = store.config.aiApiKey;

      const sMap = new Map<string, string>();
      (globalThis as any).sessionStorage = {
        getItem: (k: string) => sMap.get(k) ?? null,
        setItem: (k: string, v: string) => sMap.set(k, String(v)),
        removeItem: (k: string) => sMap.delete(k),
        clear: () => sMap.clear()
      };
      store.config.aiApiKey = 'sk-test-abort-listeners';

      const makePageTimu = (id: string, titleText: string) => ({
        style: {},
        getAttribute: (k: string) => (k === 'data-id' ? id : null),
        closest: () => null,
        contains: () => false,
        cloneNode: function() { return this; },
        querySelector: (sel: string) => {
          if (sel.includes('mark_name') || sel.includes('Zy_TItle')) {
            return { innerText: titleText, textContent: titleText };
          }
          if (sel.includes(':checked') || sel.includes('.check_answer')) return null;
          if (sel.includes('input') || sel.includes('li')) return {};
          return null;
        },
        querySelectorAll: (sel: string) => {
          if (sel === 'ul.Zy_ulTop, ul.Zy_ulBottom, ul.options, ul.mark_letter, .stem_answer') return [{}];
          if (sel.includes('li')) {
            return [
              {
                innerText: 'A. 选项A',
                textContent: 'A. 选项A',
                getAttribute: () => null,
                setAttribute: () => {},
                contains: () => false,
                classList: { contains: () => false, add: () => {} },
                querySelector: () => null,
                click: () => {}
              }
            ];
          }
          return [];
        }
      });

      try {
        // 子场景 A：4000ms 轮询等待期间触发 abort -> beforeunload 与 pagehide 监听器 100% removeEventListener 释放
        const activeListeners = new Map<string, Set<any>>();
        const abortCtrl = new AbortController();
        const q1 = makePageTimu('abort-q1', '1. (单选题) 等待中止监听器测试');
        const nextBtnA: any = {
          tagName: 'A',
          innerText: '下一题',
          textContent: '下一题',
          style: {},
          classList: { contains: () => false },
          hasAttribute: () => false,
          getAttribute: () => null,
          closest: () => null,
          click: () => {
            // 点击下一题进入 4000ms 等待后立即 abort
            setTimeout(() => abortCtrl.abort(), 150);
          }
        };

        const targetWinA: any = {
          addEventListener: (type: string, fn: any) => {
            if (!activeListeners.has(type)) activeListeners.set(type, new Set());
            activeListeners.get(type)!.add(fn);
          },
          removeEventListener: (type: string, fn: any) => {
            activeListeners.get(type)?.delete(fn);
          },
          getComputedStyle: () => ({ display: 'block', visibility: 'visible' })
        };

        const docA: any = {
          defaultView: targetWinA,
          querySelector: (sel: string) => (sel.includes('.TiMu') || sel.includes('.questionLi') ? q1 : null),
          querySelectorAll: (sel: string) => {
            if (sel.includes('.questionLi') || sel.includes('.TiMu')) return [q1];
            if (sel.includes('.nextDiv') || sel.includes('#nextBtn')) return [nextBtnA];
            return [];
          }
        };

        (globalThis as any).GM_xmlhttpRequest = (opts: any) => {
          setTimeout(() => {
            opts.onload({
              status: 200,
              responseText: JSON.stringify({ choices: [{ message: { content: '["A"]' } }] })
            });
          }, 5);
        };

        await assert.rejects(
          () => doQuizTask(null, docA, { signal: abortCtrl.signal, isCurrent: () => !abortCtrl.signal.aborted }),
          (err: any) => err?.name === 'AbortError'
        );
        assert.equal(activeListeners.get('beforeunload')?.size || 0, 0, 'beforeunload 监听器必须 100% 清理');
        assert.equal(activeListeners.get('pagehide')?.size || 0, 0, 'pagehide 监听器必须 100% 清理');

        // 子场景 B：nextBtn 无 onclick 属性（模拟 jQuery .on('click') 慢异步 AJAX，1300ms 后才切题）
        // 等待超过 1000ms 时绝不能盲目调用 targetWin.getTheNextQuestion(1)
        clearExamAutoResumeState();
        let page = 1;
        let blindCalls = 0;
        const q1b = makePageTimu('jq-q1', '1. (单选题) jQuery 异步翻页第1题');
        const q2 = makePageTimu('jq-q2', '2. (单选题) jQuery 异步翻页第2题');
        const nextBtnB: any = {
          tagName: 'A',
          innerText: '下一题',
          textContent: '下一题',
          style: {},
          classList: { contains: () => false },
          hasAttribute: () => false,
          getAttribute: () => null, // 无 onclick 属性
          closest: () => null,
          click: () => {
            setTimeout(() => {
              page = 2;
            }, 1300);
          }
        };
        const targetWinB: any = {
          addEventListener: () => {},
          removeEventListener: () => {},
          getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
          getTheNextQuestion: () => {
            blindCalls++;
          }
        };
        const docB: any = {
          defaultView: targetWinB,
          querySelector: (sel: string) => (sel.includes('.TiMu') || sel.includes('.questionLi') ? (page === 1 ? q1b : q2) : null),
          querySelectorAll: (sel: string) => {
            if (sel.includes('.questionLi') || sel.includes('.TiMu')) return [page === 1 ? q1b : q2];
            if (sel.includes('.nextDiv') || sel.includes('#nextBtn')) return page === 1 ? [nextBtnB] : [];
            return [];
          }
        };

        await doQuizTask(null, docB, { signal: new AbortController().signal, isCurrent: () => true });
        assert.equal(page, 2, '异步 AJAX 1300ms 切题后应顺利完成第 2 题');
        assert.equal(blindCalls, 0, '超过 1000ms 轮询期间绝不可盲调 targetWin.getTheNextQuestion');
      } finally {
        clearExamAutoResumeState();
        (globalThis as any).GM_xmlhttpRequest = prevXhr;
        (globalThis as any).sessionStorage = prevSession;
        store.config.aiApiKey = prevKey;
      }
    });

    it('24.12 跨整页重载防死循环 (lastPageSig / recentSigs / pageTurnCount>=200) 及 ChapterScheduler 异常与非答题页状态清理', async () => {
      const prevWin = (globalThis as any).window;
      const prevDoc = (globalThis as any).document;
      const prevSession = (globalThis as any).sessionStorage;
      const prevXhr = (globalThis as any).GM_xmlhttpRequest;
      const prevKey = store.config.aiApiKey;
      const prevAutoSubmit = store.config.autoSubmitWork;

      const sMap = new Map<string, string>();
      (globalThis as any).sessionStorage = {
        getItem: (k: string) => sMap.get(k) ?? null,
        setItem: (k: string, v: string) => sMap.set(k, String(v)),
        removeItem: (k: string) => sMap.delete(k),
        clear: () => sMap.clear()
      };

      try {
        store.config.aiApiKey = 'sk-test-loop-guard';
        store.config.autoSubmitWork = true;
        (globalThis as any).window = {
          ...prevWin,
          location: {
            href: 'https://mooc1.chaoxing.com/exam-ans/exam/test?courseId=77',
            pathname: '/exam-ans/exam/test',
            search: '?courseId=77'
          }
        };

        let submitClicks = 0;
        const sameTimu: any = {
          style: {},
          getAttribute: (k: string) => (k === 'data-id' ? 'same-q1' : null),
          closest: () => null,
          contains: () => false,
          cloneNode: function() { return this; },
          querySelector: (sel: string) => {
            if (sel.includes('mark_name') || sel.includes('Zy_TItle')) {
              return { innerText: '1. (单选题) 重载停留在同一题' };
            }
            if (sel.includes('input') || sel.includes('li')) return {};
            return null;
          },
          querySelectorAll: (sel: string) => {
            if (sel === 'ul.Zy_ulTop, ul.Zy_ulBottom, ul.options, ul.mark_letter, .stem_answer') return [{}];
            return [];
          }
        };

        const mockDoc: any = {
          defaultView: {
            getComputedStyle: () => ({ display: 'block', visibility: 'visible' })
          },
          querySelector: (sel: string) => {
            if (sel.includes('.questionLi') || sel.includes('.TiMu')) return sameTimu;
            if (sel.includes('btnSubmit') || sel.includes('#submitBtn')) {
              return { click: () => { submitClicks++; } };
            }
            return null;
          },
          querySelectorAll: (sel: string) => {
            if (sel.includes('.questionLi') || sel.includes('.TiMu')) return [sameTimu];
            return [];
          }
        };

        // 1. sessionStorage 中 recentSigs / lastPageSig 包含当前页签名 -> 立即清状态、置 paused、不提交
        const expectedSig = 'same-q1::重载停留在同一题';
        setExamAutoResumeState({
          solvedCount: 1,
          lastPageSig: expectedSig,
          recentSigs: [expectedSig],
          pageTurnCount: 1
        });
        await doQuizTask(null, mockDoc, { signal: new AbortController().signal, isCurrent: () => true });
        assert.equal(getExamAutoResumeState(), null, '命中跨重载签名防重时必须清空续跑状态');
        assert.equal(store.progress.status, 'paused');
        assert.equal(submitClicks, 0);

        // 2. pageTurnCount >= 200 -> 立即清状态、置 paused、不提交
        setExamAutoResumeState({
          solvedCount: 200,
          lastPageSig: 'other-q::其他题',
          recentSigs: ['other-q::其他题'],
          pageTurnCount: 200
        });
        await doQuizTask(null, mockDoc, { signal: new AbortController().signal, isCurrent: () => true });
        assert.equal(getExamAutoResumeState(), null, 'pageTurnCount >= 200 必须清空续跑状态');
        assert.equal(store.progress.status, 'paused');
        assert.equal(submitClicks, 0);

        // 3. ChapterScheduler 在非独立答题页面检测到残留 ExamAutoResumeState -> runPipeline 自动清理
        (globalThis as any).window = {
          ...prevWin,
          location: {
            href: 'https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=123',
            pathname: '/mycourse/studentstudy',
            search: '?chapterId=123'
          }
        };
        (globalThis as any).document = {
          title: '视频学习页',
          documentElement: { querySelectorAll: () => [] },
          querySelector: () => null,
          querySelectorAll: () => []
        };
        setExamAutoResumeState({ solvedCount: 4 });
        assert.ok(getExamAutoResumeState());
        const sched = new ChapterScheduler();
        await (sched as any).runPipeline();
        assert.equal(getExamAutoResumeState(), null, '非独立答题页必须自动清理残留 ExamAutoResumeState');

        // 4. ChapterScheduler.triggerManualQuiz 异常捕获路径也会清理残留状态
        setExamAutoResumeState({ solvedCount: 2 });
        (globalThis as any).document = {
          title: '异常考试页',
          querySelector: () => { throw new Error('DOM exploded'); },
          querySelectorAll: () => []
        };
        await sched.triggerManualQuiz();
        assert.equal(getExamAutoResumeState(), null, 'triggerManualQuiz 异常路径必须清理续跑状态');
      } finally {
        clearExamAutoResumeState();
        (globalThis as any).window = prevWin;
        (globalThis as any).document = prevDoc;
        (globalThis as any).sessionStorage = prevSession;
        (globalThis as any).GM_xmlhttpRequest = prevXhr;
        store.config.aiApiKey = prevKey;
        store.config.autoSubmitWork = prevAutoSubmit;
      }
    });

    it('24.13 cancelAutoSubmit 全场景阻断（缺图拒答、保底猜选）与 .active/.selected 防反选及 answertype* 排除', async () => {
      const prevXhr = (globalThis as any).GM_xmlhttpRequest;
      const prevSession = (globalThis as any).sessionStorage;
      const prevKey = store.config.aiApiKey;
      const prevAutoSubmit = store.config.autoSubmitWork;

      const sMap = new Map<string, string>();
      (globalThis as any).sessionStorage = {
        getItem: (k: string) => sMap.get(k) ?? null,
        setItem: (k: string, v: string) => sMap.set(k, String(v)),
        removeItem: (k: string) => sMap.delete(k),
        clear: () => sMap.clear()
      };

      try {
        store.config.aiApiKey = 'sk-test-cancel-submit';
        store.config.autoSubmitWork = true;
        store.acknowledgeAllErrors();

        // 子场景 A：题 1 含图片但 AI 返回缺图提示；翻页后题 2 保底猜选；翻页后题 3 正常作答 -> 仍绝不自动提交
        let page = 1;
        let submitClicks = 0;
        let saveClicks = 0;

        const makeSelectableTimu = (opts: {
          id: string;
          title: string;
          hasImg?: boolean;
          optionTexts: string[];
          useActiveClassOnly?: boolean;
          answertypeEl?: any;
          answerEl?: any;
        }) => {
          const optStates = opts.optionTexts.map((txt, i) => {
            const letter = String.fromCharCode(65 + i);
            let clickCount = 0;
            let active = false;
            const childBadge = {
              classList: { contains: (c: string) => active && c === 'selected', add: () => {}, remove: () => {} },
              getAttribute: () => letter,
              innerText: letter,
              textContent: letter
            };
            const el: any = {
              innerText: `${letter}. ${txt}`,
              textContent: `${letter}. ${txt}`,
              getAttribute: () => null,
              setAttribute: () => {},
              contains: () => false,
              scrollIntoView: () => {},
              classList: {
                contains: (c: string) => active && (c === 'active' || c === 'selected'),
                add: () => {},
                remove: () => {}
              },
              click: () => {
                clickCount++;
                active = !active; // 模拟真实 toggle：若重复点击则会取消选中！
              },
              querySelector: (sel: string) => {
                if (sel.includes('num_option')) return childBadge;
                if (sel.includes('.selected') || sel.includes('.active')) return active ? childBadge : null;
                return null;
              },
              _getClickCount: () => clickCount,
              _isActive: () => active
            };
            return el;
          });

          const timu: any = {
            style: {},
            getAttribute: (k: string) => (opts.answertypeEl ? null : k === 'data-id' ? opts.id : null),
            closest: () => null,
            contains: () => false,
            cloneNode: function() { return this; },
            querySelector: (sel: string) => {
              if (sel.includes('mark_name') || sel.includes('Zy_TItle')) return { innerText: opts.title };
              if (sel.includes(':checked') || sel.includes('.check_answer')) return null;
              if (sel === 'input[name^="answer"]:not([name^="answertype"])') return opts.answerEl ?? null;
              if (sel.includes('input') || sel.includes('li')) return optStates[0];
              return null;
            },
            querySelectorAll: (sel: string) => {
              if (sel === 'ul.Zy_ulTop, ul.Zy_ulBottom, ul.options, ul.mark_letter, .stem_answer') return [{}];
              if (sel === 'img' && opts.hasImg) {
                return [
                  {
                    currentSrc:
                      'data:image/png;base64,' + 'A'.repeat(240),
                    className: '',
                    getAttribute: () => null,
                    style: { width: '200px', height: '200px' },
                    complete: true,
                    naturalWidth: 200,
                    naturalHeight: 200,
                    closest: () => null
                  }
                ];
              }
              if (sel.includes('li')) return optStates;
              return [];
            }
          };
          return { timu, optStates };
        };

        const p1 = makeSelectableTimu({
          id: 'img-refuse-q1',
          title: '1. (单选题) 观察结构式判断所属类别',
          hasImg: true,
          optionTexts: ['黄酮类', '生物碱类']
        });
        const p2 = makeSelectableTimu({
          id: 'fallback-guess-q2',
          title: '2. (单选题) 无精准匹配保底猜选测试',
          optionTexts: ['甲选项', '乙选项']
        });
        const answertypeHidden = { name: 'answertype12345', value: '1', dispatchEvent: () => true };
        const answerHidden = { id: 'answer12345', name: 'answer12345', value: '', dispatchEvent: () => true };
        const p3 = makeSelectableTimu({
          id: 'active-only-q3',
          title: '3. (单选题) 非标准化 .active 节点防反选与 hiddenInput 排除测试',
          optionTexts: ['错误项', '正确项'],
          useActiveClassOnly: true,
          answertypeEl: answertypeHidden,
          answerEl: answerHidden
        });

        const nextBtn: any = {
          tagName: 'A',
          innerText: '下一题',
          textContent: '下一题',
          style: {},
          classList: { contains: () => false },
          hasAttribute: () => false,
          getAttribute: () => null,
          closest: () => null,
          click: () => { page++; }
        };

        const mockDoc: any = {
          defaultView: {
            addEventListener: () => {},
            removeEventListener: () => {},
            getComputedStyle: () => ({ display: 'block', visibility: 'visible' })
          },
          querySelector: (sel: string) => {
            if (sel.includes('answertype')) return answertypeHidden;
            if (sel.includes('answer12345')) return answerHidden;
            if (sel.includes('.questionLi') || sel.includes('.TiMu')) {
              return page === 1 ? p1.timu : page === 2 ? p2.timu : p3.timu;
            }
            if (sel.includes('btnSubmit') || sel.includes('#submitBtn')) return { click: () => { submitClicks++; } };
            if (sel.includes('btnSave') || sel.includes('#saveBtn')) return { click: () => { saveClicks++; } };
            return null;
          },
          querySelectorAll: (sel: string) => {
            if (sel.includes('.questionLi') || sel.includes('.TiMu')) {
              return [page === 1 ? p1.timu : page === 2 ? p2.timu : p3.timu];
            }
            if (sel.includes('.nextDiv') || sel.includes('#nextBtn')) return page < 3 ? [nextBtn] : [];
            return [];
          }
        };

        (globalThis as any).GM_xmlhttpRequest = (opts: any) => {
          const promptTxt = JSON.stringify(JSON.parse(opts.data).messages);
          setTimeout(() => {
            let content = '["B"]';
            if (promptTxt.includes('观察结构式')) {
              content = '["没有提供反应物结构式图片，无法唯一确定答案"]';
            } else if (promptTxt.includes('无精准匹配保底猜选测试')) {
              content = '["完全无关的不存在内容XYZ"]';
            }
            opts.onload({
              status: 200,
              responseText: JSON.stringify({ choices: [{ message: { content } }] })
            });
          }, 5);
        };

        await doQuizTask(null, mockDoc, { signal: new AbortController().signal, isCurrent: () => true });

        assert.equal(page, 3);
        assert.equal(submitClicks, 0, '含缺图拒答或保底猜选后绝不可触发自动提交');
        assert.equal(saveClicks, 1, '取消自动提交后必须转为点击暂存');
        assert.equal(p3.optStates[1]._getClickCount(), 1, '命中 .active/.selected 后绝不可二次点击反选取消');
        assert.equal(p3.optStates[1]._isActive(), true, '选项 B 必须维持选中态');
        assert.equal(answertypeHidden.value, '1', 'answertype12345 绝不可被误改');
        assert.equal(answerHidden.value, 'B', '真正隐藏框 answer12345 必须写入 B');
      } finally {
        clearExamAutoResumeState();
        (globalThis as any).GM_xmlhttpRequest = prevXhr;
        (globalThis as any).sessionStorage = prevSession;
        store.config.aiApiKey = prevKey;
        store.config.autoSubmitWork = prevAutoSubmit;
      }
    });

    it('24.14 parser.ts 对抗性边界与 3000+ 字符防回溯性能 (<50ms)', () => {
      // 1. 不跨越句号吞并解析段
      assert.deepEqual(
        parseAiResponse('答案：A. 正确，C. 正确。解析：B. 错误，D. 错误', 'multiple'),
        ['A', 'C']
      );

      // 2. 不被小写缩写/拉丁/数学函数字母 e/a/f 污染
      assert.deepEqual(
        parseAiResponse('答案：B. 如 e.g. 所示或 9 a.m. 场景；This is a good choice，设 f: X->Y', 'multiple'),
        ['B']
      );

      // 3. 否定/错选/漏选前缀绝不被当成选出的选项字母
      const negatedRes = parseAiResponse('错选 B；漏选 C；少选 D；不应选 A；不能选择 A', 'multiple');
      assert.ok(
        !negatedRes.some((item) => ['A', 'B', 'C', 'D'].includes(item)),
        `否定词后的选项字母绝不能被误抽取为答案，实际得到: ${JSON.stringify(negatedRes)}`
      );

      // 4. 中文括号选项与 "A 项、B 项" 格式
      assert.deepEqual(
        parseAiResponse('答案：A（坚持全面从严治党）、B（坚持不忘初心）、D（坚持一体推进）', 'multiple'),
        ['A', 'B', 'D']
      );
      assert.deepEqual(parseAiResponse('答案：A 项、B 项', 'multiple'), ['A', 'B']);

      // 5. essay 主观题中含矩阵 [A, B] 与 ['a', 'b'] 必须完整保留正文，不被 4b/4c 截断
      const essayText = "这道简答题涉及矩阵 [A, B] 与集合 ['a', 'b'] 的证明过程。";
      assert.deepEqual(parseAiResponse(essayText, 'essay'), [essayText]);

      // 6. ReDoS 防回溯性能测试（3000+ 字符长文本严格 < 50ms）
      const evilChunk = '选   **   答案   **   ';
      const evilInput = evilChunk.repeat(200) + '这是纯干扰长文本，没有任何标准选项结论。';
      assert.ok(evilInput.length > 3000);
      const t0 = performance.now();
      const perfRes = parseAiResponse(evilInput, 'multiple');
      const elapsed = performance.now() - t0;
      assert.ok(Array.isArray(perfRes));
      assert.ok(elapsed < 50, `parseAiResponse 耗时 ${elapsed.toFixed(2)}ms 超过 50ms 阈值`);
    });

    it('24.15 selectBestOptions 与 extractExplicitOptionLetter 术语防护 ("B 族维生素（核心内容）" 与 "E. coli")', () => {
      assert.equal(extractExplicitOptionLetter('B 族维生素（核心内容）'), null);
      assert.equal(extractExplicitOptionLetter('E. coli'), null);
      assert.equal(extractExplicitOptionLetter('D-构型'), null);
      assert.equal(extractExplicitOptionLetter('B. 正确选项'), 'B');

      const options = [
        { letter: 'A', rawText: 'A. 脂溶性维生素', cleanText: normalizeText('A. 脂溶性维生素') },
        { letter: 'B', rawText: 'B. 无关干扰项乙', cleanText: normalizeText('B. 无关干扰项乙') },
        {
          letter: 'C',
          rawText: 'C. B 族维生素（核心内容）',
          cleanText: normalizeText('C. B 族维生素（核心内容）')
        },
        { letter: 'D', rawText: 'D. 维生素 C', cleanText: normalizeText('D. 维生素 C') },
        { letter: 'E', rawText: 'E. 无关干扰项戊', cleanText: normalizeText('E. 无关干扰项戊') },
        { letter: 'F', rawText: 'F. E. coli（大肠杆菌）', cleanText: normalizeText('F. E. coli（大肠杆菌）') }
      ];

      const pickedVitamin = selectBestOptions(options, ['B 族维生素（核心内容）'], 'single');
      assert.equal(pickedVitamin.length, 1);
      assert.equal(pickedVitamin[0].letter, 'C', '必须命中文本 C 而非把 B 族误判为选项 B');

      const pickedEcoli = selectBestOptions(options, ['E. coli'], 'single');
      assert.equal(pickedEcoli.length, 1);
      assert.equal(pickedEcoli[0].letter, 'F', '必须命中文本 F 而非把 E. coli 误判为选项 E');
    });
  });
});
