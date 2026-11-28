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
  findQuizActionButton,
  getExamScope,
  getExamAutoResumeState,
  setExamAutoResumeState,
  clearExamAutoResumeState,
  setNativeInputValue
} from '../src/adapters/quiz';
import {
  isZhihuishuHost,
  isZhihuishuVideoPage,
  isZhihuishuExamPage,
  findVisiblePopupTestDialog,
  findVisibleZhihuishuCaptchaDialog,
  dismissZhihuishuTipDialog,
  solveZhihuishuPopupTest,
  findNextZhihuishuVideoItem,
  findOrExpandNextZhihuishuVideoItem,
  findZhihuishuChapterHeaders,
  findZhihuishuAiLessonItems,
  playZhihuishuVideoTask,
  getZhihuishuSwitchCooldownUntil,
  getLastCompletedZhihuishuLessonKey,
  clearZhihuishuCompletionSuppression,
  getZhihuishuLessonKey
} from '../src/adapters/zhihuishu-video';
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
  queryAiAnswer,
  formatRequestError,
  getLastAiQueryFailure
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
          if (sel.includes('.subject_node_list') || sel.includes('ul.Zy_ulTop,')) {
            return [];
          }
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
      // 1. CSS Tokens 规范检查（暖白 W1 主题）
      assert.ok(PANEL_STYLES.includes('--kasa-bg: #FAF6F0;'), '必须定义 --kasa-bg');
      assert.ok(PANEL_STYLES.includes('--kasa-surface: #FFFDF9;'), '必须定义 --kasa-surface');
      assert.ok(PANEL_STYLES.includes('--kasa-header-bg: #F3ECE1;'), '必须定义 --kasa-header-bg');
      assert.ok(PANEL_STYLES.includes('--kasa-border-outer: #B8AEA0;'), '必须定义 --kasa-border-outer');
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

    it('23.11 FloatingCard DOM 契约与无障碍属性：role=alert、aria-live=assertive、版本 v1.4.2、兄弟容器架构', async () => {
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
      assert.ok(cardRenderHtml.includes('v1.4.2'), '面板必须标注 v1.4.2 版本');
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
        assert.equal(submitClicks, 0, '含缺图拒答或未匹配题后绝不可触发自动提交');
        assert.equal(saveClicks, 1, '取消自动提交后必须转为点击暂存');
        assert.equal(p2.optStates[0]._getClickCount(), 0, '未精准匹配选项时绝不可盲选 A');
        assert.equal(p2.optStates[1]._getClickCount(), 0, '未精准匹配选项时必须保持空白');
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

    it('24.16 考试动态参数 scope 稳定、延迟挂载防误清、iframe 自动续跑与 GM 跨子域桥接', async () => {
      const prevWin = (globalThis as any).window;
      const prevDoc = (globalThis as any).document;
      const prevSession = (globalThis as any).sessionStorage;
      const prevGmGet = (globalThis as any).GM_getValue;
      const prevGmSet = (globalThis as any).GM_setValue;

      const sMap = new Map<string, string>();
      const gmMap = new Map<string, any>();

      (globalThis as any).sessionStorage = {
        getItem: (k: string) => sMap.get(k) ?? null,
        setItem: (k: string, v: string) => sMap.set(k, String(v)),
        removeItem: (k: string) => sMap.delete(k),
        clear: () => sMap.clear()
      };
      (globalThis as any).GM_getValue = (k: string, def: any) => (gmMap.has(k) ? gmMap.get(k) : def);
      (globalThis as any).GM_setValue = (k: string, v: any) => {
        gmMap.set(k, v);
      };

      const setMockUrl = (fullUrl: string) => {
        const parsed = new URL(fullUrl);
        (globalThis as any).window = {
          location: {
            href: parsed.href,
            pathname: parsed.pathname,
            search: parsed.search
          },
          setTimeout,
          clearTimeout,
          setInterval,
          clearInterval,
          addEventListener: () => {},
          removeEventListener: () => {}
        };
      };

      try {
        // 1. Chaoxing 动态防重放/计时参数变化时 getExamScope 必须保持一致；不同课程/试卷仍须隔离
        setMockUrl(
          'https://mooc1.chaoxing.com/exam-ans/exam/test/reVersionTestStartNew?courseId=241111&classId=8888&testPaperId=5555&testUserRelationId=777&questionId=1001&start=0&enc=aaa111&utenc=uuu1&remainTimeParam=3500&relationAnswerLastUpdateTime=1700000001&t=100&isFirst=1'
        );
        const scope1 = getExamScope();

        setMockUrl(
          'https://mooc1.chaoxing.com/exam-ans/exam/test/reVersionTestStartNew?courseId=241111&classId=8888&testPaperId=5555&testUserRelationId=777&questionId=1002&start=1&enc=bbb222&utenc=uuu2&remainTimeParam=3420&relationAnswerLastUpdateTime=1700000080&t=200&isFirst=0'
        );
        const scope2 = getExamScope();
        assert.equal(scope1, scope2, '超星动态 token/计时/题号参数变化时 examScope 必须稳定匹配');

        setMockUrl(
          'https://mooc1.chaoxing.com/exam-ans/exam/test/reVersionTestStartNew?courseId=999999&classId=8888&testPaperId=5555&start=1'
        );
        assert.notEqual(getExamScope(), scope1, '不同 courseId 必须隔离');

        setMockUrl(
          'https://mooc1.chaoxing.com/exam-ans/exam/test/reVersionTestStartNew?courseId=241111&classId=8888&testPaperId=6666&start=1'
        );
        assert.notEqual(getExamScope(), scope1, '不同 testPaperId 必须隔离');

        // 2. 考试 URL 下题目 DOM 延迟渲染时，初始 runPipeline 绝不能误清续跑状态；DOM 出现后应自动触发续跑
        const examUrl =
          'https://mooc1.chaoxing.com/exam-ans/exam/test/reVersionTestStartNew?courseId=241111&classId=8888&testPaperId=5555&start=1&enc=bbb222';
        setMockUrl(examUrl);
        sMap.clear();
        gmMap.clear();
        setExamAutoResumeState({ solvedCount: 1, lastPageSig: 'q1::题一' });

        let questionMounted = false;
        (globalThis as any).document = {
          readyState: 'complete',
          title: '考试作答页',
          documentElement: { querySelectorAll: () => [] },
          querySelector: (sel: string) => {
            if (!questionMounted) return null;
            if (sel.includes('.questionLi') || sel.includes('.TiMu')) return { id: 'q2' };
            if (sel.includes('radio') || sel.includes('Zy_ulTop')) return { type: 'radio' };
            return null;
          },
          querySelectorAll: () => []
        };

        const schedAsync = new ChapterScheduler();
        let asyncResumeCalls = 0;
        (schedAsync as any).triggerManualQuiz = async () => {
          asyncResumeCalls++;
          store.setQuizRunning(false);
        };

        await (schedAsync as any).runPipeline();
        assert.ok(
          getExamAutoResumeState()?.active,
          '考试 URL 下题目尚未异步挂载时绝不能清理 ExamAutoResumeState'
        );
        assert.equal(asyncResumeCalls, 0);

        questionMounted = true;
        await (schedAsync as any).runPipeline();
        await new Promise((r) => setTimeout(r, 100));
        assert.equal(asyncResumeCalls, 1, '题目异步渲染后必须自动触发 triggerManualQuiz 续跑');

        // 3. 题目托管在子 iframe 中时也应自动触发 ExamAutoResumeState 续跑
        sMap.clear();
        gmMap.clear();
        setMockUrl('https://mooc1.chaoxing.com/exam-ans/exam/test/reVersionTestStartNew?courseId=241111&testPaperId=5555');
        setExamAutoResumeState({ solvedCount: 2, lastPageSig: 'q2::题二' });

        const iframeDoc: any = {
          readyState: 'complete',
          URL: 'https://mooc1.chaoxing.com/exam-ans/exam/test/doExam?courseId=241111&testPaperId=5555',
          documentElement: { querySelectorAll: () => [] },
          querySelector: (sel: string) => {
            if (sel.includes('.questionLi') || sel.includes('.TiMu')) return { id: 'q3' };
            if (sel.includes('radio') || sel.includes('Zy_ulTop')) return { type: 'radio' };
            return null;
          },
          querySelectorAll: () => []
        };
        const childIframe: any = {
          isConnected: true,
          src: 'https://mooc1.chaoxing.com/exam-ans/exam/test/doExam?courseId=241111&testPaperId=5555',
          className: '',
          classList: { contains: () => false },
          parentElement: null,
          ownerDocument: null,
          contentDocument: iframeDoc,
          contentWindow: {}
        };
        (globalThis as any).document = {
          readyState: 'complete',
          title: '考试外壳页',
          documentElement: {
            querySelectorAll: (sel: string) => (sel === 'iframe' ? [childIframe] : [])
          },
          querySelector: () => null,
          querySelectorAll: (sel: string) => (sel === 'iframe' ? [childIframe] : [])
        };

        const schedIframe = new ChapterScheduler();
        let iframeResumeCalls = 0;
        (schedIframe as any).triggerManualQuiz = async () => {
          iframeResumeCalls++;
          store.setQuizRunning(false);
        };

        await (schedIframe as any).runPipeline();
        await new Promise((r) => setTimeout(r, 100));
        assert.equal(iframeResumeCalls, 1, '子 iframe 中的考试页面也必须支持自动续跑');

        // 4. sessionStorage 跨子域清空后，GM_getValue/GM_setValue 桥接可恢复一次并在消费后立即清理桥接键
        sMap.clear();
        gmMap.clear();
        setMockUrl('https://mooc1.chaoxing.com/exam-ans/exam/test/reVersionTestStartNew?courseId=241111&testPaperId=5555&enc=first');
        setExamAutoResumeState({ solvedCount: 5, lastPageSig: 'q5::题五', cancelAutoSubmit: true });
        assert.ok(gmMap.get('kasa_exam_autoresume_bridge_v1'), '写入续跑状态时必须同步写入 GM 桥接键');

        // 模拟跨子域跳转后新 origin 的空 sessionStorage
        sMap.clear();
        setMockUrl('https://mooc2-ans.chaoxing.com/exam-ans/exam/test/reVersionTestStartNew?courseId=241111&testPaperId=5555&enc=second');
        const restored = getExamAutoResumeState();
        assert.ok(restored, '跨子域 sessionStorage 为空时必须从 GM 桥接恢复状态');
        assert.equal(restored?.solvedCount, 5);
        assert.equal(restored?.cancelAutoSubmit, true);
        assert.equal(gmMap.get('kasa_exam_autoresume_bridge_v1'), '', 'GM 桥接消费后必须立刻清空防误触发');
        assert.ok(sMap.get('kasa_exam_autoresume_v1'), '桥接恢复后必须回写当前 origin 的 sessionStorage');

        // 若再次丢失 sessionStorage 且桥接已清空，不应重复消费旧桥接
        sMap.clear();
        assert.equal(getExamAutoResumeState(), null, '已消费清空的桥接状态不可再次触发');
      } finally {
        clearExamAutoResumeState();
        (globalThis as any).window = prevWin;
        (globalThis as any).document = prevDoc;
        (globalThis as any).sessionStorage = prevSession;
        (globalThis as any).GM_getValue = prevGmGet;
        (globalThis as any).GM_setValue = prevGmSet;
      }
    });
  });

  describe('【第 25 关】知到智慧树（Zhihuishu）视频挂机、弹题过关与作业考试双平台专项回归测试', () => {
    it('25.1 路由与页面判定：isZhihuishuHost / isZhihuishuVideoPage / isZhihuishuExamPage 严格隔离双平台及考试与视频页', () => {
      // 1. Host 判定
      assert.equal(isZhihuishuHost('https://studyvideoh5.zhihuishu.com/videoStudy.html?recruitAndCourseId=123'), true);
      assert.equal(isZhihuishuHost('https://onlineexamh5new.zhihuishu.com/stuExamWeb.html#/webExamList/dohomework'), true);
      assert.equal(isZhihuishuHost('zhihuishu.com'), true);
      assert.equal(isZhihuishuHost('studyh5.zhihuishu.com'), true);
      assert.equal(isZhihuishuHost('https://evil-zhihuishu.com/videoStudy.html'), false, '非 zhihuishu.com 后缀域名不得误判');
      assert.equal(isZhihuishuHost('https://mooc1.chaoxing.com/mycourse/studentstudy'), false, '超星域名不得误判为智慧树');
      assert.equal(isZhihuishuHost(''), false);

      // 2. stuExamWeb / onlineexamh5new 严禁误判为视频页
      const stuExamUrl = 'https://onlineexamh5new.zhihuishu.com/stuExamWeb.html#/webExamList/dohomework?recruitId=101';
      assert.equal(isZhihuishuExamPage(undefined, stuExamUrl), true);
      assert.equal(isZhihuishuVideoPage(undefined, stuExamUrl), false, 'stuExamWeb 绝不可误判为视频页');

      const mixedStudyExamUrl = 'https://studyh5.zhihuishu.com/stuExamWeb.html#/doExam';
      assert.equal(isZhihuishuExamPage(undefined, mixedStudyExamUrl), true);
      assert.equal(isZhihuishuVideoPage(undefined, mixedStudyExamUrl), false, '含 stuExamWeb 的 studyh5 URL 必须判定为考试页而非视频页');

      // 3. 视频页精准判定
      const videoUrl = 'https://studyvideoh5.zhihuishu.com/videoStudy.html?recruitAndCourseId=123';
      assert.equal(isZhihuishuVideoPage(undefined, videoUrl), true);
      assert.equal(isZhihuishuExamPage(undefined, videoUrl), false);

      // 4. 泛域名下基于 DOM 的兜底判定
      const genericZhsUrl = 'https://fusioncourseh5.zhihuishu.com/course/100';
      const examDomDoc: any = {
        querySelector: (sel: string) => (sel.includes('.examPaper_subject') ? {} : null)
      };
      // Note: fusioncourseh5 matches video URL pattern unless exam DOM/URL takes precedence; test on generic www.zhihuishu.com
      const rootZhsUrl = 'https://www.zhihuishu.com/portal';
      assert.equal(isZhihuishuExamPage(examDomDoc, rootZhsUrl), true);
      assert.equal(isZhihuishuVideoPage(examDomDoc, rootZhsUrl), false, '存在考试题块 DOM 时绝不可误判为视频页');

      const videoDomDoc: any = {
        querySelector: (sel: string) => (sel.includes('#vjs_container_html5_api') ? {} : null)
      };
      assert.equal(isZhihuishuVideoPage(videoDomDoc, rootZhsUrl), true);
      assert.equal(isZhihuishuExamPage(videoDomDoc, rootZhsUrl), false);

      // 5. 超星 URL 即使带 doExam / videoStudy DOM 也不得误判为智慧树
      const cxExamUrl = 'https://mooc1.chaoxing.com/exam-ans/exam/test/doExam?courseId=1';
      assert.equal(isZhihuishuExamPage(examDomDoc, cxExamUrl), false);
      assert.equal(isZhihuishuVideoPage(videoDomDoc, 'https://mooc1.chaoxing.com/mycourse/studentstudy'), false);
    });

    it('25.2 随堂弹题求解：findVisiblePopupTestDialog 过滤隐藏弹窗与 solveZhihuishuPopupTest 多题/多选防反选/无Key保底/关闭', async () => {
      const prevXhr = (globalThis as any).GM_xmlhttpRequest;
      const prevKey = store.config.aiApiKey;

      const makeHiddenEl = (opts: { display?: string; hidden?: boolean; computedDisplay?: string; closestPanel?: boolean } = {}) => ({
        hidden: Boolean(opts.hidden),
        style: { display: opts.display || '', visibility: '' },
        parentElement: null,
        closest: (sel: string) => (opts.closestPanel && sel.includes('kasa-helper-panel') ? {} : null),
        querySelector: () => null,
        _computedDisplay: opts.computedDisplay
      });

      const makeDocView = () => ({
        getComputedStyle: (el: any) => ({
          display: el._computedDisplay || el.style?.display || 'block',
          visibility: el.style?.visibility || 'visible'
        })
      });

      try {
        // 1. findVisiblePopupTestDialog 过滤隐藏、祖先隐藏与面板内部元素
        const hiddenByStyle = makeHiddenEl({ display: 'none' });
        const hiddenByComputed = makeHiddenEl({ computedDisplay: 'none' });
        const hiddenByPanel = makeHiddenEl({ closestPanel: true });
        const hiddenAncestor: any = makeHiddenEl({ display: 'none' });
        const hiddenByParent: any = { ...makeHiddenEl(), parentElement: hiddenAncestor };
        const visibleWrapper: any = {
          ...makeHiddenEl(),
          querySelector: (sel: string) => (sel.includes('.topic-item') ? {} : null)
        };

        const docFilter: any = {
          defaultView: makeDocView(),
          querySelectorAll: (sel: string) => {
            if (sel.includes('.dialog-test')) {
              return [hiddenByStyle, hiddenByComputed, hiddenByPanel, hiddenByParent];
            }
            if (sel.includes('.el-dialog__wrapper')) {
              return [visibleWrapper];
            }
            return [];
          }
        };
        assert.equal(findVisiblePopupTestDialog(docFilter), visibleWrapper, '应过滤全部隐藏/面板内弹窗并命中可见包装弹窗');

        // 2. solveZhihuishuPopupTest 场景 A：多题 .topic-num-item 切换 + AI 多选防反选 + 自动关闭
        let activeTabIndex = 0;
        let tab2Clicked = false;
        let closeClicked = false;

        const makePopupOpt = (letter: string, text: string, initiallySelected = false) => {
          let selected = initiallySelected;
          let clickCount = 0;
          let innerClickCount = 0;
          const opt: any = {
            innerText: `${letter}. ${text}`,
            textContent: `${letter}. ${text}`,
            style: { display: '', visibility: '' },
            parentElement: null,
            contains: () => false,
            classList: {
              contains: (c: string) => selected && (c === 'active' || c === 'is-checked')
            },
            getAttribute: (k: string) => (k === 'aria-checked' ? String(selected) : null),
            click: () => {
              clickCount++;
              selected = !selected;
            },
            querySelector: (sel: string) => {
              if (sel.includes('.topic-option')) return { innerText: letter, textContent: letter };
              if (sel.includes('.topic-text')) return { innerText: text, textContent: text };
              if (sel.includes('input[type="checkbox"]') || sel.includes('input[type="radio"]')) {
                return {
                  value: letter,
                  checked: selected,
                  click: () => {
                    innerClickCount++;
                    selected = !selected;
                  }
                };
              }
              if (sel.includes('.active')) return selected ? {} : null;
              return null;
            },
            get clickCount() {
              return clickCount;
            },
            get innerClickCount() {
              return innerClickCount;
            },
            get isSelected() {
              return selected;
            }
          };
          return opt;
        };

        const q1Opts = [makePopupOpt('A', '错误选项一'), makePopupOpt('B', '正确选项二')];
        // Q2 多选题中 A 已经处于选中状态，测试防反选
        const q2Opts = [
          makePopupOpt('A', '理论联系实际', true),
          makePopupOpt('B', '闭门造车', false),
          makePopupOpt('C', '密切联系群众', false)
        ];

        const tab1: any = {
          classList: { contains: (c: string) => activeTabIndex === 0 && c === 'active' },
          click: () => {
            activeTabIndex = 0;
          }
        };
        const tab2: any = {
          classList: { contains: (c: string) => activeTabIndex === 1 && c === 'active' },
          click: () => {
            tab2Clicked = true;
            activeTabIndex = 1;
          }
        };
        const closeBtn: any = {
          innerText: '关闭',
          textContent: '关闭',
          disabled: false,
          style: { display: '', visibility: '' },
          parentElement: null,
          classList: { contains: () => false },
          hasAttribute: () => false,
          getAttribute: () => null,
          click: () => {
            closeClicked = true;
            activePopupDialog.style.display = 'none';
          }
        };

        const activePopupDialog: any = {
          style: { display: '', visibility: '' },
          parentElement: null,
          closest: () => null,
          get innerText() {
            return activeTabIndex === 0 ? '【单选题】第一题标题' : '【多选题】第二题标题';
          },
          querySelector: (sel: string) => {
            if (sel.includes('.topic-title')) {
              const t = activeTabIndex === 0 ? '1. (单选题) 测试第一题' : '2. (多选题) 以下属于优良作风的有';
              return { innerText: t, textContent: t };
            }
            if (sel.includes('input[type="checkbox"]')) {
              return activeTabIndex === 1 ? {} : null;
            }
            return null;
          },
          querySelectorAll: (sel: string) => {
            if (sel.includes('.topic-num-item')) return [tab1, tab2];
            if (sel.includes('.topic-item')) return activeTabIndex === 0 ? q1Opts : q2Opts;
            if (sel.includes('input[type="radio"]')) return activeTabIndex === 0 ? q1Opts : [];
            if (sel.includes('button')) return [closeBtn];
            return [];
          }
        };

        const popupDoc: any = {
          defaultView: makeDocView(),
          querySelectorAll: (sel: string) => (sel.includes('.dialog-test') ? [activePopupDialog] : [])
        };

        store.config.aiApiKey = 'sk-zhs-popup-test';
        let aiCallCount = 0;
        (globalThis as any).GM_xmlhttpRequest = (opts: any) => {
          aiCallCount++;
          const body = JSON.parse(opts.data);
          const promptText = JSON.stringify(body.messages);
          const reply = promptText.includes('测试第一题') ? '["B"]' : '["A", "C"]';
          setTimeout(() => {
            opts.onload({
              status: 200,
              responseText: JSON.stringify({ choices: [{ message: { content: reply } }] })
            });
          }, 5);
        };

        const controller = new AbortController();
        const solvedA = await solveZhihuishuPopupTest(
          popupDoc,
          controller.signal,
          () => true,
          { reactionDelayMs: 5, closeDelayMs: 5, verifyCloseDelayMs: 5 }
        );

        assert.equal(solvedA, true);
        assert.equal(aiCallCount, 2);
        assert.equal(tab2Clicked, true, '必须切换第二个 .topic-num-item 题目标签');
        assert.equal(q1Opts[1].isSelected, true, '第 1 题应选中 B');
        assert.equal(q2Opts[0].clickCount, 0, '第 2 题已选中的 A 绝不能重复点击导致反选');
        assert.equal(q2Opts[0].isSelected, true);
        assert.equal(q2Opts[2].clickCount, 1, '第 2 题未选中的 C 应被点击选中');
        assert.equal(q2Opts[2].isSelected, true);
        assert.equal(closeClicked, true, '作答完毕必须自动点击关闭按钮');

        // 3. 场景 B：无 AI Key 时走保底逻辑并关闭弹窗
        store.config.aiApiKey = '';
        activeTabIndex = 0;
        closeClicked = false;
        const fallbackOptA = makePopupOpt('A', '保底选项甲', false);
        const fallbackOptB = makePopupOpt('B', '保底选项乙', false);
        const fallbackDialog: any = {
          style: { display: '', visibility: '' },
          parentElement: null,
          closest: () => null,
          innerText: '【单选题】无Key测试题',
          querySelector: (sel: string) => {
            if (sel.includes('.topic-title')) return { innerText: '1. 未知离线题目', textContent: '1. 未知离线题目' };
            return null;
          },
          querySelectorAll: (sel: string) => {
            if (sel.includes('.topic-num-item')) return [];
            if (sel.includes('.topic-item')) return [fallbackOptA, fallbackOptB];
            if (sel.includes('input[type="radio"]')) return [fallbackOptA, fallbackOptB];
            if (sel.includes('button')) return [fallbackCloseBtn];
            return [];
          }
        };
        const fallbackCloseBtn: any = {
          ...closeBtn,
          click: () => {
            closeClicked = true;
            fallbackDialog.style.display = 'none';
          }
        };
        const fallbackDoc: any = {
          defaultView: makeDocView(),
          querySelectorAll: (sel: string) => (sel.includes('.dialog-test') ? [fallbackDialog] : [])
        };

        const solvedB = await solveZhihuishuPopupTest(
          fallbackDoc,
          controller.signal,
          () => true,
          { reactionDelayMs: 5, closeDelayMs: 5, verifyCloseDelayMs: 5 }
        );
        assert.equal(solvedB, true);
        assert.equal(fallbackOptA.isSelected, true, '无 API Key 时必须保底选中第 1 项防止卡死');
        assert.equal(closeClicked, true);
      } finally {
        (globalThis as any).GM_xmlhttpRequest = prevXhr;
        store.config.aiApiKey = prevKey;
      }
    });

    it('25.3 视频挂机与自动连播：findNextZhihuishuVideoItem 扫描与 playZhihuishuVideoTask 原速静音、弹题暂停恢复、完播切集及 Abort 释放', async () => {
      const prevAutoNext = store.config.autoNextChapter;
      const prevDelayBase = store.config.randomDelayBase;
      const prevDelayJitter = store.config.randomDelayJitter;
      const prevKey = store.config.aiApiKey;

      const makeDocView = () => ({
        getComputedStyle: (el: any) => ({
          display: el?._computedDisplay || el?.style?.display || 'block',
          visibility: el?.style?.visibility || 'visible'
        })
      });

      const makeVideoItem = (opts: {
        name: string;
        current?: boolean;
        finished?: boolean;
        hiddenFinishIcon?: boolean;
      }) => {
        const titleEl: any = { innerText: opts.name, textContent: opts.name, clicked: false, click() { this.clicked = true; } };
        const finishIcon: any = {
          style: { display: opts.hiddenFinishIcon ? 'none' : '' },
          parentElement: null
        };
        const item: any = {
          name: opts.name,
          titleEl,
          contains: () => false,
          classList: {
            contains: (c: string) => Boolean(opts.current && c === 'current_play')
          },
          querySelector: (sel: string) => {
            if (sel.includes('icofinish') && opts.finished) return finishIcon;
            if (sel.includes('catalogue_title')) return titleEl;
            return null;
          }
        };
        return item;
      };

      try {
        // 1. findNextZhihuishuVideoItem 场景 A：直接下一节按钮（跳过 disabled / hidden）
        const disabledNext: any = {
          disabled: true,
          style: { display: '', visibility: '' },
          classList: { contains: () => false },
          hasAttribute: () => true,
          getAttribute: () => null
        };
        const visibleNext: any = {
          disabled: false,
          style: { display: '', visibility: '' },
          classList: { contains: () => false },
          hasAttribute: () => false,
          getAttribute: () => null
        };
        assert.equal(
          findNextZhihuishuVideoItem({
            defaultView: makeDocView(),
            querySelectorAll: (sel: string) => (sel.includes('.next_lesson') ? [disabledNext, visibleNext] : [])
          } as any),
          visibleNext
        );

        // 2. findNextZhihuishuVideoItem 场景 B：后扫跳过 .time_icofinish
        const v0 = makeVideoItem({ name: '1.1', current: true, finished: true });
        const v1 = makeVideoItem({ name: '1.2', finished: true });
        const v2 = makeVideoItem({ name: '1.3', finished: false });
        assert.equal(
          findNextZhihuishuVideoItem({
            defaultView: makeDocView(),
            querySelectorAll: (sel: string) => (sel.includes('.clearfix.video') ? [v0, v1, v2] : [])
          } as any),
          v2.titleEl,
          '应跳过已完成 .time_icofinish 的 1.2 并返回 1.3'
        );

        // 3. findNextZhihuishuVideoItem 场景 C：尾部回扫未完成项
        const w0 = makeVideoItem({ name: '1.1', finished: true });
        const w1 = makeVideoItem({ name: '1.2', finished: false });
        const w2 = makeVideoItem({ name: '1.3', current: true, finished: true });
        assert.equal(
          findNextZhihuishuVideoItem({
            defaultView: makeDocView(),
            querySelectorAll: (sel: string) => (sel.includes('.clearfix.video') ? [w0, w1, w2] : [])
          } as any),
          w1.titleEl,
          '当前在末尾节且后方无未完成时，必须回扫命中 1.2'
        );

        // 4. findNextZhihuishuVideoItem 场景 D：全部完成返回 null
        const f0 = makeVideoItem({ name: '1.1', current: true, finished: true });
        const f1 = makeVideoItem({ name: '1.2', finished: true });
        assert.equal(
          findNextZhihuishuVideoItem({
            defaultView: makeDocView(),
            querySelectorAll: (sel: string) => (sel.includes('.clearfix.video') ? [f0, f1] : [])
          } as any),
          null
        );

        // 5. playZhihuishuVideoTask 场景 A：1.0x 原速静音、不篡改 currentTime、弹题期间不盲播、解完恢复播放、完播切集
        store.config.autoNextChapter = true;
        store.config.randomDelayBase = 0.5;
        store.config.randomDelayJitter = 0;
        store.config.aiApiKey = '';

        const listeners = new Map<string, Set<Function>>();
        let currentTimeValue = 12;
        let currentTimeSetCount = 0;
        let playCallCount = 0;
        let pauseCallCount = 0;

        const mockVideo: any = {
          playbackRate: 2.0,
          muted: false,
          duration: 120,
          paused: true,
          ended: false,
          get currentTime() {
            return currentTimeValue;
          },
          set currentTime(val: number) {
            currentTimeSetCount++;
            currentTimeValue = val;
          },
          play: async () => {
            playCallCount++;
            mockVideo.paused = false;
          },
          pause: () => {
            pauseCallCount++;
            mockVideo.paused = true;
          },
          addEventListener: (ev: string, fn: Function) => {
            if (!listeners.has(ev)) listeners.set(ev, new Set());
            listeners.get(ev)!.add(fn);
          },
          removeEventListener: (ev: string, fn: Function) => {
            listeners.get(ev)?.delete(fn);
          }
        };

        let popupVisible = false;
        let popupCloseClicked = false;
        let nextLessonClicked = false;

        const popupOpt1: any = {
          innerText: 'A. 正确选项',
          textContent: 'A. 正确选项',
          style: { display: '', visibility: '' },
          parentElement: null,
          contains: () => false,
          selected: false,
          classList: { contains: function (c: string) { return popupOpt1.selected && c === 'active'; } },
          getAttribute: () => (popupOpt1.selected ? 'true' : null),
          click: () => {
            popupOpt1.selected = true;
          },
          querySelector: (sel: string) => {
            if (sel.includes('.topic-text')) return { innerText: '正确选项', textContent: '正确选项' };
            if (sel.includes('input')) return { value: 'A', checked: popupOpt1.selected };
            return null;
          }
        };
        const popupCloseBtn: any = {
          innerText: '关闭',
          textContent: '关闭',
          disabled: false,
          style: { display: '', visibility: '' },
          parentElement: null,
          classList: { contains: () => false },
          hasAttribute: () => false,
          getAttribute: () => null,
          click: () => {
            popupCloseClicked = true;
            popupVisible = false;
          }
        };
        const popupDialog: any = {
          style: { display: '', visibility: '' },
          parentElement: null,
          closest: () => null,
          innerText: '【单选题】视频弹题',
          querySelector: (sel: string) => {
            if (sel.includes('.topic-title')) return { innerText: '1. 视频弹题测试', textContent: '1. 视频弹题测试' };
            return null;
          },
          querySelectorAll: (sel: string) => {
            if (sel.includes('.topic-num-item')) return [];
            if (sel.includes('.topic-item')) return [popupOpt1];
            if (sel.includes('input[type="radio"]')) return [popupOpt1];
            if (sel.includes('button')) return [popupCloseBtn];
            return [];
          }
        };
        const nextBtnInVideo: any = {
          disabled: false,
          style: { display: '', visibility: '' },
          classList: { contains: () => false },
          hasAttribute: () => false,
          getAttribute: () => null,
          click: () => {
            nextLessonClicked = true;
          }
        };

        const videoDoc: any = {
          defaultView: makeDocView(),
          querySelector: (sel: string) => {
            if (sel.includes('.current_play .catalogue_title')) return { innerText: '第一章 导论', textContent: '第一章 导论' };
            if (sel.includes('.active.video')) return null;
            if (sel.includes('#vjs_container_html5_api') || sel.includes('video')) return mockVideo;
            return null;
          },
          querySelectorAll: (sel: string) => {
            if (sel.includes('.dialog-test')) return popupVisible ? [popupDialog] : [];
            if (sel.includes('.next_lesson')) return [nextBtnInVideo];
            return [];
          }
        };

        const ctrlA = new AbortController();
        const taskPromiseA = playZhihuishuVideoTask(
          videoDoc,
          { signal: ctrlA.signal, isCurrent: () => true },
          {
            pollIntervalMs: 25,
            popupTiming: { reactionDelayMs: 5, closeDelayMs: 5, verifyCloseDelayMs: 5 },
            switchWaitTimeoutMs: 60
          }
        );

        try {
          await new Promise((r) => setTimeout(r, 60));
          assert.equal(mockVideo.playbackRate, 1.0, '必须强制锁定 1.0x 原速');
          assert.equal(mockVideo.muted, true, '必须强制静音自动播放');
          assert.equal(currentTimeSetCount, 0, '绝不可篡改 video.currentTime');
          assert.equal(currentTimeValue, 12);
          assert.equal(playCallCount, 1);

          // 触发弹题暂停：期间不得盲目恢复 play()
          popupVisible = true;
          mockVideo.paused = true;
          for (const fn of listeners.get('pause') || []) {
            void fn();
          }
          assert.equal(playCallCount, 1, '弹题暂停期间绝不能立即抢播');

          // 等待轮询解完弹题并恢复播放
          await new Promise((r) => setTimeout(r, 150));
          assert.equal(popupCloseClicked, true, '轮询应自动求解并关闭随堂弹题');
          assert.equal(popupVisible, false);
          assert.ok(playCallCount >= 2, '弹题关闭后必须恢复 1.0x 原速播放');
          assert.equal(mockVideo.playbackRate, 1.0);
          assert.equal(mockVideo.muted, true);

          // 触发播放结束并自动切集
          mockVideo.ended = true;
          for (const fn of listeners.get('ended') || []) {
            fn();
          }
          await taskPromiseA;
          assert.equal(nextLessonClicked, true, '视频完播后应自动点击下一节');
          assert.equal(store.progress.status, 'finished');
        } finally {
          ctrlA.abort();
          await taskPromiseA.catch(() => {});
        }

        // 6. playZhihuishuVideoTask 场景 B：AbortSignal 中断后所有监听器与定时器 100% 彻底释放
        const origSetInterval = globalThis.setInterval;
        const origClearInterval = globalThis.clearInterval;
        const createdIntervals = new Set<any>();
        const clearedIntervals = new Set<any>();

        (globalThis as any).setInterval = (fn: any, ms?: number, ...args: any[]) => {
          const id = origSetInterval(fn, ms, ...args);
          createdIntervals.add(id);
          return id;
        };
        (globalThis as any).clearInterval = (id: any) => {
          clearedIntervals.add(id);
          return origClearInterval(id);
        };

        try {
          const abortListeners = new Map<string, Set<Function>>();
          const trackedVideoListeners = new Map<string, Set<Function>>();
          let abortFlag = false;
          let pausedOnAbort = false;

          const trackedSignal: any = {
            get aborted() {
              return abortFlag;
            },
            addEventListener: (ev: string, fn: Function) => {
              if (!abortListeners.has(ev)) abortListeners.set(ev, new Set());
              abortListeners.get(ev)!.add(fn);
            },
            removeEventListener: (ev: string, fn: Function) => {
              abortListeners.get(ev)?.delete(fn);
            }
          };

          const trackedVideo: any = {
            playbackRate: 1.5,
            muted: false,
            duration: 100,
            currentTime: 0,
            paused: true,
            ended: false,
            play: async () => {
              trackedVideo.paused = false;
            },
            pause: () => {
              pausedOnAbort = true;
              trackedVideo.paused = true;
            },
            addEventListener: (ev: string, fn: Function) => {
              if (!trackedVideoListeners.has(ev)) trackedVideoListeners.set(ev, new Set());
              trackedVideoListeners.get(ev)!.add(fn);
            },
            removeEventListener: (ev: string, fn: Function) => {
              trackedVideoListeners.get(ev)?.delete(fn);
            }
          };

          const abortDoc: any = {
            defaultView: makeDocView(),
            querySelector: (sel: string) => (sel.includes('video') ? trackedVideo : null),
            querySelectorAll: () => []
          };

          const taskPromiseB = playZhihuishuVideoTask(
            abortDoc,
            { signal: trackedSignal, isCurrent: () => true },
            { pollIntervalMs: 30 }
          );

          await new Promise((r) => setTimeout(r, 70));
          assert.equal(createdIntervals.size, 1, '应创建 1 个轮询定时器');
          assert.equal(trackedVideoListeners.get('timeupdate')?.size, 1);
          assert.equal(trackedVideoListeners.get('pause')?.size, 1);
          assert.equal(trackedVideoListeners.get('ended')?.size, 1);
          assert.equal(abortListeners.get('abort')?.size, 1);

          abortFlag = true;
          for (const fn of Array.from(abortListeners.get('abort') || [])) {
            fn();
          }
          await taskPromiseB;

          assert.equal(pausedOnAbort, true, 'abort 时应暂停视频');
          for (const id of createdIntervals) {
            assert.equal(clearedIntervals.has(id), true, 'abort 后必须彻底 clearInterval 释放轮询定时器');
          }
          assert.equal(trackedVideoListeners.get('timeupdate')?.size, 0, 'timeupdate 监听器必须释放');
          assert.equal(trackedVideoListeners.get('pause')?.size, 0, 'pause 监听器必须释放');
          assert.equal(trackedVideoListeners.get('ended')?.size, 0, 'ended 监听器必须释放');
          assert.equal(abortListeners.get('abort')?.size, 0, 'abort 监听器必须释放');
        } finally {
          (globalThis as any).setInterval = origSetInterval;
          (globalThis as any).clearInterval = origClearInterval;
        }
      } finally {
        store.config.autoNextChapter = prevAutoNext;
        store.config.randomDelayBase = prevDelayBase;
        store.config.randomDelayJitter = prevDelayJitter;
        store.config.aiApiKey = prevKey;
      }
    });

    it('25.4 智慧树 stuExamWeb / onlineexamh5new 考试/作业集成测试 (doQuizTask)：题块解析、排除 .exam-card、Element UI 防反选/输入事件、单题翻页与 scope 稳定性', async () => {
      const prevWin = (globalThis as any).window;
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

      const setZhsUrl = (urlStr: string) => {
        const parsed = new URL(urlStr);
        (globalThis as any).window = {
          location: {
            href: parsed.href,
            hostname: parsed.hostname,
            pathname: parsed.pathname,
            search: parsed.search
          },
          setTimeout,
          clearTimeout,
          setInterval,
          clearInterval,
          addEventListener: () => {},
          removeEventListener: () => {}
        };
      };

      try {
        // 1. recruitId / homeworkId 的 getExamScope() 稳定性
        setZhsUrl('https://onlineexamh5new.zhihuishu.com/stuExamWeb.html?recruitId=9001&homeworkId=8002&studentExamId=7003&questionId=1&t=111&index=0');
        const zhsScope1 = getExamScope();
        setZhsUrl('https://onlineexamh5new.zhihuishu.com/stuExamWeb.html?recruitId=9001&homeworkId=8002&studentExamId=7003&questionId=2&t=222&index=1');
        const zhsScope2 = getExamScope();
        assert.equal(zhsScope1, zhsScope2, '智慧树动态题号/时间戳变化时 examScope 必须保持稳定');

        setZhsUrl('https://onlineexamh5new.zhihuishu.com/stuExamWeb.html?recruitId=9002&homeworkId=8002&studentExamId=7003');
        assert.notEqual(getExamScope(), zhsScope1, '不同 recruitId 必须隔离');

        setZhsUrl('https://onlineexamh5new.zhihuishu.com/stuExamWeb.html?recruitId=9001&homeworkId=8009&studentExamId=7003');
        assert.notEqual(getExamScope(), zhsScope1, '不同 homeworkId 必须隔离');

        // 2. isQuestionAnswered 对 Element UI 已选态的精准识别
        const makeAnsweredMock = (matchedSelPart: string) => ({
          querySelector: (sel: string) => (sel.includes(matchedSelPart) ? {} : null),
          querySelectorAll: () => []
        });
        assert.equal(isQuestionAnswered(makeAnsweredMock('.el-radio.is-checked') as any), true);
        assert.equal(isQuestionAnswered(makeAnsweredMock('.el-checkbox.is-checked') as any), true);
        assert.equal(isQuestionAnswered(makeAnsweredMock('.nodeLab.active') as any), true);
        assert.equal(isQuestionAnswered(makeAnsweredMock('.nodeLab.is-checked') as any), true);
        assert.equal(isQuestionAnswered(makeAnsweredMock('.subject_node .is-checked') as any), true);
        assert.equal(
          isQuestionAnswered({
            querySelector: () => null,
            querySelectorAll: (sel: string) =>
              sel.includes('.el-textarea__inner') ? [{ type: 'textarea', name: '', id: '', className: 'el-textarea__inner', value: '已填主观题答案' }] : []
          } as any),
          true
        );
        assert.equal(
          isQuestionAnswered({
            querySelector: () => null,
            querySelectorAll: (sel: string) =>
              sel.includes('.el-textarea__inner') ? [{ type: 'textarea', name: '', id: '', className: 'el-textarea__inner', value: '   ' }] : []
          } as any),
          false
        );

        // 3. setNativeInputValue 必须调用原生原型 setter（触发 Vue 2 / Element UI 响应式）
        let nativeSetterCalledWith: string | null = null;
        class FakeVueTextarea {
          private _val = '';
          tagName = 'TEXTAREA';
          get value() {
            return this._val;
          }
          set value(v: string) {
            nativeSetterCalledWith = v;
            this._val = v;
          }
        }
        const fakeTextarea = new FakeVueTextarea() as any;
        fakeTextarea.ownerDocument = {
          defaultView: {
            HTMLTextAreaElement: FakeVueTextarea
          }
        };
        setNativeInputValue(fakeTextarea, '原生响应式写入值');
        assert.equal(nativeSetterCalledWith, '原生响应式写入值');
        assert.equal(fakeTextarea.value, '原生响应式写入值');

        // 4. doQuizTask 智慧树 stuExamWeb 两页单题考试集成测试
        setZhsUrl('https://onlineexamh5new.zhihuishu.com/stuExamWeb.html?recruitId=9001&homeworkId=8002&studentExamId=7003');
        sMap.clear();
        store.config.aiApiKey = 'sk-zhs-exam-test';
        store.config.autoSubmitWork = true;

        // 构造被 .exam-card 包裹的伪题块（必须被排除）
        const examCardDecoy: any = {
          getAttribute: () => 'card-decoy-1',
          closest: (sel: string) => (sel.includes('.exam-card') ? {} : null),
          contains: () => false,
          querySelector: () => ({}),
          querySelectorAll: () => [{}]
        };

        // Page 1 选项：.subject_node .nodeLab + .el-checkbox（验证点击勾选且不二次点击 clickableEl 导致反选）
        const makeZhsMultiOpt = (letter: string, text: string) => {
          let checked = false;
          let outerClicks = 0;
          let innerInputClicks = 0;
          const checkboxInput: any = {
            type: 'checkbox',
            value: letter,
            get checked() {
              return checked;
            },
            set checked(v: boolean) {
              checked = v;
            },
            click: () => {
              innerInputClicks++;
              checked = !checked;
            },
            dispatchEvent: () => true
          };
          const elCheckboxInput: any = {
            classList: { contains: (c: string) => checked && c === 'is-checked' },
            click: () => {
              innerInputClicks++;
              checked = !checked;
            }
          };
          const opt: any = {
            innerText: `${letter}. ${text}`,
            textContent: `${letter}. ${text}`,
            closest: () => null,
            contains: () => false,
            scrollIntoView: () => {},
            classList: {
              contains: (c: string) => checked && (c === 'is-checked' || c === 'active')
            },
            getAttribute: () => null,
            setAttribute: () => {},
            click: () => {
              outerClicks++;
              checked = !checked;
            },
            querySelector: (sel: string) => {
              if (sel.includes('.node_Lab') || sel.includes('.option-letter')) {
                return { innerText: letter, textContent: letter, getAttribute: () => null };
              }
              if (sel.includes('.node_detail') || sel.includes('.el-checkbox__label')) {
                return { innerText: text, textContent: text };
              }
              if (sel.includes('input[type="checkbox"]') && sel.includes(':checked')) {
                return checked ? checkboxInput : null;
              }
              if (sel.includes('input[type="checkbox"]')) return checkboxInput;
              if (sel.includes('.el-checkbox__input')) return elCheckboxInput;
              if (sel.includes('.is-checked') || sel.includes('.el-checkbox.is-checked')) {
                return checked ? elCheckboxInput : null;
              }
              return null;
            },
            get isChecked() {
              return checked;
            },
            get outerClicks() {
              return outerClicks;
            },
            get innerInputClicks() {
              return innerInputClicks;
            }
          };
          return opt;
        };

        const p1Opts = [
          makeZhsMultiOpt('A', '智慧树 1.0x 原速静音'),
          makeZhsMultiOpt('B', '随机弹题自动过关'),
          makeZhsMultiOpt('C', '篡改进度条快进')
        ];

        const q1Node: any = {
          getAttribute: (k: string) => (k === 'data-id' ? 'zhs-q1' : null),
          closest: () => null,
          contains: () => false,
          cloneNode: function () { return this; },
          innerText: '【多选题】智慧树双平台辅助支持哪些能力？',
          querySelector: (sel: string) => {
            if (sel.includes('.subject_type')) return { innerText: '【多选题】', textContent: '【多选题】' };
            if (sel.includes('.subject_describe')) return { innerText: '智慧树双平台辅助支持哪些能力？', textContent: '智慧树双平台辅助支持哪些能力？' };
            if (sel.includes(':checked') || sel.includes('.is-checked') || sel.includes('.nodeLab.active')) {
              return p1Opts.some((o) => o.isChecked) ? {} : null;
            }
            if (sel.includes('input[type="checkbox"]') || sel.includes('.el-checkbox')) return p1Opts[0];
            if (sel.includes('.subject_node')) return p1Opts[0];
            return null;
          },
          querySelectorAll: (sel: string) => {
            if (sel.includes('.subject_node .nodeLab')) return p1Opts;
            if (sel.includes('input[type="checkbox"]') || sel.includes('.el-checkbox')) return p1Opts;
            return [];
          }
        };

        // Page 2 主观简答题：.questionBox + .el-textarea__inner
        const firedEvents: string[] = [];
        let textareaRealValue = '';
        class ZhsTextareaMock {
          tagName = 'TEXTAREA';
          type = 'textarea';
          id = 'zhs-essay-1';
          name = 'essayAnswer';
          className = 'el-textarea__inner';
          get value() {
            return textareaRealValue;
          }
          set value(v: string) {
            textareaRealValue = v;
          }
          dispatchEvent(ev: any) {
            firedEvents.push(ev?.type || '');
            return true;
          }
          getAttribute() {
            return null;
          }
        }
        const zhsTextarea = new ZhsTextareaMock() as any;
        zhsTextarea.ownerDocument = {
          defaultView: {
            HTMLTextAreaElement: ZhsTextareaMock
          }
        };

        const q2Node: any = {
          getAttribute: (k: string) => (k === 'data-id' ? 'zhs-q2' : null),
          closest: () => null,
          contains: () => false,
          cloneNode: function () { return this; },
          innerText: '【简答题】简述智慧树 1.0x 原速静音策略的目的',
          querySelector: (sel: string) => {
            if (sel.includes('.subject_type')) return { innerText: '【简答题】', textContent: '【简答题】' };
            if (sel.includes('.subject_describe')) return { innerText: '简述智慧树 1.0x 原速静音策略的目的', textContent: '简述智慧树 1.0x 原速静音策略的目的' };
            if (sel.includes(':checked') || sel.includes('.is-checked')) return null;
            if (sel.includes('.el-textarea__inner') || sel.includes('textarea')) return zhsTextarea;
            return null;
          },
          querySelectorAll: (sel: string) => {
            if (sel.includes('.el-textarea__inner') || sel.includes('textarea')) return [zhsTextarea];
            return [];
          }
        };

        let currentPage = 1;
        let nextBtnClicked = false;
        let submitBtnClicked = false;
        let confirmModalClicked = false;

        const nextBtnEl: any = {
          innerText: '下一题',
          textContent: '下一题',
          disabled: false,
          style: { display: '', visibility: '' },
          classList: { contains: () => false },
          hasAttribute: () => false,
          getAttribute: () => null,
          closest: () => null,
          click: () => {
            nextBtnClicked = true;
            setTimeout(() => {
              currentPage = 2;
            }, 30);
          }
        };
        const submitBtnEl: any = {
          click: () => {
            submitBtnClicked = true;
          }
        };
        const confirmBtnEl: any = {
          innerText: '确定提交',
          textContent: '确定提交',
          classList: { contains: (c: string) => c === 'el-button--primary' },
          click: () => {
            confirmModalClicked = true;
          }
        };

        const zhsExamDoc: any = {
          defaultView: {
            getComputedStyle: (el: any) => ({
              display: el?.style?.display || 'block',
              visibility: el?.style?.visibility || 'visible'
            }),
            confirm: () => true,
            alert: () => true
          },
          querySelector: (sel: string) => {
            if (sel.includes('.examPaper_subject') || sel.includes('.questionBox')) {
              return currentPage === 1 ? q1Node : q2Node;
            }
            if (sel.includes('title')) return { textContent: '智慧树期末考试' };
            if (sel.includes('.exam-submit-btn')) return submitBtnEl;
            return null;
          },
          querySelectorAll: (sel: string) => {
            if (sel.includes('.examPaper_subject') && sel.includes('.questionBox')) {
              return currentPage === 1 ? [examCardDecoy, q1Node] : [examCardDecoy, q2Node];
            }
            if (sel.includes('.switch-btn-box .el-button')) {
              return currentPage === 1 ? [nextBtnEl] : [];
            }
            if (sel.includes('.el-message-box__btns .el-button--primary')) {
              return [confirmBtnEl];
            }
            return [];
          }
        };

        (globalThis as any).GM_xmlhttpRequest = (opts: any) => {
          const body = JSON.parse(opts.data);
          const prompt = JSON.stringify(body.messages);
          const reply = prompt.includes('智慧树双平台辅助支持哪些能力')
            ? '["A", "B"]'
            : '保持 1.0x 原速静音可在避免风控的同时稳定完成播放进度统计。';
          setTimeout(() => {
            opts.onload({
              status: 200,
              responseText: JSON.stringify({ choices: [{ message: { content: reply } }] })
            });
          }, 5);
        };

        const ctrl = new AbortController();
        await doQuizTask(null, zhsExamDoc, { signal: ctrl.signal, isCurrent: () => true });

        assert.equal(store.questions.length, 2, '应仅解析出 2 道真实题目并严格排除 .exam-card');
        assert.equal(store.questions[0].type, 'multiple', '题 1 应识别为 multiple');
        assert.equal(p1Opts[0].isChecked, true);
        assert.equal(p1Opts[1].isChecked, true);
        assert.equal(p1Opts[2].isChecked, false);
        assert.equal(p1Opts[0].outerClicks, 1, '勾选后不应再次点击导致反选');
        assert.equal(p1Opts[0].innerInputClicks, 0, '外层点击已触发 .is-checked 后，禁止再点击内层 input 反选');
        assert.equal(nextBtnClicked, true, '必须触发 .switch-btn-box .el-button 单题下一题翻页');

        assert.equal(store.questions[1].type, 'essay', '题 2 应识别为 essay');
        assert.ok(textareaRealValue.includes('1.0x 原速静音'), '应将回答写入 .el-textarea__inner');
        assert.ok(firedEvents.includes('input'), '必须触发 input 事件');
        assert.ok(firedEvents.includes('change'), '必须触发 change 事件');
        assert.ok(firedEvents.includes('blur'), '必须触发 blur 事件');
        assert.equal(submitBtnClicked, true, '全部作答完成应点击 .exam-submit-btn');
        assert.equal(confirmModalClicked, true, '应点击 Element UI 二次确认按钮');
      } finally {
        clearExamAutoResumeState();
        (globalThis as any).window = prevWin;
        (globalThis as any).GM_xmlhttpRequest = prevXhr;
        (globalThis as any).sessionStorage = prevSession;
        store.config.aiApiKey = prevKey;
        store.config.autoSubmitWork = prevAutoSubmit;
      }
    });

    it('25.5 ChapterScheduler 智慧树视频防重入/考试自动识别续跑与 v1.4.2 产物静态元数据校验', async () => {
      const prevWin = (globalThis as any).window;
      const prevDoc = (globalThis as any).document;
      const prevSession = (globalThis as any).sessionStorage;

      const sMap = new Map<string, string>();
      (globalThis as any).sessionStorage = {
        getItem: (k: string) => sMap.get(k) ?? null,
        setItem: (k: string, v: string) => sMap.set(k, String(v)),
        removeItem: (k: string) => sMap.delete(k),
        clear: () => sMap.clear()
      };

      const setEnvUrl = (fullUrl: string) => {
        const parsed = new URL(fullUrl);
        (globalThis as any).window = {
          location: {
            href: parsed.href,
            hostname: parsed.hostname,
            pathname: parsed.pathname,
            search: parsed.search
          },
          setTimeout,
          clearTimeout,
          setInterval,
          clearInterval,
          addEventListener: () => {},
          removeEventListener: () => {}
        };
      };

      try {
        // 1. ChapterScheduler 在智慧树视频页触发 playZhihuishuVideoTask 且防重入
        setEnvUrl('https://studyvideoh5.zhihuishu.com/videoStudy.html?recruitAndCourseId=555');
        let playInvokeCount = 0;
        const mockVid: any = {
          playbackRate: 1.0,
          muted: true,
          duration: 100,
          currentTime: 0,
          paused: true,
          ended: false,
          play: async () => {
            playInvokeCount++;
            mockVid.paused = false;
          },
          pause: () => {
            mockVid.paused = true;
          },
          addEventListener: () => {},
          removeEventListener: () => {}
        };
        (globalThis as any).document = {
          readyState: 'complete',
          location: (globalThis as any).window.location,
          defaultView: { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) },
          documentElement: { querySelectorAll: () => [] },
          querySelector: (sel: string) => (sel.includes('#vjs_container_html5_api') ? mockVid : null),
          querySelectorAll: () => []
        };

        const videoScheduler = new ChapterScheduler();
        const p1 = (videoScheduler as any).runPipeline();
        // 尚未结束时并发调用 runPipeline()，必须被 isZhihuishuVideoRunning 拦截
        assert.equal((videoScheduler as any).isZhihuishuVideoRunning, true);
        const p2 = (videoScheduler as any).runPipeline();
        await p2;
        assert.equal(playInvokeCount, 0, '尚未到默认 2000ms 轮询点前防重入直接返回，绝不会启动第二个播放任务');
        (videoScheduler as any).watchdog.abort();
        await p1;
        assert.equal((videoScheduler as any).isZhihuishuVideoRunning, false, '退出后必须复位防重入锁');

        // 2. ChapterScheduler 在智慧树考试页自动识别与续跑
        setEnvUrl('https://onlineexamh5new.zhihuishu.com/stuExamWeb.html#/webExamList/dohomework?recruitId=101&homeworkId=202');
        sMap.clear();
        (globalThis as any).document = {
          readyState: 'complete',
          location: (globalThis as any).window.location,
          documentElement: { querySelectorAll: () => [] },
          querySelector: (sel: string) => {
            if (sel.includes('.examPaper_subject')) return { id: 'zhs-exam-q1' };
            if (sel.includes('.subject_node') || sel.includes('.el-radio')) return { id: 'zhs-opt-1' };
            return null;
          },
          querySelectorAll: () => []
        };

        store.updateProgress({ status: 'idle', title: '待机中', percent: 0, currentTime: '00:00' });
        const examSched1 = new ChapterScheduler();
        assert.equal((examSched1 as any).isStandaloneQuiz((globalThis as any).document), true);
        await (examSched1 as any).runPipeline();
        assert.equal(store.progress.title, '已检测到作业/测验，点击【开始答题】启动');

        // 存在续跑状态时，自动触发 triggerManualQuiz
        setExamAutoResumeState({ solvedCount: 2, lastPageSig: 'zhs-q2::题二' });
        const examSched2 = new ChapterScheduler();
        let resumed = 0;
        (examSched2 as any).triggerManualQuiz = async () => {
          resumed++;
          store.setQuizRunning(false);
        };
        await (examSched2 as any).runPipeline();
        await new Promise((r) => setTimeout(r, 100));
        assert.equal(resumed, 1, '智慧树考试页存在 ExamAutoResumeState 时必须自动续跑');

        // 3. v1.4.2 产物与工程配置文件静态元数据校验
        const rootDir = path.resolve(process.cwd());
        const pkgJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
        assert.equal(pkgJson.version, '1.4.2', 'package.json 版本必须为 1.4.2');

        const viteCfg = fs.readFileSync(path.join(rootDir, 'vite.config.ts'), 'utf8');
        assert.ok(viteCfg.includes("version: '1.4.2'") || viteCfg.includes('version: "1.4.2"'), 'vite.config.ts 必须声明 1.4.2');
        assert.ok(viteCfg.includes('*://*.zhihuishu.com/*'), 'vite.config.ts 必须包含 *://*.zhihuishu.com/*');

        const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'chrome-extension', 'manifest.json'), 'utf8'));
        assert.equal(manifest.version, '1.4.2', 'manifest.json 版本必须为 1.4.2');
        assert.ok(
          Array.isArray(manifest.host_permissions) && manifest.host_permissions.includes('*://*.zhihuishu.com/*'),
          'manifest.json host_permissions 必须包含 *://*.zhihuishu.com/*'
        );
        assert.ok(
          Array.isArray(manifest.content_scripts) &&
            manifest.content_scripts[0]?.matches?.includes('*://*.zhihuishu.com/*'),
          'manifest.json content_scripts matches 必须包含 *://*.zhihuishu.com/*'
        );

        const distUserJsPath = path.join(rootDir, 'dist', 'Kasa-xuexitong-helper.user.js');
        assert.equal(fs.existsSync(distUserJsPath), true, 'dist/Kasa-xuexitong-helper.user.js 产物必须存在');
        const distUserJs = fs.readFileSync(distUserJsPath, 'utf8');
        assert.match(distUserJs, /@version\s+1\.4\.2/, '构建产物 UserScript 头必须包含 @version 1.4.2');
        assert.match(distUserJs, /@match\s+\*:\/\/\*\.zhihuishu\.com\/\*/, '构建产物 UserScript 头必须包含 @match *://*.zhihuishu.com/*');
      } finally {
        clearExamAutoResumeState();
        (globalThis as any).window = prevWin;
        (globalThis as any).document = prevDoc;
        (globalThis as any).sessionStorage = prevSession;
      }
    });

    it('25.6 核验 Kurumi 风控修复：Vue 异步 nextTick 防反选、嵌套列表/兄弟 .node_detail 提取、confirm/alert 恢复、隐藏弹窗过滤与禁用题型熔断', async () => {
      const prevWin = (globalThis as any).window;
      const prevXhr = (globalThis as any).GM_xmlhttpRequest;
      const prevSession = (globalThis as any).sessionStorage;
      const prevKey = store.config.aiApiKey;
      const prevAutoSubmit = store.config.autoSubmitWork;
      const prevEnabledTypes = store.config.enabledQuestionTypes;

      const sMap = new Map<string, string>();
      (globalThis as any).sessionStorage = {
        getItem: (k: string) => sMap.get(k) ?? null,
        setItem: (k: string, v: string) => sMap.set(k, String(v)),
        removeItem: (k: string) => sMap.delete(k),
        clear: () => sMap.clear()
      };

      const makeAsyncCheckboxOpt = (opts: {
        letter: string;
        text: string;
        useNodeDetailSibling?: boolean;
        delayMs?: number;
      }) => {
        let checked = false;
        let clickCount = 0;
        const delayMs = opts.delayMs ?? 10;
        const toggleAsync = () => {
          clickCount++;
          const targetState = !checked;
          setTimeout(() => {
            checked = targetState;
          }, delayMs);
        };

        const inputEl: any = {
          type: 'checkbox',
          value: opts.letter,
          get checked() {
            return checked;
          },
          set checked(v: boolean) {
            checked = v;
          },
          click: toggleAsync,
          dispatchEvent: () => true
        };
        const elCheckboxInput: any = {
          classList: { contains: (c: string) => checked && c === 'is-checked' },
          click: toggleAsync
        };
        const nodeLabEl: any = {
          classList: {
            contains: (c: string) => c === 'nodeLab' || (checked && (c === 'is-checked' || c === 'active'))
          },
          matches: (sel: string) => sel.includes('.nodeLab'),
          click: toggleAsync,
          querySelector: (sel: string) => {
            if (sel.includes('.node_Lab')) return { innerText: opts.letter, textContent: opts.letter, getAttribute: () => null };
            return null;
          }
        };
        const nodeDetailEl: any = {
          innerText: opts.text,
          textContent: opts.text
        };

        const optEl: any = {
          innerText: `${opts.letter}. ${opts.text}`,
          textContent: `${opts.letter}. ${opts.text}`,
          style: { display: '', visibility: '' },
          parentElement: null,
          closest: () => null,
          contains: (other: any) => other === nodeLabEl || other === nodeDetailEl,
          scrollIntoView: () => {},
          matches: (sel: string) =>
            opts.useNodeDetailSibling ? false : sel.includes('.el-checkbox'),
          classList: {
            contains: (c: string) =>
              (!opts.useNodeDetailSibling && c === 'el-checkbox') ||
              (checked && (c === 'is-checked' || c === 'active'))
          },
          getAttribute: () => null,
          setAttribute: () => {},
          click: toggleAsync,
          querySelector: (sel: string) => {
            if (sel.includes('.node_Lab') || sel.includes('.option-letter')) {
              return { innerText: opts.letter, textContent: opts.letter, getAttribute: () => null };
            }
            if (sel.includes('.node_detail') || sel.includes('.el-checkbox__label')) {
              return nodeDetailEl;
            }
            if (sel.includes('.nodeLab')) {
              return opts.useNodeDetailSibling ? nodeLabEl : null;
            }
            if (sel.includes('input[type="checkbox"]') && sel.includes(':checked')) {
              return checked ? inputEl : null;
            }
            if (sel.includes('input[type="checkbox"]')) return inputEl;
            if (sel.includes('.el-checkbox__input')) return elCheckboxInput;
            if (sel.includes('.is-checked') || sel.includes('.el-checkbox.is-checked')) {
              return checked ? elCheckboxInput : null;
            }
            return null;
          },
          get clickCount() {
            return clickCount;
          },
          get isChecked() {
            return checked;
          }
        };
        return optEl;
      };

      try {
        // 1. solveZhihuishuPopupTest：Vue 异步 nextTick 延迟 10ms 设置 .is-checked，严禁重复点击反选
        const popupAsyncOpts = [
          makeAsyncCheckboxOpt({ letter: 'A', text: '异步选中甲', delayMs: 10 }),
          makeAsyncCheckboxOpt({ letter: 'B', text: '干扰项乙', delayMs: 10 }),
          makeAsyncCheckboxOpt({ letter: 'C', text: '异步选中丙', delayMs: 10 })
        ];
        // Adapt popup selector expectations onto async checkbox opts
        const wrapPopupOpt = (base: any, letter: string, text: string) => ({
          ...base,
          matches: (sel: string) => sel.includes('.el-checkbox'),
          classList: base.classList,
          get clickCount() {
            return base.clickCount;
          },
          get isChecked() {
            return base.isChecked;
          },
          querySelector: (sel: string) => {
            if (sel.includes('.topic-option')) return { innerText: letter, textContent: letter };
            if (sel.includes('.topic-text')) return { innerText: text, textContent: text };
            return base.querySelector(sel);
          }
        });
        const pOpts = [
          wrapPopupOpt(popupAsyncOpts[0], 'A', '异步选中甲'),
          wrapPopupOpt(popupAsyncOpts[1], 'B', '干扰项乙'),
          wrapPopupOpt(popupAsyncOpts[2], 'C', '异步选中丙')
        ];
        const popupDialog: any = {
          style: { display: '', visibility: '' },
          parentElement: null,
          closest: () => null,
          innerText: '【多选题】异步 Vue 弹题',
          querySelector: (sel: string) => {
            if (sel.includes('.topic-title')) return { innerText: '1. (多选题) 异步多选测试', textContent: '1. (多选题) 异步多选测试' };
            if (sel.includes('input[type="checkbox"]')) return pOpts[0];
            return null;
          },
          querySelectorAll: (sel: string) => {
            if (sel.includes('.topic-num-item')) return [];
            if (sel.includes('.el-checkbox')) return pOpts;
            if (sel.includes('button')) {
              return [
                {
                  innerText: '关闭',
                  textContent: '关闭',
                  disabled: false,
                  style: { display: '', visibility: '' },
                  parentElement: null,
                  classList: { contains: () => false },
                  hasAttribute: () => false,
                  getAttribute: () => null,
                  click: () => {
                    popupDialog.style.display = 'none';
                  }
                }
              ];
            }
            return [];
          }
        };
        const popupDoc: any = {
          defaultView: {
            getComputedStyle: (el: any) => ({
              display: el?.style?.display || 'block',
              visibility: el?.style?.visibility || 'visible'
            })
          },
          querySelectorAll: (sel: string) => (sel.includes('.dialog-test') ? [popupDialog] : [])
        };

        store.config.aiApiKey = 'sk-vue-async-test';
        (globalThis as any).GM_xmlhttpRequest = (opts: any) => {
          setTimeout(() => {
            opts.onload({
              status: 200,
              responseText: JSON.stringify({ choices: [{ message: { content: '["A", "C"]' } }] })
            });
          }, 5);
        };

        const ctrlPopup = new AbortController();
        const solvedPopup = await solveZhihuishuPopupTest(
          popupDoc,
          ctrlPopup.signal,
          () => true,
          { reactionDelayMs: 5, closeDelayMs: 5, verifyCloseDelayMs: 5 }
        );
        assert.equal(solvedPopup, true);
        assert.equal(pOpts[0].clickCount, 1, '弹题 Vue 异步选项 A 只允许点击 1 次');
        assert.equal(pOpts[0].isChecked, true, '弹题异步选项 A 最终必须保持选中');
        assert.equal(pOpts[1].clickCount, 0);
        assert.equal(pOpts[2].clickCount, 1, '弹题 Vue 异步选项 C 只允许点击 1 次');
        assert.equal(pOpts[2].isChecked, true, '弹题异步选项 C 最终必须保持选中');

        // 2. doQuizTask：.subject_node_list 内嵌 .el-checkbox-group 去重 + 嵌套无题干 .questionBox 剪枝 + 兄弟 .node_detail 提取 + Vue 异步防反选 + 跳过隐藏确认按钮 + confirm/alert 恢复
        const origConfirm = () => false;
        const origAlert = () => undefined;
        const mockWin: any = {
          location: new URL('https://onlineexamh5new.zhihuishu.com/stuExamWeb.html?recruitId=701&homeworkId=802'),
          confirm: origConfirm,
          alert: origAlert,
          setTimeout,
          clearTimeout,
          setInterval,
          clearInterval,
          addEventListener: () => {},
          removeEventListener: () => {}
        };
        (globalThis as any).window = mockWin;

        const qOpts = [
          makeAsyncCheckboxOpt({ letter: 'A', text: '正确内容甲', useNodeDetailSibling: true, delayMs: 10 }),
          makeAsyncCheckboxOpt({ letter: 'B', text: '正确内容乙', useNodeDetailSibling: true, delayMs: 10 }),
          makeAsyncCheckboxOpt({ letter: 'C', text: '错误干扰丙', useNodeDetailSibling: true, delayMs: 10 })
        ];

        const innerCheckboxGroup: any = { contains: () => false };
        const outerSubjectNodeList: any = {
          contains: (other: any) => other === innerCheckboxGroup
        };

        // 内嵌在 .examPaper_subject 内部且没有独立题干的 .questionBox，必须被 prunedNodes 剪枝而不重复作答
        const innerOptionOnlyBox: any = {
          getAttribute: () => null,
          closest: () => null,
          contains: () => false,
          querySelector: (sel: string) => {
            if (sel.includes('.subject_describe') || sel.includes('.mark_name')) return null;
            if (sel.includes('.subject_node')) return qOpts[0];
            return null;
          },
          querySelectorAll: (sel: string) => {
            if (sel.includes('.subject_node_list')) return [innerCheckboxGroup];
            return [];
          }
        };

        const outerSubject: any = {
          getAttribute: (k: string) => (k === 'data-id' ? 'nested-zhs-1' : null),
          closest: () => null,
          contains: (other: any) => other === innerOptionOnlyBox,
          cloneNode: function () { return this; },
          innerText: '【多选题】下列符合智慧树结构提取的选项有？',
          querySelector: (sel: string) => {
            if (sel.includes('.subject_type')) return { innerText: '【多选题】', textContent: '【多选题】' };
            if (sel.includes('.subject_describe')) return { innerText: '下列符合智慧树结构提取的选项有？', textContent: '下列符合智慧树结构提取的选项有？' };
            if (sel.includes(':checked') || sel.includes('.is-checked') || sel.includes('.nodeLab.active')) {
              return qOpts.some((o) => o.isChecked) ? {} : null;
            }
            if (sel.includes('.subject_node') || sel.includes('input[type="checkbox"]')) return qOpts[0];
            return null;
          },
          querySelectorAll: (sel: string) => {
            if (sel.includes('.subject_node_list') && sel.includes('.el-checkbox-group')) {
              return [outerSubjectNodeList, innerCheckboxGroup];
            }
            if (sel.includes('.subject_node') && !sel.includes('.nodeLab')) {
              return qOpts;
            }
            if (sel.includes('input[type="checkbox"]')) return qOpts;
            return [];
          }
        };

        let hiddenConfirmClicked = false;
        let visibleConfirmClicked = false;
        let submitBtnClicked = false;
        const hiddenConfirmBtn: any = {
          innerText: '确定提交',
          textContent: '确定提交',
          style: { display: 'none', visibility: '' },
          parentElement: null,
          classList: { contains: (c: string) => c === 'el-button--primary' },
          click: () => {
            hiddenConfirmClicked = true;
          }
        };
        const visibleConfirmBtn: any = {
          innerText: '确定提交',
          textContent: '确定提交',
          style: { display: '', visibility: '' },
          parentElement: null,
          classList: { contains: (c: string) => c === 'el-button--primary' },
          click: () => {
            visibleConfirmClicked = true;
          }
        };

        const examDoc1: any = {
          defaultView: mockWin,
          getComputedStyle: (el: any) => ({
            display: el?.style?.display || 'block',
            visibility: el?.style?.visibility || 'visible'
          }),
          querySelector: (sel: string) => {
            if (sel.includes('.examPaper_subject')) return outerSubject;
            if (sel.includes('title')) return { textContent: '嵌套列表与提交测试' };
            if (sel.includes('.exam-submit-btn')) {
              return {
                click: () => {
                  submitBtnClicked = true;
                }
              };
            }
            return null;
          },
          querySelectorAll: (sel: string) => {
            if (sel.includes('.examPaper_subject') && sel.includes('.questionBox')) {
              return [outerSubject, innerOptionOnlyBox];
            }
            if (sel.includes('.el-dialog__footer .el-button--primary')) {
              return [hiddenConfirmBtn, visibleConfirmBtn];
            }
            return [];
          }
        };
        mockWin.getComputedStyle = examDoc1.getComputedStyle;

        store.config.autoSubmitWork = true;
        store.config.enabledQuestionTypes = { single: true, multiple: true, judge: true, fill: true, essay: true };
        (globalThis as any).GM_xmlhttpRequest = (opts: any) => {
          setTimeout(() => {
            opts.onload({
              status: 200,
              responseText: JSON.stringify({ choices: [{ message: { content: '["A", "B"]' } }] })
            });
          }, 5);
        };

        await doQuizTask(null, examDoc1, { signal: new AbortController().signal, isCurrent: () => true });

        assert.equal(store.questions.length, 1, '内嵌无题干 .questionBox 与多层 .subject_node_list 不得重复或丢弃题目');
        assert.deepEqual(store.questions[0].options, ['正确内容甲', '正确内容乙', '错误干扰丙'], '必须通过兄弟 .node_detail 准确提取选项文本');
        assert.equal(qOpts[0].clickCount, 1, 'doQuizTask Vue 异步选项 A 仅点击 1 次');
        assert.equal(qOpts[0].isChecked, true);
        assert.equal(qOpts[1].clickCount, 1, 'doQuizTask Vue 异步选项 B 仅点击 1 次');
        assert.equal(qOpts[1].isChecked, true);
        assert.equal(submitBtnClicked, true);
        assert.equal(hiddenConfirmClicked, false, '必须跳过 display:none 隐藏确认按钮');
        assert.equal(visibleConfirmClicked, true, '必须准确点击可见的确认按钮');
        assert.equal(mockWin.confirm, origConfirm, 'doQuizTask 结束后必须恢复原 targetWin.confirm');
        assert.equal(mockWin.alert, origAlert, 'doQuizTask 结束后必须恢复原 targetWin.alert');

        // 3. enabledQuestionTypes 取消勾选某题型时跳过作答并熔断 cancelAutoSubmit
        store.config.autoSubmitWork = true;
        store.config.enabledQuestionTypes = { single: true, multiple: true, judge: true, fill: false, essay: true };

        const fillSkipNode: any = {
          getAttribute: () => 'q-fill-skip',
          closest: () => null,
          contains: () => false,
          cloneNode: function () { return this; },
          innerText: '【填空题】被禁用的填空题',
          querySelector: (sel: string) => {
            if (sel.includes('.subject_type')) return { innerText: '【填空题】', textContent: '【填空题】' };
            if (sel.includes('.subject_describe')) return { innerText: '被禁用的填空题', textContent: '被禁用的填空题' };
            if (sel.includes('textarea') || sel.includes('input')) return { type: 'text', value: '' };
            return null;
          },
          querySelectorAll: () => []
        };
        const singleNormalOpt = makeAsyncCheckboxOpt({ letter: 'A', text: '唯一答案', delayMs: 5 });
        const singleNormalNode: any = {
          getAttribute: () => 'q-single-ok',
          closest: () => null,
          contains: () => false,
          cloneNode: function () { return this; },
          innerText: '【单选题】正常启用的单选题',
          querySelector: (sel: string) => {
            if (sel.includes('.subject_type')) return { innerText: '【单选题】', textContent: '【单选题】' };
            if (sel.includes('.subject_describe')) return { innerText: '正常启用的单选题', textContent: '正常启用的单选题' };
            if (sel.includes(':checked') || sel.includes('.is-checked') || sel.includes('.nodeLab.active')) {
              return singleNormalOpt.isChecked ? {} : null;
            }
            if (sel.includes('.subject_node') || sel.includes('input')) return singleNormalOpt;
            return null;
          },
          querySelectorAll: (sel: string) => {
            if (sel.includes('.subject_node_list')) return [];
            if (sel.includes('.subject_node') && !sel.includes('.nodeLab')) return [singleNormalOpt];
            if (sel.includes('.el-radio') || sel.includes('input[type="radio"]')) return [singleNormalOpt];
            return [];
          }
        };

        let disabledSubmitCalled = false;
        let disabledSaveCalled = false;
        const examDocDisabled: any = {
          defaultView: mockWin,
          querySelector: (sel: string) => {
            if (sel.includes('.examPaper_subject')) return fillSkipNode;
            if (sel.includes('title')) return { textContent: '禁用题型熔断测试' };
            if (sel.includes('.exam-submit-btn')) return { click: () => { disabledSubmitCalled = true; } };
            if (sel.includes('.save-btn')) return { click: () => { disabledSaveCalled = true; } };
            return null;
          },
          querySelectorAll: (sel: string) => {
            if (sel.includes('.examPaper_subject') && sel.includes('.questionBox')) {
              return [fillSkipNode, singleNormalNode];
            }
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

        await doQuizTask(null, examDocDisabled, { signal: new AbortController().signal, isCurrent: () => true });
        assert.equal(disabledSubmitCalled, false, '存在被禁用跳过的题型时必须熔断自动提交');
        assert.equal(disabledSaveCalled, true, '熔断自动提交后应转为点击暂存按钮');
      } finally {
        clearExamAutoResumeState();
        (globalThis as any).window = prevWin;
        (globalThis as any).GM_xmlhttpRequest = prevXhr;
        (globalThis as any).sessionStorage = prevSession;
        store.config.aiApiKey = prevKey;
        store.config.autoSubmitWork = prevAutoSubmit;
        store.config.enabledQuestionTypes = prevEnabledTypes;
      }
    });

    it('25.7 随堂弹题未关闭防 AI 刷费雪崩熔断与 v-show 隐藏题干过滤', async () => {
      const prevXhr = (globalThis as any).GM_xmlhttpRequest;
      const prevKey = store.config.aiApiKey;
      store.acknowledgeAllErrors();

      const makeDocView = () => ({
        getComputedStyle: (el: any) => ({
          display: el?.style?.display || 'block',
          visibility: el?.style?.visibility || 'visible'
        })
      });

      try {
        // 1. v-show 隐藏题干 1 + 可见题干 2 -> 必须只抓取可见题干 2
        const hiddenTitle: any = {
          innerText: '1. (单选题) v-show 隐藏的旧题干',
          textContent: '1. (单选题) v-show 隐藏的旧题干',
          style: { display: 'none', visibility: '' },
          parentElement: null
        };
        const visibleTitle: any = {
          innerText: '2. (单选题) v-show 可见的真实题干',
          textContent: '2. (单选题) v-show 可见的真实题干',
          style: { display: '', visibility: '' },
          parentElement: null
        };
        const vshowOptA: any = {
          innerText: 'A. 选项甲',
          textContent: 'A. 选项甲',
          style: { display: '', visibility: '' },
          parentElement: null,
          contains: () => false,
          selected: false,
          classList: { contains: (c: string) => vshowOptA.selected && c === 'active' },
          getAttribute: () => (vshowOptA.selected ? 'true' : null),
          click: () => {
            vshowOptA.selected = true;
          },
          querySelector: (sel: string) => {
            if (sel.includes('.topic-text')) return { innerText: '选项甲', textContent: '选项甲' };
            if (sel.includes('input')) return { value: 'A', checked: vshowOptA.selected };
            return null;
          }
        };

        let capturedPromptForVshow = '';
        store.config.aiApiKey = 'sk-zhs-vshow-circuit';
        (globalThis as any).GM_xmlhttpRequest = (opts: any) => {
          capturedPromptForVshow = JSON.stringify(JSON.parse(opts.data).messages);
          setTimeout(() => {
            opts.onload({
              status: 200,
              responseText: JSON.stringify({ choices: [{ message: { content: '["A"]' } }] })
            });
          }, 5);
        };

        const vshowDialog: any = {
          style: { display: '', visibility: '' },
          parentElement: null,
          closest: () => null,
          innerText: 'v-show 测试',
          querySelector: () => null,
          querySelectorAll: (sel: string) => {
            if (sel.includes('.topic-title')) return [hiddenTitle, visibleTitle];
            if (sel.includes('.topic-num-item')) return [];
            if (sel.includes('.topic-item')) return [vshowOptA];
            if (sel.includes('input[type="radio"]')) return [vshowOptA];
            if (sel.includes('button')) {
              return [
                {
                  innerText: '关闭',
                  textContent: '关闭',
                  disabled: false,
                  style: { display: '', visibility: '' },
                  parentElement: null,
                  classList: { contains: () => false },
                  hasAttribute: () => false,
                  getAttribute: () => null,
                  click: () => {
                    vshowDialog.style.display = 'none';
                  }
                }
              ];
            }
            return [];
          }
        };
        const vshowDoc: any = {
          defaultView: makeDocView(),
          querySelectorAll: (sel: string) => (sel.includes('.dialog-test') ? [vshowDialog] : [])
        };

        const vshowRes = await solveZhihuishuPopupTest(
          vshowDoc,
          new AbortController().signal,
          () => true,
          { reactionDelayMs: 5, closeDelayMs: 5, verifyCloseDelayMs: 5 }
        );
        assert.equal(vshowRes, true);
        assert.ok(capturedPromptForVshow.includes('v-show 可见的真实题干'), '必须提取可见题干 2');
        assert.ok(!capturedPromptForVshow.includes('v-show 隐藏的旧题干'), '绝不可提取 v-show 隐藏题干 1');

        // 2. 弹题关闭按钮失效防 AI 刷费雪崩熔断（最多 2 次后熔断，写入 pinnedErrors，不误触 play）
        store.acknowledgeAllErrors();
        let circuitAiCalls = 0;
        (globalThis as any).GM_xmlhttpRequest = (opts: any) => {
          circuitAiCalls++;
          setTimeout(() => {
            opts.onload({
              status: 200,
              responseText: JSON.stringify({ choices: [{ message: { content: '["A"]' } }] })
            });
          }, 5);
        };

        const stubOptA: any = {
          innerText: 'A. 卡死弹窗选项',
          textContent: 'A. 卡死弹窗选项',
          style: { display: '', visibility: '' },
          parentElement: null,
          contains: () => false,
          selected: false,
          classList: { contains: (c: string) => stubOptA.selected && c === 'active' },
          getAttribute: () => (stubOptA.selected ? 'true' : null),
          click: () => {
            stubOptA.selected = true;
          },
          querySelector: (sel: string) => {
            if (sel.includes('.topic-text')) return { innerText: '卡死弹窗选项', textContent: '卡死弹窗选项' };
            if (sel.includes('input')) return { value: 'A', checked: stubOptA.selected };
            return null;
          }
        };
        const stubbornDialog: any = {
          style: { display: '', visibility: '' },
          parentElement: null,
          closest: () => null,
          innerText: '卡死无法关闭的弹题',
          querySelector: () => null,
          querySelectorAll: (sel: string) => {
            if (sel.includes('.topic-title')) {
              return [{ innerText: '1. 卡死弹题标题', textContent: '1. 卡死弹题标题', style: { display: '', visibility: '' }, parentElement: null }];
            }
            if (sel.includes('.topic-num-item')) return [];
            if (sel.includes('.topic-item')) return [stubOptA];
            if (sel.includes('input[type="radio"]')) return [stubOptA];
            if (sel.includes('button')) {
              return [
                {
                  innerText: '关闭',
                  textContent: '关闭',
                  disabled: false,
                  style: { display: '', visibility: '' },
                  parentElement: null,
                  classList: { contains: () => false },
                  hasAttribute: () => false,
                  getAttribute: () => null,
                  click: () => {
                    // 模拟关闭失效：弹窗仍然保持可见
                  }
                }
              ];
            }
            return [];
          }
        };

        let videoPlayCount = 0;
        const circuitVideo: any = {
          playbackRate: 1.0,
          muted: true,
          duration: 120,
          currentTime: 10,
          paused: true,
          ended: false,
          isConnected: true,
          play: async () => {
            videoPlayCount++;
            circuitVideo.paused = false;
          },
          pause: () => {
            circuitVideo.paused = true;
          },
          addEventListener: () => {},
          removeEventListener: () => {}
        };
        const circuitDoc: any = {
          defaultView: makeDocView(),
          querySelector: (sel: string) => (sel.includes('video') ? circuitVideo : null),
          querySelectorAll: (sel: string) => (sel.includes('.dialog-test') ? [stubbornDialog] : [])
        };

        const circuitCtrl = new AbortController();
        const taskPromise = playZhihuishuVideoTask(
          circuitDoc,
          { signal: circuitCtrl.signal, isCurrent: () => true },
          { pollIntervalMs: 25, popupTiming: { reactionDelayMs: 5, closeDelayMs: 5, verifyCloseDelayMs: 5 } }
        );

        // 等待足够多轮 poll tick（>10 轮）验证熔断后不再发 AI 请求
        await new Promise((r) => setTimeout(r, 380));
        circuitCtrl.abort();
        await taskPromise;

        assert.equal(circuitAiCalls, 2, '弹窗关闭失效时最多重试 2 次即触发熔断，绝不无限刷 AI');
        assert.equal(videoPlayCount, 0, '未关闭弹题前绝不可误触 video.play()');
        assert.ok(
          store.pinnedErrors.some((e) => e.message.includes('智慧树随堂弹题未能自动关闭，已停止重试以防异常')),
          '熔断后必须向 store.pinnedErrors 写入红色置顶告警'
        );
      } finally {
        (globalThis as any).GM_xmlhttpRequest = prevXhr;
        store.config.aiApiKey = prevKey;
        store.acknowledgeAllErrors();
      }
    });

    it('25.8 调度防劫持与 SPA 边界：.dialog-test 不触发 isStandaloneQuiz、全课完播防重入/切集冷却、onPause 互斥、路由切出释放与 video 重连', async () => {
      const prevWin = (globalThis as any).window;
      const prevDoc = (globalThis as any).document;
      const prevAutoNext = store.config.autoNextChapter;
      const prevDelayBase = store.config.randomDelayBase;
      const prevDelayJitter = store.config.randomDelayJitter;

      const makeDocView = () => ({
        getComputedStyle: (el: any) => ({
          display: el?.style?.display || 'block',
          visibility: el?.style?.visibility || 'visible'
        })
      });

      try {
        clearZhihuishuCompletionSuppression();

        // 1. 视频页顶层挂有 .dialog-test（含 .subject_describe 与 .el-radio）时，isStandaloneQuiz 返回 false 且不被 Step 0 劫持
        const setUrl = (u: string) => {
          const parsed = new URL(u);
          (globalThis as any).window = {
            location: {
              href: parsed.href,
              hostname: parsed.hostname,
              pathname: parsed.pathname,
              search: parsed.search
            },
            setTimeout,
            clearTimeout,
            setInterval,
            clearInterval,
            addEventListener: () => {},
            removeEventListener: () => {}
          };
        };

        setUrl('https://studyvideoh5.zhihuishu.com/videoStudy.html?recruitAndCourseId=555');
        const popupRadioEl: any = {
          closest: (sel: string) => (sel.includes('.dialog-test') ? {} : null)
        };
        const popupQuestionBoxEl: any = {
          closest: (sel: string) => (sel.includes('.dialog-test') ? {} : null)
        };
        let videoStartAttempted = false;
        const vidWithPopup: any = {
          playbackRate: 1.0,
          muted: true,
          duration: 100,
          currentTime: 0,
          paused: true,
          ended: false,
          isConnected: true,
          play: async () => {
            videoStartAttempted = true;
            vidWithPopup.paused = false;
          },
          pause: () => {
            vidWithPopup.paused = true;
          },
          addEventListener: () => {},
          removeEventListener: () => {}
        };
        (globalThis as any).document = {
          readyState: 'complete',
          location: (globalThis as any).window.location,
          defaultView: makeDocView(),
          documentElement: { querySelectorAll: () => [] },
          querySelector: (sel: string) => {
            if (sel.includes('#vjs_container_html5_api')) return vidWithPopup;
            if (sel.includes('.examPaper_subject')) return popupQuestionBoxEl;
            return null;
          },
          querySelectorAll: (sel: string) => {
            if (sel.includes('.examPaper_subject')) return [popupQuestionBoxEl];
            if (sel.includes('.el-radio')) return [popupRadioEl];
            return [];
          }
        };

        const schedPopup = new ChapterScheduler();
        assert.equal(isZhihuishuExamPage((globalThis as any).document), false, '弹题内部元素不可误判为智慧树考试页');
        assert.equal((schedPopup as any).isStandaloneQuiz((globalThis as any).document), false, '视频页含 .dialog-test 时 isStandaloneQuiz 必须为 false');
        const pipeP = (schedPopup as any).runPipeline();
        assert.equal((schedPopup as any).isZhihuishuVideoRunning, true, '必须进入智慧树视频调度流程而不被 Step 0 劫持');
        (schedPopup as any).watchdog.abort();
        await pipeP;
        assert.equal(videoStartAttempted, false);

        // 2. 完播后在 autoNextChapter === false 或无下一集时，连续 runPipeline 不重启；切换到新小节自动恢复
        clearZhihuishuCompletionSuppression();
        store.config.autoNextChapter = false;
        let currentLessonTitle = '1.1 第一节';
        let currentVideoSrc = 'https://cdn.zhihuishu.com/v1.mp4';
        const lessonListeners = new Map<string, Set<Function>>();
        let lessonPlayCount = 0;

        const lessonVideo: any = {
          playbackRate: 1.0,
          muted: true,
          duration: 100,
          currentTime: 0,
          paused: true,
          ended: false,
          isConnected: true,
          get src() {
            return currentVideoSrc;
          },
          get currentSrc() {
            return currentVideoSrc;
          },
          play: async () => {
            lessonPlayCount++;
            lessonVideo.paused = false;
          },
          pause: () => {
            lessonVideo.paused = true;
          },
          addEventListener: (ev: string, fn: Function) => {
            if (!lessonListeners.has(ev)) lessonListeners.set(ev, new Set());
            lessonListeners.get(ev)!.add(fn);
          },
          removeEventListener: (ev: string, fn: Function) => {
            lessonListeners.get(ev)?.delete(fn);
          }
        };
        const lessonDoc: any = {
          location: (globalThis as any).window.location,
          defaultView: makeDocView(),
          querySelector: (sel: string) => {
            if (sel.includes('.current_play .catalogue_title')) {
              return { innerText: currentLessonTitle, textContent: currentLessonTitle };
            }
            if (sel.includes('.active.video')) return null;
            if (sel.includes('#vjs_container_html5_api') || sel.includes('video')) return lessonVideo;
            return null;
          },
          querySelectorAll: () => []
        };

        clearZhihuishuCompletionSuppression();
        lessonPlayCount = 0;
        const finishCtrl = new AbortController();
        const finishTask = playZhihuishuVideoTask(
          lessonDoc,
          { signal: finishCtrl.signal, isCurrent: () => true },
          { pollIntervalMs: 20 }
        );
        try {
          await new Promise((r) => setTimeout(r, 45));
          assert.equal(lessonPlayCount, 1);
          lessonVideo.ended = true;
          for (const fn of lessonListeners.get('ended') || []) fn();
          await finishTask;
        } finally {
          finishCtrl.abort();
          await finishTask.catch(() => {});
        }

        const completedKey = getLastCompletedZhihuishuLessonKey();
        assert.ok(completedKey && completedKey.includes('1.1 第一节'), '完播后必须记录当前小节抑制 key');

        // 连续调用 ChapterScheduler.runPipeline() 不得重启同小节播放
        (globalThis as any).document = {
          ...lessonDoc,
          readyState: 'complete',
          documentElement: { querySelectorAll: () => [] }
        };
        const schedSuppress = new ChapterScheduler();
        await (schedSuppress as any).runPipeline();
        await (schedSuppress as any).runPipeline();
        assert.equal(lessonPlayCount, 1, '同小节完播后连续心跳绝不可无限重启');

        // 用户切换到新小节 1.2 后，自动解除抑制并启动新视频
        currentLessonTitle = '1.2 第二节';
        currentVideoSrc = 'https://cdn.zhihuishu.com/v2.mp4';
        lessonVideo.ended = false;
        lessonVideo.paused = true;
        assert.notEqual(getZhihuishuLessonKey(lessonDoc, lessonVideo), completedKey);
        const newLessonP = (schedSuppress as any).runPipeline();
        await new Promise((r) => setTimeout(r, 40));
        assert.equal((schedSuppress as any).isZhihuishuVideoRunning, true, '切换至新小节后必须自动解除抑制并进入新视频任务');
        assert.equal(getLastCompletedZhihuishuLessonKey(), null);
        (schedSuppress as any).watchdog.abort();
        await newLessonP;

        // 3. SPA 切集等待超时进入防连跳冷却期
        clearZhihuishuCompletionSuppression();
        store.config.autoNextChapter = true;
        store.config.randomDelayBase = 0.5;
        store.config.randomDelayJitter = 0;

        const stuckListeners = new Map<string, Set<Function>>();
        let nextLessonClicks = 0;
        const stuckVideo: any = {
          playbackRate: 1.0,
          muted: true,
          duration: 100,
          currentTime: 0,
          paused: true,
          ended: false,
          isConnected: true,
          src: 'https://cdn.zhihuishu.com/stuck.mp4',
          play: async () => { stuckVideo.paused = false; },
          pause: () => { stuckVideo.paused = true; },
          addEventListener: (ev: string, fn: Function) => {
            if (!stuckListeners.has(ev)) stuckListeners.set(ev, new Set());
            stuckListeners.get(ev)!.add(fn);
          },
          removeEventListener: (ev: string, fn: Function) => {
            stuckListeners.get(ev)?.delete(fn);
          }
        };
        const stuckDoc: any = {
          location: (globalThis as any).window.location,
          defaultView: makeDocView(),
          querySelector: (sel: string) => {
            if (sel.includes('.current_play .catalogue_title')) return { innerText: '1.1 卡住节', textContent: '1.1 卡住节' };
            if (sel.includes('.active.video')) return null;
            if (sel.includes('#vjs_container_html5_api') || sel.includes('video')) return stuckVideo;
            return null;
          },
          querySelectorAll: (sel: string) => {
            if (sel.includes('.next_lesson')) {
              return [
                {
                  disabled: false,
                  style: { display: '', visibility: '' },
                  classList: { contains: () => false },
                  hasAttribute: () => false,
                  getAttribute: () => null,
                  click: () => {
                    nextLessonClicks++;
                    // 故意不切换 DOM
                  }
                }
              ];
            }
            return [];
          }
        };
        const stuckCtrl = new AbortController();
        const stuckTask = playZhihuishuVideoTask(
          stuckDoc,
          { signal: stuckCtrl.signal, isCurrent: () => true },
          { pollIntervalMs: 20, switchWaitTimeoutMs: 60 }
        );
        try {
          await new Promise((r) => setTimeout(r, 45));
          stuckVideo.ended = true;
          for (const fn of stuckListeners.get('ended') || []) fn();
          await stuckTask;
          assert.equal(nextLessonClicks, 1);
          assert.ok(getZhihuishuSwitchCooldownUntil() > Date.now(), '切集未切换超时后必须开启冷却时间戳防止连跳');
        } finally {
          stuckCtrl.abort();
          await stuckTask.catch(() => {});
        }

        // 冷却期内 ChapterScheduler.runPipeline 直接返回不触发 playZhihuishuVideoTask
        const schedCooldown = new ChapterScheduler();
        (globalThis as any).document = {
          ...stuckDoc,
          readyState: 'complete',
          documentElement: { querySelectorAll: () => [] }
        };
        await (schedCooldown as any).runPipeline();
        assert.equal((schedCooldown as any).isZhihuishuVideoRunning, false, '冷却期内绝不能连跳或重入');
        clearZhihuishuCompletionSuppression();

        // 4. 高频 pause 互斥 + <video> 断开重连 + SPA 路由切出释放
        const v1Listeners = new Map<string, Set<Function>>();
        const v2Listeners = new Map<string, Set<Function>>();
        let v1PlayCalls = 0;
        let v2PlayCalls = 0;
        let activeVideoIndex = 1;

        const v1: any = {
          playbackRate: 1.0,
          muted: true,
          duration: 100,
          currentTime: 0,
          paused: true,
          ended: false,
          isConnected: true,
          play: async () => {
            v1PlayCalls++;
            v1.paused = false;
          },
          pause: () => {
            v1.paused = true;
          },
          addEventListener: (ev: string, fn: Function) => {
            if (!v1Listeners.has(ev)) v1Listeners.set(ev, new Set());
            v1Listeners.get(ev)!.add(fn);
          },
          removeEventListener: (ev: string, fn: Function) => {
            v1Listeners.get(ev)?.delete(fn);
          }
        };
        const v2: any = {
          playbackRate: 2.0,
          muted: false,
          duration: 100,
          currentTime: 0,
          paused: true,
          ended: false,
          isConnected: true,
          play: async () => {
            v2PlayCalls++;
            v2.paused = false;
          },
          pause: () => {
            v2.paused = true;
          },
          addEventListener: (ev: string, fn: Function) => {
            if (!v2Listeners.has(ev)) v2Listeners.set(ev, new Set());
            v2Listeners.get(ev)!.add(fn);
          },
          removeEventListener: (ev: string, fn: Function) => {
            v2Listeners.get(ev)?.delete(fn);
          }
        };

        const dynamicDoc: any = {
          location: (globalThis as any).window.location,
          defaultView: makeDocView(),
          querySelector: (sel: string) => {
            if (activeVideoIndex === 0) return null;
            if (sel.includes('video')) return activeVideoIndex === 1 ? v1 : v2;
            return null;
          },
          querySelectorAll: () => []
        };

        store.config.randomDelayBase = 0.5;
        store.config.randomDelayJitter = 0;
        const dynamicCtrl = new AbortController();
        const dynamicTask = playZhihuishuVideoTask(
          dynamicDoc,
          { signal: dynamicCtrl.signal, isCurrent: () => true },
          { pollIntervalMs: 25 }
        );

        try {
          await new Promise((r) => setTimeout(r, 45));
          assert.equal(v1PlayCalls, 1);

          // 连续触发 5 次 pause 事件，验证 isRecoveringPause 互斥只触发 1 次恢复 play()
          v1.paused = true;
          for (let i = 0; i < 5; i++) {
            for (const fn of v1Listeners.get('pause') || []) void fn();
          }
          await new Promise((r) => setTimeout(r, 560));
          assert.equal(v1PlayCalls, 2, '高频连发 pause 事件仅允许 1 次恢复 play() 调用');

          // 模拟 SPA 替换 <video>：v1 断开连接 (isConnected = false)，切换到 v2
          v1.isConnected = false;
          activeVideoIndex = 2;
          await new Promise((r) => setTimeout(r, 70));
          assert.equal(v1Listeners.get('pause')?.size, 0, '旧 video 断开后必须解绑监听器');
          assert.equal(v2PlayCalls, 1, '必须自动重绑新 video 并启动播放');
          assert.equal(v2.playbackRate, 1.0, '重绑新 video 必须锁定 1.0x 原速');
          assert.equal(v2.muted, true, '重绑新 video 必须锁定静音');

          // 模拟 SPA 路由切出视频页 -> 轮询检测到 !isZhihuishuVideoPage(doc) 立即退出并暂停
          activeVideoIndex = 0;
          setUrl('https://www.zhihuishu.com/portal');
          dynamicDoc.location = (globalThis as any).window.location;
          await dynamicTask;
          assert.equal(v2.paused, true, '路由离开视频页后必须立即退出并暂停视频');
          assert.equal(v2Listeners.get('pause')?.size, 0, '路由切出退出后必须释放全部监听器');
        } finally {
          dynamicCtrl.abort();
          await dynamicTask.catch(() => {});
        }
      } finally {
        clearZhihuishuCompletionSuppression();
        (globalThis as any).window = prevWin;
        (globalThis as any).document = prevDoc;
        store.config.autoNextChapter = prevAutoNext;
        store.config.randomDelayBase = prevDelayBase;
        store.config.randomDelayJitter = prevDelayJitter;
      }
    });

    it('25.9 新版 AI 随堂练习弹窗与轻提示弹窗 (videoConfigTip01) 两阶段作答与自动关闭测试', async () => {
      const prevXhr = (globalThis as any).GM_xmlhttpRequest;
      const prevKey = store.config.aiApiKey;

      try {
        store.config.aiApiKey = 'sk-zhs-ai-practice';

        let submittedStage = false;
        let submitClicks = 0;
        let continueClicks = 0;

        const makeAiOptionRow = (letter: string, label: string) => {
          let active = false;
          const badgeChild: any = { innerText: letter, textContent: letter };
          const textChild: any = { innerText: label, textContent: label };
          const row: any = {
            tagName: 'DIV',
            children: [badgeChild, textChild],
            innerText: `${letter} ${label}`,
            textContent: `${letter}${label}`,
            style: { display: '', visibility: '' },
            parentElement: null,
            closest: () => null,
            contains: (other: any) => other === badgeChild || other === textChild,
            classList: {
              contains: (c: string) => active && (c === 'active' || c === 'is-active' || c === 'selected')
            },
            getAttribute: () => (active ? 'true' : null),
            click: () => {
              active = true;
            },
            querySelector: () => null,
            querySelectorAll: () => [],
            get isSelected() {
              return active;
            }
          };
          return row;
        };

        const aiOpts = [
          makeAiOptionRow('A', '线性回归'),
          makeAiOptionRow('B', '支持向量机'),
          makeAiOptionRow('C', 'K均值聚类'),
          makeAiOptionRow('D', '随机森林')
        ];

        const submitActionDiv: any = {
          tagName: 'DIV',
          className: 'submit-btn',
          innerText: '提交作答',
          textContent: '提交作答',
          style: { display: '', visibility: '' },
          parentElement: null,
          closest: () => null,
          contains: () => false,
          classList: { contains: () => false },
          hasAttribute: () => false,
          getAttribute: () => null,
          click: () => {
            submitClicks++;
            submittedStage = true;
          }
        };

        const continueActionBtn: any = {
          tagName: 'BUTTON',
          className: 'continue-btn',
          innerText: '继续学习',
          textContent: '继续学习',
          disabled: false,
          style: { display: '', visibility: '' },
          parentElement: null,
          closest: () => null,
          contains: () => false,
          classList: { contains: () => false },
          hasAttribute: () => false,
          getAttribute: () => null,
          click: () => {
            continueClicks++;
            aiPracticeDialog.style.display = 'none';
          }
        };

        const headerEl: any = {
          tagName: 'DIV',
          innerText: 'AI随堂练习',
          textContent: 'AI随堂练习',
          style: { display: '', visibility: '' },
          closest: () => null
        };

        const aiPracticeDialog: any = {
          tagName: 'DIV',
          className: 'el-dialog',
          style: { display: '', visibility: '' },
          parentElement: null,
          closest: () => null,
          contains: (other: any) =>
            aiOpts.includes(other) || other === submitActionDiv || other === continueActionBtn,
          get innerText() {
            const actionLabel = submittedStage ? '继续学习' : '提交作答';
            return [
              'AI随堂练习',
              '以下所有内容均由AI生成请注意甄别',
              '1. [单选题]',
              '在人工智能中，以下哪种算法主要用于处理分类问题？',
              'A 线性回归',
              'B 支持向量机',
              'C K均值聚类',
              'D 随机森林',
              actionLabel
            ].join('\n');
          },
          get textContent() {
            return this.innerText;
          },
          querySelector: (sel: string) => {
            if (sel.includes('button') && submittedStage) return continueActionBtn;
            return null;
          },
          querySelectorAll: (sel: string) => {
            if (sel.includes('.topic-title') || sel.includes('.title')) return [headerEl];
            if (sel.includes('.topic-num-item')) return [];
            if (sel.includes('.topic-item') || sel.includes('.el-radio')) return [];
            if (sel.includes('li, div, p, label')) return [...aiOpts, submitActionDiv, continueActionBtn];
            if (sel.includes('button') || sel.includes('[class*="submit"]')) {
              return submittedStage ? [continueActionBtn] : [submitActionDiv];
            }
            return [];
          }
        };

        let tipDismissClicked = false;
        const tipOkBtn: any = {
          tagName: 'BUTTON',
          className: 'ok-pill',
          innerText: '好的',
          textContent: '好的',
          disabled: false,
          style: { display: '', visibility: '' },
          parentElement: null,
          closest: () => null,
          contains: () => false,
          classList: { contains: () => false },
          hasAttribute: () => false,
          getAttribute: () => null,
          click: () => {
            tipDismissClicked = true;
            tipDialog.style.display = 'none';
          }
        };
        const tipDialog: any = {
          tagName: 'DIV',
          className: 'el-dialog tip-modal',
          style: { display: 'none', visibility: '' },
          parentElement: null,
          closest: () => null,
          contains: (other: any) => other === tipOkBtn,
          innerText: 'videoConfigTip01\n好的',
          textContent: 'videoConfigTip01\n好的',
          querySelector: () => null,
          querySelectorAll: (sel: string) => {
            if (sel.includes('button') || sel.includes('.btn')) return [tipOkBtn];
            return [];
          }
        };

        const aiDoc: any = {
          defaultView: {
            getComputedStyle: (el: any) => ({
              display: el?.style?.display || 'block',
              visibility: el?.style?.visibility || 'visible'
            })
          },
          querySelectorAll: (sel: string) => {
            if (sel.includes('.dialog-test') || sel === '.el-dialog__wrapper') return [];
            if (sel.includes('[role="dialog"]') || sel.includes('.el-dialog') || sel.includes('[class*="tip"]')) {
              return [aiPracticeDialog, tipDialog];
            }
            return [];
          }
        };

        // 1. 当 AI随堂练习 激活时，findVisiblePopupTestDialog 必须捕获它，且 dismissZhihuishuTipDialog 不可误触测验弹窗
        assert.equal(findVisiblePopupTestDialog(aiDoc), aiPracticeDialog, '必须识别新版 AI随堂练习 弹窗');
        assert.equal(dismissZhihuishuTipDialog(aiDoc), false, '轻提示关闭逻辑不可误关测验弹窗');

        let aiPromptSeen = '';
        (globalThis as any).GM_xmlhttpRequest = (opts: any) => {
          aiPromptSeen = JSON.stringify(JSON.parse(opts.data).messages);
          setTimeout(() => {
            opts.onload({
              status: 200,
              responseText: JSON.stringify({ choices: [{ message: { content: '["B"]' } }] })
            });
          }, 5);
        };

        const ctrl = new AbortController();
        const solved = await solveZhihuishuPopupTest(
          aiDoc,
          ctrl.signal,
          () => true,
          { reactionDelayMs: 5, closeDelayMs: 5, verifyCloseDelayMs: 5 }
        );

        assert.equal(solved, true, '两阶段提交并点击继续学习后应关闭弹窗并返回 true');
        assert.ok(aiPromptSeen.includes('线性回归') && aiPromptSeen.includes('随机森林'), '纯 div 圆形选项文本必须完整传给 AI');
        assert.equal(aiOpts[1].isSelected, true, '必须选中选项 B（支持向量机）');
        assert.equal(submitClicks, 1, '第 1 阶段必须点击【提交作答】');
        assert.equal(continueClicks, 1, '第 2 阶段必须点击【继续学习】关闭解析页');
        assert.equal(findVisiblePopupTestDialog(aiDoc), null);

        // 2. 激活 videoConfigTip01 轻提示框后，dismissZhihuishuTipDialog 自动点击【好的】
        tipDialog.style.display = '';
        assert.equal(dismissZhihuishuTipDialog(aiDoc), true, '必须识别并自动关闭 videoConfigTip01 弹窗');
        assert.equal(tipDismissClicked, true, '必须点击【好的】按钮');
        assert.equal(tipDialog.style.display, 'none');
      } finally {
        (globalThis as any).GM_xmlhttpRequest = prevXhr;
        store.config.aiApiKey = prevKey;
      }
    });

    it('25.10 上下文感知按钮文案 (开始刷课/暂停刷课 vs 开始答题/暂停答题) 与暂停/恢复/手动弹题联动测试', async () => {
      const prevWin = (globalThis as any).window;
      const prevDoc = (globalThis as any).document;
      const prevXhr = (globalThis as any).GM_xmlhttpRequest;
      const prevKey = store.config.aiApiKey;

      try {
        clearZhihuishuCompletionSuppression();
        store.acknowledgeAllErrors();

        // 1. 验证 FloatingCard 主按钮随 actionMode 自动切换文案
        const mod = await import('../src/ui/floating-card');
        const card = new mod.FloatingCard();

        store.setActionMode('quiz');
        store.setQuizRunning(false);
        store.setCourseRunning(false);
        store.updateProgress({ status: 'idle', title: '等待任务开始...', percent: 0 });
        assert.deepEqual((card as any).getPrimaryActionState(), { text: '开始答题', stateClass: 'start' });

        store.setQuizRunning(true);
        assert.deepEqual((card as any).getPrimaryActionState(), { text: '暂停答题', stateClass: 'pause' });

        store.setQuizRunning(false);
        store.updateProgress({ status: 'paused' });
        assert.deepEqual((card as any).getPrimaryActionState(), { text: '继续答题', stateClass: 'resume' });

        store.setActionMode('course');
        store.updateProgress({ status: 'idle' });
        assert.deepEqual((card as any).getPrimaryActionState(), { text: '开始刷课', stateClass: 'start' });

        store.setCourseRunning(true);
        assert.deepEqual((card as any).getPrimaryActionState(), { text: '暂停刷课', stateClass: 'pause' });

        store.setCourseRunning(false);
        store.updateProgress({ status: 'paused' });
        assert.deepEqual((card as any).getPrimaryActionState(), { text: '继续刷课', stateClass: 'resume' });

        // 2. 验证 ChapterScheduler 在智慧树视频页的 togglePrimaryAction 暂停/恢复真实联动
        const setUrl = (u: string) => {
          const parsed = new URL(u);
          (globalThis as any).window = {
            location: {
              href: parsed.href,
              hostname: parsed.hostname,
              pathname: parsed.pathname,
              search: parsed.search
            },
            setTimeout,
            clearTimeout,
            setInterval,
            clearInterval,
            addEventListener: () => {},
            removeEventListener: () => {}
          };
        };

        setUrl('https://studyvideoh5.zhihuishu.com/videoStudy.html?recruitAndCourseId=999');
        let coursePlayCalls = 0;
        let coursePauseCalls = 0;
        const vidObj: any = {
          playbackRate: 1.0,
          muted: true,
          duration: 120,
          currentTime: 10,
          paused: true,
          ended: false,
          isConnected: true,
          play: async () => {
            coursePlayCalls++;
            vidObj.paused = false;
          },
          pause: () => {
            coursePauseCalls++;
            vidObj.paused = true;
          },
          addEventListener: () => {},
          removeEventListener: () => {}
        };
        (globalThis as any).document = {
          readyState: 'complete',
          location: (globalThis as any).window.location,
          defaultView: {
            getComputedStyle: (el: any) => ({
              display: el?.style?.display || 'block',
              visibility: el?.style?.visibility || 'visible'
            })
          },
          documentElement: { querySelectorAll: () => [] },
          querySelector: (sel: string) => {
            if (sel.includes('#vjs_container_html5_api')) return vidObj;
            return null;
          },
          querySelectorAll: () => []
        };

        store.updateProgress({ status: 'idle', title: '等待任务开始...', percent: 0 });
        const sched = new ChapterScheduler();
        try {
          const p1 = (sched as any).runPipeline();
          assert.equal(store.actionMode, 'course', '智慧树视频页必须自动切为刷课模式');
          assert.equal(store.isCourseRunning, true, '进入刷课流程时 isCourseRunning 必须为 true');
          assert.deepEqual((card as any).getPrimaryActionState(), { text: '暂停刷课', stateClass: 'pause' });

          // 用户点击【暂停刷课】
          sched.togglePrimaryAction();
          await p1;
          assert.equal(store.isCourseRunning, false);
          assert.equal(store.progress.status, 'paused');
          assert.ok(coursePauseCalls >= 1, '暂停刷课必须停止底层视频任务');
          assert.deepEqual((card as any).getPrimaryActionState(), { text: '继续刷课', stateClass: 'resume' });

          // 暂停期间心跳 runPipeline 不得私自重开视频任务
          await (sched as any).runPipeline();
          assert.equal(store.isCourseRunning, false, '用户手动暂停期间心跳绝不可自动重启刷课');

          // 用户点击【继续刷课】恢复
          sched.togglePrimaryAction();
          await new Promise((r) => setTimeout(r, 40));
          assert.equal((sched as any).isCoursePausedByUser, false);
          assert.equal(store.isCourseRunning, true, '点击继续刷课后必须恢复运行态');
          (sched as any).watchdog.abort();
          await new Promise((r) => setTimeout(r, 20));
        } finally {
          (sched as any).watchdog?.abort?.();
        }

        // 3. 当页面上挂着新版 AI随堂练习 时，手动触发 triggerManualQuiz() 应接管弹窗作答而非误报无任务
        store.config.aiApiKey = '';
        let manualSubmitClicks = 0;
        const opt1: any = {
          tagName: 'DIV',
          innerText: 'A 第一项',
          textContent: 'A 第一项',
          style: { display: '', visibility: '' },
          closest: () => null,
          contains: () => false,
          selected: false,
          classList: { contains: (c: string) => opt1.selected && c === 'active' },
          getAttribute: () => (opt1.selected ? 'true' : null),
          click: () => {
            opt1.selected = true;
          }
        };
        const opt2: any = {
          tagName: 'DIV',
          innerText: 'B 第二项',
          textContent: 'B 第二项',
          style: { display: '', visibility: '' },
          closest: () => null,
          contains: () => false,
          selected: false,
          classList: { contains: () => false },
          getAttribute: () => null,
          click: () => {}
        };
        const manualSubmitBtn: any = {
          tagName: 'BUTTON',
          innerText: '提交作答',
          textContent: '提交作答',
          disabled: false,
          style: { display: '', visibility: '' },
          closest: () => null,
          contains: () => false,
          classList: { contains: () => false },
          hasAttribute: () => false,
          getAttribute: () => null,
          click: () => {
            manualSubmitClicks++;
            manualPracticeModal.style.display = 'none';
          }
        };
        const manualPracticeModal: any = {
          tagName: 'DIV',
          className: 'el-dialog',
          style: { display: '', visibility: '' },
          closest: () => null,
          contains: (o: any) => o === opt1 || o === opt2 || o === manualSubmitBtn,
          innerText: 'AI随堂练习\n1. [单选题]\n手动测试随堂练习题\nA 第一项\nB 第二项\n提交作答',
          textContent: 'AI随堂练习\n1. [单选题]\n手动测试随堂练习题\nA 第一项\nB 第二项\n提交作答',
          querySelector: () => null,
          querySelectorAll: (sel: string) => {
            if (sel.includes('li, div, p, label')) return [opt1, opt2, manualSubmitBtn];
            if (sel.includes('button')) return [manualSubmitBtn];
            return [];
          }
        };

        (globalThis as any).document = {
          readyState: 'complete',
          location: (globalThis as any).window.location,
          defaultView: {
            getComputedStyle: (el: any) => ({
              display: el?.style?.display || 'block',
              visibility: el?.style?.visibility || 'visible'
            })
          },
          documentElement: { querySelectorAll: () => [] },
          querySelector: () => null,
          querySelectorAll: (sel: string) => {
            if (sel.includes('[role="dialog"]') || sel.includes('.el-dialog')) return [manualPracticeModal];
            return [];
          }
        };

        store.setActionMode('course');
        store.updateProgress({ status: 'playing', title: '智慧树视频课程' });
        const manualSched = new ChapterScheduler();
        await manualSched.triggerManualQuiz();
        assert.equal(manualSubmitClicks, 1, '手动点击按钮应能直接作答并提交当前可见的 AI随堂练习 弹窗');
        assert.equal(opt1.selected, true);
        assert.notEqual(store.progress.title, '未检测到作业/测验');
      } finally {
        clearZhihuishuCompletionSuppression();
        store.setActionMode('quiz');
        store.setQuizRunning(false);
        store.setCourseRunning(false);
        store.updateProgress({ status: 'idle', title: '等待任务开始...', percent: 0, currentTime: '00:00', duration: '00:00' });
        (globalThis as any).window = prevWin;
        (globalThis as any).document = prevDoc;
        (globalThis as any).GM_xmlhttpRequest = prevXhr;
        store.config.aiApiKey = prevKey;
        store.acknowledgeAllErrors();
      }
    });

    it('25.11 新版智慧树 AI 课程：路由识别、跳过测试项与已完成小节、自动展开折叠章节并端到端完播跨章切换', async () => {
      const prevAutoNext = store.config.autoNextChapter;
      const prevDelayBase = store.config.randomDelayBase;
      const prevDelayJitter = store.config.randomDelayJitter;

      type MockNode = {
        tagName: string;
        className?: string;
        attrs?: Record<string, string>;
        style?: { display?: string; visibility?: string };
        bg?: string;
        text?: string;
        parentElement?: any;
        children?: any[];
        onClick?: () => void;
        clicked?: number;
        [k: string]: any;
      };

      const makeMockEl = (opts: MockNode): any => {
        const node: any = {
          tagName: opts.tagName,
          className: opts.className || '',
          style: opts.style || { display: '', visibility: '' },
          parentElement: opts.parentElement || null,
          children: opts.children || [],
          _bg: opts.bg || 'transparent',
          _attrs: { ...(opts.attrs || {}) },
          clicked: 0,
          classList: {
            contains: (c: string) => (node.className || '').split(/\s+/).includes(c)
          },
          getAttribute: (k: string) => {
            if (k === 'class') return node.className || '';
            return k in node._attrs ? node._attrs[k] : null;
          },
          setAttribute: (k: string, v: string) => {
            node._attrs[k] = v;
          },
          hasAttribute: (k: string) => k in node._attrs,
          contains: (other: any): boolean => {
            if (!other) return false;
            if (node === other) return true;
            for (const ch of node.children || []) {
              if (ch === other || (typeof ch.contains === 'function' && ch.contains(other))) {
                return true;
              }
            }
            return false;
          },
          closest: (sel: string): any => {
            const parts = sel.split(',').map((s) => s.trim()).filter(Boolean);
            let cur: any = node;
            while (cur) {
              if (matchesSelector(cur, parts)) return cur;
              cur = cur.parentElement;
            }
            return null;
          },
          matches: (sel: string): boolean => {
            const parts = sel.split(',').map((s) => s.trim()).filter(Boolean);
            return matchesSelector(node, parts);
          },
          querySelectorAll: (sel: string): any[] => {
            const parts = sel.split(',').map((s) => s.trim()).filter(Boolean);
            const res: any[] = [];
            const walk = (n: any) => {
              for (const ch of n.children || []) {
                if (matchesSelector(ch, parts)) res.push(ch);
                walk(ch);
              }
            };
            walk(node);
            return res;
          },
          querySelector: (sel: string): any => node.querySelectorAll(sel)[0] || null,
          click: () => {
            node.clicked++;
            opts.onClick?.();
          },
          get innerText(): string {
            if (opts.text !== undefined && (!node.children || node.children.length === 0)) {
              return opts.text;
            }
            if (!node.children || node.children.length === 0) return '';
            return node.children
              .map((c: any) => c.innerText || c.textContent || '')
              .filter(Boolean)
              .join('\n');
          },
          get textContent(): string {
            return node.innerText;
          }
        };
        for (const ch of node.children) {
          ch.parentElement = node;
        }
        return node;
      };

      const matchesSimplePart = (el: any, part: string): boolean => {
        const cls = (el.className || '').split(/\s+/).filter(Boolean);
        const tag = (el.tagName || '').toUpperCase();
        if (part.startsWith('.')) {
          return cls.includes(part.slice(1));
        }
        const attrContains = part.match(/^\[class\*="([^"]+)"\]$/);
        if (attrContains) {
          return (el.className || '').includes(attrContains[1]);
        }
        const roleMatch = part.match(/^\[role="([^"]+)"\]$/);
        if (roleMatch) {
          return el.getAttribute?.('role') === roleMatch[1];
        }
        if (part === '[onclick]') {
          return el.hasAttribute?.('onclick');
        }
        if (/^[a-z0-9]+$/i.test(part)) {
          return tag === part.toUpperCase();
        }
        return false;
      };

      const matchesSelector = (el: any, parts: string[]): boolean =>
        parts.some((p) => {
          // Handle compound like ".active.video"
          if (p.includes('.') && !p.startsWith('[') && !p.startsWith('.')) return false;
          if (p.startsWith('.') && p.slice(1).includes('.')) {
            return p
              .slice(1)
              .split('.')
              .every((sub) => (el.className || '').split(/\s+/).includes(sub));
          }
          return matchesSimplePart(el, p);
        });

      const attachChildren = (parent: any, children: any[]) => {
        parent.children = children;
        for (const ch of children) ch.parentElement = parent;
      };

      const buildAiCourseDom = (opts: {
        accordionMode?: boolean;
        ch1Finished?: boolean;
        videoEl?: any;
        onLessonActivate?: (lessonTitle: string) => void;
      }) => {
        const docUrl = 'https://ai-smart-course-student-pro.zhihuishu.com/learnPage/99001';
        let activeTitle = '0.1 引言';

        const makeFinishSvg = () =>
          makeMockEl({
            tagName: 'svg',
            className: '_check_x12',
            attrs: { 'aria-label': '已完成' }
          });

        const makeLessonRow = (
          title: string,
          cfg: { finished?: boolean; active?: boolean; highlightBg?: string; isTest?: boolean } = {}
        ) => {
          const textNode = makeMockEl({ tagName: 'p', text: title });
          const kids = cfg.finished ? [makeFinishSvg(), textNode] : [textNode];
          const row = makeMockEl({
            tagName: 'div',
            className: cfg.active ? '_row_k9 _active_k9' : '_row_k9',
            bg: cfg.active ? cfg.highlightBg || 'rgb(237, 233, 254)' : 'transparent',
            children: kids,
            onClick: () => {
              if (cfg.isTest) return;
              for (const r of allRows) {
                r.className = '_row_k9';
                r._bg = 'transparent';
              }
              row.className = '_row_k9 _active_k9';
              row._bg = 'rgb(237, 233, 254)';
              activeTitle = title;
              opts.onLessonActivate?.(title);
            }
          });
          return row;
        };

        const row01 = makeLessonRow('0.1 引言', { finished: true, active: true });
        const row0Test = makeLessonRow('测试', { isTest: true });
        const row11 = makeLessonRow('1.1 什么是人工智能', { finished: Boolean(opts.ch1Finished) });
        const row12 = makeLessonRow('1.2 发展历程', { finished: Boolean(opts.ch1Finished) });
        const row21 = makeLessonRow('2.1 数据预处理');
        const allRows = [row01, row0Test, row11, row12, row21];

        const makeChapterBox = (
          prefix: string,
          subtitle: string,
          expandedInit: boolean,
          lessonRows: any[]
        ) => {
          let expanded = expandedInit;
          const prefixDiv = makeMockEl({ tagName: 'div', text: prefix });
          const subDiv = makeMockEl({ tagName: 'div', text: subtitle });
          const bodyDiv = makeMockEl({
            tagName: 'div',
            className: '_chap_body',
            style: { display: expandedInit ? '' : 'none', visibility: '' },
            children: expandedInit ? lessonRows : []
          });
          const headerDiv = makeMockEl({
            tagName: 'div',
            className: '_chap_hdr',
            attrs: { 'aria-expanded': expandedInit ? 'true' : 'false' },
            children: [prefixDiv, subDiv],
            onClick: () => {
              if (opts.accordionMode && !expanded) {
                for (const box of chapterBoxes) {
                  box.setExpanded(false);
                }
              }
              box.setExpanded(!expanded);
            }
          });
          const box: any = makeMockEl({
            tagName: 'div',
            className: '_chap_wrap',
            children: [headerDiv, bodyDiv]
          });
          box.header = headerDiv;
          box.body = bodyDiv;
          box.setExpanded = (nextVal: boolean) => {
            expanded = nextVal;
            headerDiv.setAttribute('aria-expanded', nextVal ? 'true' : 'false');
            bodyDiv.style.display = nextVal ? '' : 'none';
            attachChildren(bodyDiv, nextVal ? lessonRows : []);
          };
          box.isExpanded = () => expanded;
          return box;
        };

        const ch0 = makeChapterBox('第零章:', '绪论', true, [row01, row0Test]);
        const ch1 = makeChapterBox('第一章:', '初识人工智能', false, [row11, row12]);
        const ch2 = makeChapterBox('第二章:', '人工智能的系统数据基础', false, [row21]);
        const chapterBoxes = [ch0, ch1, ch2];

        const sidebar = makeMockEl({
          tagName: 'aside',
          className: '_course_outline',
          children: chapterBoxes
        });

        const docObj: any = {
          location: new URL(docUrl),
          defaultView: {
            getComputedStyle: (el: any) => ({
              display: el?.style?.display || 'block',
              visibility: el?.style?.visibility || 'visible',
              backgroundColor: el?._bg || 'transparent'
            })
          },
          querySelectorAll: (sel: string) => {
            const parts = sel.split(',').map((s) => s.trim()).filter(Boolean);
            const matched: any[] = [];
            const walk = (n: any) => {
              if (matchesSelector(n, parts)) matched.push(n);
              for (const ch of n.children || []) walk(ch);
            };
            walk(sidebar);
            return matched;
          },
          querySelector: (sel: string) => {
            if (sel.includes('video') && opts.videoEl) return opts.videoEl;
            return docObj.querySelectorAll(sel)[0] || null;
          },
          getActiveTitle: () => activeTitle
        };

        return { doc: docObj, ch0, ch1, ch2, row01, row0Test, row11, row12, row21 };
      };

      try {
        clearZhihuishuCompletionSuppression();

        // 1. 新版 AI 课程 URL 识别与 /portal / exam 排除
        assert.equal(
          isZhihuishuVideoPage(undefined, 'https://ai-smart-course-student-pro.zhihuishu.com/learnPage/99001'),
          true,
          '应识别新版 AI 课程 learnPage 视频页'
        );
        assert.equal(
          isZhihuishuVideoPage(
            undefined,
            'https://ai-smart-course-student-pro.zhihuishu.com/singleCourse/knowledgeStudy/123'
          ),
          true,
          '应识别新版 AI 课程 knowledgeStudy 学习页'
        );
        assert.equal(
          isZhihuishuVideoPage(
            undefined,
            'https://ai-smart-course-student-pro.zhihuishu.com/onlineexamh5new/doExam'
          ),
          false,
          '考试页路由必须被排除在视频页外'
        );
        assert.equal(
          isZhihuishuVideoPage(
            { querySelector: () => null } as any,
            'https://ai-smart-course-student-pro.zhihuishu.com/portal'
          ),
          false,
          '无视频元素的 /portal 门户页不应判定为视频页'
        );

        // 2. 截图还原场景：第零章仅剩已完成 0.1 引言与非视频测试 -> 展开第一章 -> 定位 1.1 什么是人工智能
        const s2 = buildAiCourseDom({ accordionMode: false, ch1Finished: false });
        const headers2 = findZhihuishuChapterHeaders(s2.doc);
        assert.equal(headers2.length, 3, '语义回退应识别第零章~第二章 3 个折叠章节标题');
        const initialLessons = findZhihuishuAiLessonItems(s2.doc);
        assert.deepEqual(
          initialLessons.map((el) => (el.innerText || '').trim()),
          ['0.1 引言'],
          '应识别 0.1 引言 并过滤非视频项【测试】'
        );
        assert.equal(
          findNextZhihuishuVideoItem(s2.doc),
          null,
          '折叠未展开时当前可见目录无更多未完成视频，同步查找应返回 null'
        );

        const expandedNext = await findOrExpandNextZhihuishuVideoItem(
          s2.doc,
          new AbortController().signal,
          () => true,
          { expandDelayMs: 15 }
        );
        assert.equal(s2.ch0.header.clicked, 0, '已展开的第零章绝不可误点导致折叠');
        assert.equal(s2.ch1.header.clicked, 1, '必须点击折叠的【第一章】展开目录');
        assert.equal(expandedNext, s2.row11, '展开后必须选中 1.1 什么是人工智能');

        // 3. 手风琴自动折叠模式 + 第一章全部完成 -> 自动跨过第一章继续展开第二章
        clearZhihuishuCompletionSuppression();
        const s3 = buildAiCourseDom({ accordionMode: true, ch1Finished: true });
        const accNext = await findOrExpandNextZhihuishuVideoItem(
          s3.doc,
          new AbortController().signal,
          () => true,
          { expandDelayMs: 15 }
        );
        assert.equal(s3.ch0.isExpanded(), false, '手风琴模式下第零章随新章展开自动收起');
        assert.equal(s3.ch1.header.clicked, 1, '应先展开第一章检查');
        assert.equal(s3.ch2.header.clicked, 1, '第一章全部完成后必须继续展开第二章');
        assert.equal(s3.ch2.isExpanded(), true);
        assert.equal(accNext, s3.row21, '应最终命中第二章的 2.1 数据预处理');

        // 4. 端到端 playZhihuishuVideoTask：0.1 引言完播 -> 自动展开第一章并点击 1.1 -> SPA 重置视频 -> 保持 1.0x 静音并重置冷却
        clearZhihuishuCompletionSuppression();
        store.config.autoNextChapter = true;
        store.config.randomDelayBase = 0.5;
        store.config.randomDelayJitter = 0;

        const vidListeners = new Map<string, Set<Function>>();
        const aiVideo: any = {
          playbackRate: 2.0,
          muted: false,
          duration: 193,
          currentTime: 0,
          paused: true,
          ended: false,
          isConnected: true,
          src: 'https://cdn.zhihuishu.com/0_1.mp4',
          currentSrc: 'https://cdn.zhihuishu.com/0_1.mp4',
          play: async () => {
            aiVideo.paused = false;
          },
          pause: () => {
            aiVideo.paused = true;
          },
          addEventListener: (ev: string, fn: Function) => {
            if (!vidListeners.has(ev)) vidListeners.set(ev, new Set());
            vidListeners.get(ev)!.add(fn);
          },
          removeEventListener: (ev: string, fn: Function) => {
            vidListeners.get(ev)?.delete(fn);
          }
        };

        let activatedLesson = '';
        const s4 = buildAiCourseDom({
          accordionMode: true,
          ch1Finished: false,
          videoEl: aiVideo,
          onLessonActivate: (title) => {
            activatedLesson = title;
            setTimeout(() => {
              aiVideo.src = 'https://cdn.zhihuishu.com/1_1.mp4';
              aiVideo.currentSrc = 'https://cdn.zhihuishu.com/1_1.mp4';
              aiVideo.ended = false;
              aiVideo.currentTime = 0;
              aiVideo.paused = true;
            }, 15);
          }
        });

        const e2eCtrl = new AbortController();
        const e2eTask = playZhihuishuVideoTask(
          s4.doc,
          { signal: e2eCtrl.signal, isCurrent: () => true },
          { pollIntervalMs: 20, chapterExpandDelayMs: 15, switchWaitTimeoutMs: 120 }
        );
        try {
          await new Promise((r) => setTimeout(r, 45));
          assert.equal(aiVideo.playbackRate, 1.0, '新版 AI 课程必须强制 1.0x 原速');
          assert.equal(aiVideo.muted, true, '新版 AI 课程必须强制静音');

          aiVideo.currentTime = 193;
          aiVideo.ended = true;
          for (const fn of vidListeners.get('ended') || []) fn();

          await e2eTask;
          assert.equal(s4.ch1.header.clicked, 1, '完播后应自动点击展开第一章');
          assert.equal(activatedLesson, '1.1 什么是人工智能', '应自动点击进入 1.1 什么是人工智能');
          assert.equal(getLastCompletedZhihuishuLessonKey(), null, 'SPA 成功切集后不得保留完播抑制键');
          assert.equal(getZhihuishuSwitchCooldownUntil(), 0, 'SPA 成功切集后不得进入切集冷却期');
        } finally {
          e2eCtrl.abort();
          await e2eTask.catch(() => {});
        }
      } finally {
        clearZhihuishuCompletionSuppression();
        store.config.autoNextChapter = prevAutoNext;
        store.config.randomDelayBase = prevDelayBase;
        store.config.randomDelayJitter = prevDelayJitter;
      }
    });

    it('25.12 新版智慧树单元测试页面：分离式题干提取、底部【保存】与【暂存作业/提交作业】定位及空题干防盲猜熔断', async () => {
      const prevWin = (globalThis as any).window;
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

      const splitSelector = (sel: string) => sel.split(',').map((s) => s.trim()).filter(Boolean);

      const matchesUnitPart = (el: any, part: string): boolean => {
        const cls = (el.className || '').split(/\s+/).filter(Boolean);
        const tag = (el.tagName || '').toUpperCase();
        if (part.startsWith('div[')) {
          const m = part.match(/^div\[id\^="([^"]+)"\]$/);
          if (m) return tag === 'DIV' && (el.id || '').startsWith(m[1]);
          return false;
        }
        if (part.startsWith('a[') || part.startsWith('input[')) return false;
        if (part.startsWith('.')) {
          if (part.slice(1).includes('.')) {
            return part
              .slice(1)
              .split('.')
              .every((sub) => cls.includes(sub));
          }
          return cls.includes(part.slice(1));
        }
        const attrContains = part.match(/^\[class\*="([^"]+)"\]$/);
        if (attrContains) return (el.className || '').includes(attrContains[1]);
        const roleMatch = part.match(/^\[role="([^"]+)"\]$/);
        if (roleMatch) return el.getAttribute?.('role') === roleMatch[1];
        if (part === 'input[type="radio"]') return tag === 'INPUT' && el.type === 'radio';
        if (part === 'input[type="checkbox"]') return tag === 'INPUT' && el.type === 'checkbox';
        if (part === 'button[type="submit"]') return tag === 'BUTTON' && el.type === 'submit';
        if (/^[a-z0-9]+$/i.test(part)) return tag === part.toUpperCase();
        return false;
      };

      const matchChain = (el: any, chain: string): boolean => {
        const tokens = chain.split(/\s+/).filter((t) => t && t !== '>');
        if (tokens.length === 0) return false;
        if (!matchesUnitPart(el, tokens[tokens.length - 1])) return false;
        if (tokens.length === 1) return true;
        let cur = el.parentElement;
        for (let i = tokens.length - 2; i >= 0; i--) {
          while (cur && !matchesUnitPart(cur, tokens[i])) {
            cur = cur.parentElement;
          }
          if (!cur) return false;
          cur = cur.parentElement;
        }
        return true;
      };

      const matchesAny = (el: any, sel: string): boolean =>
        splitSelector(sel).some((chain) => matchChain(el, chain));

      const makeDomNode = (opts: {
        tagName: string;
        className?: string;
        id?: string;
        type?: string;
        value?: string;
        disabled?: boolean;
        attrs?: Record<string, string>;
        style?: { display?: string; visibility?: string };
        text?: string;
        children?: any[];
        onClick?: () => void;
      }): any => {
        const node: any = {
          tagName: opts.tagName,
          className: opts.className || '',
          id: opts.id || '',
          type: opts.type || '',
          value: opts.value || '',
          checked: false,
          disabled: Boolean(opts.disabled),
          style: opts.style || { display: '', visibility: '' },
          parentElement: null as any,
          children: opts.children || [],
          _attrs: { ...(opts.attrs || {}) },
          _rawText: opts.text,
          classList: {
            contains: (c: string) => (node.className || '').split(/\s+/).includes(c),
            add: (c: string) => {
              const parts = (node.className || '').split(/\s+/).filter(Boolean);
              if (!parts.includes(c)) parts.push(c);
              node.className = parts.join(' ');
            },
            remove: (c: string) => {
              node.className = (node.className || '')
                .split(/\s+/)
                .filter((x: string) => x && x !== c)
                .join(' ');
            }
          },
          getAttribute: (k: string) => {
            if (k === 'class') return node.className || '';
            if (k === 'id') return node.id || null;
            return k in node._attrs ? node._attrs[k] : null;
          },
          setAttribute: (k: string, v: string) => {
            node._attrs[k] = v;
          },
          hasAttribute: (k: string) => k in node._attrs,
          remove: () => {
            if (node.parentElement && Array.isArray(node.parentElement.children)) {
              node.parentElement.children = node.parentElement.children.filter((c: any) => c !== node);
            }
            node.parentElement = null;
          },
          scrollIntoView: () => {},
          contains: (other: any): boolean => {
            if (!other) return false;
            if (node === other) return true;
            return (node.children || []).some(
              (c: any) => c === other || (typeof c.contains === 'function' && c.contains(other))
            );
          },
          closest: (sel: string): any => {
            let cur: any = node;
            while (cur) {
              if (matchesAny(cur, sel)) return cur;
              cur = cur.parentElement;
            }
            return null;
          },
          matches: (sel: string): boolean => matchesAny(node, sel),
          querySelectorAll: (sel: string): any[] => {
            const res: any[] = [];
            const walk = (n: any) => {
              for (const ch of n.children || []) {
                if (matchesAny(ch, sel)) res.push(ch);
                walk(ch);
              }
            };
            walk(node);
            return res;
          },
          querySelector: (sel: string): any => node.querySelectorAll(sel)[0] || null,
          cloneNode: (deep = false): any => {
            const clonedChildren = deep ? (node.children || []).map((c: any) => c.cloneNode(true)) : [];
            return makeDomNode({
              tagName: node.tagName,
              className: node.className,
              id: node.id,
              type: node.type,
              value: node.value,
              disabled: node.disabled,
              attrs: { ...node._attrs },
              style: { ...node.style },
              text: node._rawText,
              children: clonedChildren
            });
          },
          click: () => {
            opts.onClick?.();
          },
          get innerText(): string {
            if (node._rawText !== undefined && (!node.children || node.children.length === 0)) {
              return node._rawText;
            }
            return (node.children || [])
              .map((c: any) => c.innerText || c.textContent || '')
              .filter(Boolean)
              .join('\n');
          },
          get textContent(): string {
            return node.innerText;
          }
        };
        for (const ch of node.children) {
          ch.parentElement = node;
        }
        return node;
      };

      const buildUnitTestScene = (opts: { includeStem: boolean }) => {
        const optionState = new Map<string, boolean>();
        let tempSaveClicks = 0;
        let bottomSaveClicks = 0;
        let topSubmitClicks = 0;
        let modalConfirmClicks = 0;

        const mockWin: any = {
          location: new URL('https://ai-smart-course-student-pro.zhihuishu.com/onlineexamh5new/doHomework?recruitId=301&homeworkId=402'),
          confirm: () => false,
          alert: () => undefined,
          setTimeout,
          clearTimeout,
          setInterval,
          clearInterval,
          addEventListener: () => {},
          removeEventListener: () => {},
          getComputedStyle: (el: any) => ({
            display: el?.style?.display || 'block',
            visibility: el?.style?.visibility || 'visible'
          })
        };

        const makeRadioOpt = (letter: string, labelText: string) => {
          const inputEl = makeDomNode({ tagName: 'INPUT', type: 'radio', value: letter });
          const letterSpan = makeDomNode({ tagName: 'SPAN', className: 'option-letter', text: `${letter}.` });
          const textSpan = makeDomNode({ tagName: 'SPAN', className: 'el-radio__label', text: `${letter}. ${labelText}` });
          const optNode = makeDomNode({
            tagName: 'LABEL',
            className: 'el-radio',
            children: [inputEl, letterSpan, textSpan],
            onClick: () => {
              for (const k of optionState.keys()) optionState.set(k, false);
              optionState.set(letter, true);
              for (const o of radioOpts) {
                const isSel = o === optNode;
                o.classList[isSel ? 'add' : 'remove']('is-checked');
                o._inputEl.checked = isSel;
              }
            }
          });
          optNode._inputEl = inputEl;
          optionState.set(letter, false);
          return optNode;
        };

        const radioOpts = [
          makeRadioOpt('A', '鼓励人工智能在所有情况下都采取最优解'),
          makeRadioOpt('B', '使人工智能能够自主决策而不受人类干预'),
          makeRadioOpt('C', '确保人工智能的算法不带有任何偏见和歧视'),
          makeRadioOpt('D', '在开发过程中优先考虑技术的创新性而非安全性')
        ];
        const radioGroup = makeDomNode({
          tagName: 'DIV',
          className: 'el-radio-group',
          children: radioOpts
        });

        const headerDiv = makeDomNode({
          tagName: 'DIV',
          className: 'question-title',
          text: '1.【单选题】(2分)'
        });
        const stemDiv = opts.includeStem
          ? makeDomNode({
              tagName: 'DIV',
              className: 'stem-content',
              text: '在人工智能的实际应用中，伦理问题日益受到关注。以下哪个选项最能体现人工智能应用中的伦理责任？（）'
            })
          : null;

        const questionBox = makeDomNode({
          tagName: 'DIV',
          className: 'questionBox',
          attrs: { 'data-id': opts.includeStem ? 'ai-unit-q1' : 'ai-unit-empty-q1' },
          children: stemDiv ? [headerDiv, stemDiv, radioGroup] : [headerDiv, radioGroup]
        });

        const prevBtn = makeDomNode({ tagName: 'BUTTON', className: 'el-button is-disabled', disabled: true, text: '上一题' });
        const bottomSaveBtn = makeDomNode({
          tagName: 'BUTTON',
          className: 'el-button el-button--primary',
          text: '保存',
          onClick: () => {
            bottomSaveClicks++;
          }
        });
        const confirmModalBtn = makeDomNode({
          tagName: 'BUTTON',
          className: 'el-button el-button--primary',
          text: '确定',
          onClick: () => {
            modalConfirmClicks++;
            confirmDialog.style.display = 'none';
          }
        });
        const confirmDialog = makeDomNode({
          tagName: 'DIV',
          className: 'el-dialog',
          style: { display: 'none', visibility: '' },
          children: [
            makeDomNode({ tagName: 'DIV', className: 'el-dialog__body', text: '确认提交作业吗？' }),
            confirmModalBtn
          ]
        });
        const topTempSaveBtn = makeDomNode({
          tagName: 'BUTTON',
          className: 'el-button',
          text: '暂存作业',
          onClick: () => {
            tempSaveClicks++;
          }
        });
        const topSubmitBtn = makeDomNode({
          tagName: 'BUTTON',
          className: 'el-button el-button--primary',
          text: '提交作业',
          onClick: () => {
            topSubmitClicks++;
            confirmDialog.style.display = '';
          }
        });

        const pageTitle = makeDomNode({ tagName: 'H2', text: '绪论单元测试' });
        const topBar = makeDomNode({ tagName: 'DIV', className: 'header-actions', children: [topTempSaveBtn, topSubmitBtn] });
        const footerBar = makeDomNode({ tagName: 'DIV', className: 'switch-btn-box', children: [prevBtn, bottomSaveBtn] });
        const root = makeDomNode({
          tagName: 'DIV',
          className: 'homework-page',
          children: [pageTitle, topBar, questionBox, footerBar, confirmDialog]
        });

        const docObj: any = {
          location: mockWin.location,
          defaultView: mockWin,
          title: '绪论单元测试',
          querySelectorAll: (sel: string) => root.querySelectorAll(sel),
          querySelector: (sel: string) => root.querySelector(sel)
        };

        return {
          mockWin,
          docObj,
          optionState,
          topTempSaveBtn,
          topSubmitBtn,
          bottomSaveBtn,
          getCounts: () => ({
            tempSaveClicks,
            bottomSaveClicks,
            topSubmitClicks,
            modalConfirmClicks
          })
        };
      };

      try {
        store.acknowledgeAllErrors();
        clearExamAutoResumeState();
        store.config.aiApiKey = 'sk-ai-unit-test';
        store.config.enabledQuestionTypes = { single: true, multiple: true, judge: true, fill: true, essay: true };

        // 1. 截图“绪论单元测试”自动暂存模式：分离题干完整提取 + 选 C + 点底部【保存】与右上角【暂存作业】
        store.config.autoSubmitWork = false;
        const s1 = buildUnitTestScene({ includeStem: true });
        (globalThis as any).window = s1.mockWin;

        assert.equal(findQuizActionButton(s1.docObj, 'save'), s1.topTempSaveBtn, '应精准定位【暂存作业】按钮');
        assert.equal(findQuizActionButton(s1.docObj, 'save-current'), s1.bottomSaveBtn, '应精准定位底部【保存】按钮');
        assert.equal(findQuizActionButton(s1.docObj, 'submit'), s1.topSubmitBtn, '应精准定位【提交作业】按钮');

        let promptSent1 = '';
        (globalThis as any).GM_xmlhttpRequest = (opts: any) => {
          promptSent1 = JSON.stringify(JSON.parse(opts.data).messages);
          setTimeout(() => {
            opts.onload({
              status: 200,
              responseText: JSON.stringify({ choices: [{ message: { content: '["C"]' } }] })
            });
          }, 5);
        };

        await doQuizTask(null, s1.docObj, { signal: new AbortController().signal, isCurrent: () => true });

        assert.ok(
          promptSent1.includes('在人工智能的实际应用中，伦理问题日益受到关注'),
          '发给 AI 的题干必须完整保留，绝不可为空'
        );
        assert.equal(store.questions[0].type, 'single');
        assert.equal(s1.optionState.get('C'), true, '应精准选中选项 C');
        assert.equal(s1.optionState.get('A'), false);
        assert.deepEqual(s1.getCounts(), {
          tempSaveClicks: 1,
          bottomSaveClicks: 1,
          topSubmitClicks: 0,
          modalConfirmClicks: 0
        });

        // 2. 自动提交模式：先点底部【保存】，再点【提交作业】并确认二次弹窗【确定】
        clearExamAutoResumeState();
        store.config.autoSubmitWork = true;
        const s2 = buildUnitTestScene({ includeStem: true });
        (globalThis as any).window = s2.mockWin;
        (globalThis as any).GM_xmlhttpRequest = (opts: any) => {
          setTimeout(() => {
            opts.onload({
              status: 200,
              responseText: JSON.stringify({ choices: [{ message: { content: '["C"]' } }] })
            });
          }, 5);
        };

        await doQuizTask(null, s2.docObj, { signal: new AbortController().signal, isCurrent: () => true });
        assert.equal(s2.optionState.get('C'), true);
        assert.deepEqual(s2.getCounts(), {
          tempSaveClicks: 0,
          bottomSaveClicks: 1,
          topSubmitClicks: 1,
          modalConfirmClicks: 1
        });

        // 3. 空题干防盲猜熔断：无正文且无图片时禁止调用 AI 与瞎选 A，写红字告警并取消自动提交
        clearExamAutoResumeState();
        store.acknowledgeAllErrors();
        store.config.autoSubmitWork = true;
        const s3 = buildUnitTestScene({ includeStem: false });
        (globalThis as any).window = s3.mockWin;
        let emptyStemAiCalls = 0;
        (globalThis as any).GM_xmlhttpRequest = (opts: any) => {
          emptyStemAiCalls++;
          setTimeout(() => {
            opts.onload?.({
              status: 200,
              responseText: JSON.stringify({ choices: [{ message: { content: '["A"]' } }] })
            });
          }, 5);
        };

        await doQuizTask(null, s3.docObj, { signal: new AbortController().signal, isCurrent: () => true });
        assert.equal(emptyStemAiCalls, 0, '空题干绝不可调用 AI 乱猜');
        assert.equal(s3.optionState.get('A'), false, '空题干绝不可保底瞎选 A');
        assert.equal(store.questions[0].status, 'failed');
        assert.ok(
          store.pinnedErrors.some((e) => e.message.includes('未能提取到有效题干文本且无题目图片')),
          '空题干熔断必须写入红色置顶告警'
        );
        assert.equal(s3.getCounts().topSubmitClicks, 0, '空题干触发熔断后绝不可自动提交作业');
      } finally {
        clearExamAutoResumeState();
        (globalThis as any).window = prevWin;
        (globalThis as any).sessionStorage = prevSession;
        (globalThis as any).GM_xmlhttpRequest = prevXhr;
        store.config.aiApiKey = prevKey;
        store.config.autoSubmitWork = prevAutoSubmit;
        store.acknowledgeAllErrors();
      }
    });

    it('25.13 Chrome MV3 扩展封闭题干自动截图识题（零 Hook）、隐私保护门控与纯视觉模型降级熔断', async () => {
      const prevWin = (globalThis as any).window;
      const prevDoc = (globalThis as any).document;
      const prevSession = (globalThis as any).sessionStorage;
      const prevXhr = (globalThis as any).GM_xmlhttpRequest;
      const prevChrome = (globalThis as any).chrome;
      const prevImage = (globalThis as any).Image;
      const prevKey = store.config.aiApiKey;
      const prevModel = store.config.aiModel;
      const prevBaseUrl = store.config.aiBaseUrl;
      const prevAutoSubmit = store.config.autoSubmitWork;

      const sMap = new Map<string, string>();
      (globalThis as any).sessionStorage = {
        getItem: (k: string) => sMap.get(k) ?? null,
        setItem: (k: string, v: string) => sMap.set(k, String(v)),
        removeItem: (k: string) => sMap.delete(k),
        clear: () => sMap.clear()
      };

      const splitSel = (sel: string) => sel.split(',').map((s) => s.trim()).filter(Boolean);
      const matchSimple = (el: any, part: string): boolean => {
        const cls = (el.className || '').split(/\s+/).filter(Boolean);
        const tag = (el.tagName || '').toUpperCase();
        if (part.startsWith('.')) {
          if (part.slice(1).includes('.')) {
            return part
              .slice(1)
              .split('.')
              .every((sub) => cls.includes(sub));
          }
          return cls.includes(part.slice(1));
        }
        const attrContains = part.match(/^\[class\*="([^"]+)"\]$/);
        if (attrContains) return (el.className || '').includes(attrContains[1]);
        const roleMatch = part.match(/^\[role="([^"]+)"\]$/);
        if (roleMatch) return el.getAttribute?.('role') === roleMatch[1];
        if (part === 'input[type="radio"]') return tag === 'INPUT' && el.type === 'radio';
        if (part === 'input[type="checkbox"]') return tag === 'INPUT' && el.type === 'checkbox';
        if (part === 'kasa-helper-panel') return tag === 'KASA-HELPER-PANEL';
        if (/^[a-z0-9-]+$/i.test(part)) return tag === part.toUpperCase();
        return false;
      };
      const matchChain = (el: any, chain: string): boolean => {
        const tokens = chain.split(/\s+/).filter((t) => t && t !== '>');
        if (tokens.length === 0) return false;
        if (!matchSimple(el, tokens[tokens.length - 1])) return false;
        if (tokens.length === 1) return true;
        let cur = el.parentElement;
        for (let i = tokens.length - 2; i >= 0; i--) {
          while (cur && !matchSimple(cur, tokens[i])) cur = cur.parentElement;
          if (!cur) return false;
          cur = cur.parentElement;
        }
        return true;
      };
      const matchAny = (el: any, sel: string): boolean =>
        splitSel(sel).some((chain) => matchChain(el, chain));

      const createMockNode = (opts: {
        tagName: string;
        className?: string;
        type?: string;
        value?: string;
        disabled?: boolean;
        text?: string;
        rect?: { left: number; top: number; width: number; height: number };
        children?: any[];
        onClick?: () => void;
      }): any => {
        const node: any = {
          tagName: opts.tagName,
          className: opts.className || '',
          type: opts.type || '',
          value: opts.value || '',
          checked: false,
          disabled: Boolean(opts.disabled),
          style: { display: '', visibility: '', opacity: '' },
          parentElement: null as any,
          children: opts.children || [],
          _attrs: {} as Record<string, string>,
          _rawText: opts.text,
          _rect: opts.rect || { left: 100, top: 150, width: 640, height: 80 },
          classList: {
            contains: (c: string) => (node.className || '').split(/\s+/).includes(c),
            add: (c: string) => {
              const parts = (node.className || '').split(/\s+/).filter(Boolean);
              if (!parts.includes(c)) parts.push(c);
              node.className = parts.join(' ');
            },
            remove: (c: string) => {
              node.className = (node.className || '')
                .split(/\s+/)
                .filter((x: string) => x && x !== c)
                .join(' ');
            }
          },
          getAttribute: (k: string) => {
            if (k === 'class') return node.className || '';
            return k in node._attrs ? node._attrs[k] : null;
          },
          setAttribute: (k: string, v: string) => {
            node._attrs[k] = v;
          },
          hasAttribute: (k: string) => k in node._attrs,
          getBoundingClientRect: () => ({ ...node._rect }),
          scrollIntoView: () => {},
          remove: () => {
            if (node.parentElement && Array.isArray(node.parentElement.children)) {
              node.parentElement.children = node.parentElement.children.filter((c: any) => c !== node);
            }
            node.parentElement = null;
          },
          contains: (other: any): boolean => {
            if (!other) return false;
            if (node === other) return true;
            return (node.children || []).some(
              (c: any) => c === other || (typeof c.contains === 'function' && c.contains(other))
            );
          },
          closest: (sel: string): any => {
            let cur: any = node;
            while (cur) {
              if (matchAny(cur, sel)) return cur;
              cur = cur.parentElement;
            }
            return null;
          },
          matches: (sel: string): boolean => matchAny(node, sel),
          querySelectorAll: (sel: string): any[] => {
            const res: any[] = [];
            const walk = (n: any) => {
              for (const ch of n.children || []) {
                if (matchAny(ch, sel)) res.push(ch);
                walk(ch);
              }
            };
            walk(node);
            return res;
          },
          querySelector: (sel: string): any => node.querySelectorAll(sel)[0] || null,
          cloneNode: (deep = false): any => {
            const kids = deep ? (node.children || []).map((c: any) => c.cloneNode(true)) : [];
            return createMockNode({
              tagName: node.tagName,
              className: node.className,
              type: node.type,
              value: node.value,
              disabled: node.disabled,
              text: node._rawText,
              rect: node._rect,
              children: kids
            });
          },
          click: () => {
            opts.onClick?.();
          },
          get innerText(): string {
            if (node._rawText !== undefined && (!node.children || node.children.length === 0)) {
              return node._rawText;
            }
            return (node.children || [])
              .map((c: any) => c.innerText || c.textContent || '')
              .filter(Boolean)
              .join('\n');
          },
          get textContent(): string {
            return node.innerText;
          }
        };
        for (const ch of node.children) {
          ch.parentElement = node;
        }
        return node;
      };

      const buildClosedShadowScene = () => {
        const selectedState = new Map<string, boolean>();
        let bottomSaveClicks = 0;
        let topTempSaveClicks = 0;
        let topSubmitClicks = 0;

        const makeOpt = (letter: string, text: string) => {
          const inp = createMockNode({ tagName: 'INPUT', type: 'radio', value: letter });
          const node = createMockNode({
            tagName: 'DIV',
            className: 'nodeLab',
            children: [
              inp,
              createMockNode({ tagName: 'SPAN', className: 'node_detail', text: `${letter}. ${text}` })
            ],
            onClick: () => {
              for (const k of selectedState.keys()) selectedState.set(k, false);
              selectedState.set(letter, true);
              for (const o of optNodes) {
                const isSel = o === node;
                o.classList[isSel ? 'add' : 'remove']('active');
                o._inp.checked = isSel;
              }
            }
          });
          node._inp = inp;
          selectedState.set(letter, false);
          return node;
        };

        const optNodes = [
          makeOpt('A', '在开发过程中优先考虑技术的创新性而非安全性'),
          makeOpt('B', '确保人工智能的算法不带有任何偏见和歧视'),
          makeOpt('C', '鼓励人工智能在所有情况下都采取最优解'),
          makeOpt('D', '使人工智能能够自主决策而不受人类干预')
        ];

        const closedShadowDiv = createMockNode({
          tagName: 'DIV',
          className: 'subject_describe dynamic-fonts',
          rect: { left: 320, top: 260, width: 700, height: 64 },
          children: [createMockNode({ tagName: 'DIV', text: '' })]
        });

        const typeSpan = createMockNode({
          tagName: 'SPAN',
          className: 'subject_type',
          text: '【单选题】 (2分)'
        });

        const subjectEl = createMockNode({
          tagName: 'DIV',
          className: 'examPaper_subject mt20',
          rect: { left: 300, top: 200, width: 760, height: 320 },
          children: [
            createMockNode({
              tagName: 'DIV',
              className: 'subject_stem',
              children: [typeSpan, closedShadowDiv]
            }),
            createMockNode({
              tagName: 'DIV',
              className: 'subject_node_list',
              children: optNodes.map((o) =>
                createMockNode({ tagName: 'DIV', className: 'subject_node', children: [o] })
              )
            })
          ]
        });

        const panelEl = createMockNode({ tagName: 'KASA-HELPER-PANEL' });
        const bottomSaveBtn = createMockNode({
          tagName: 'BUTTON',
          className: 'el-button el-button--primary',
          text: '保存',
          onClick: () => {
            bottomSaveClicks++;
          }
        });
        const topTempSaveBtn = createMockNode({
          tagName: 'BUTTON',
          className: 'el-button',
          text: '暂存作业',
          onClick: () => {
            topTempSaveClicks++;
          }
        });
        const topSubmitBtn = createMockNode({
          tagName: 'BUTTON',
          className: 'el-button el-button--primary',
          text: '提交作业',
          onClick: () => {
            topSubmitClicks++;
          }
        });

        const root = createMockNode({
          tagName: 'DIV',
          className: 'exam-page',
          children: [panelEl, topTempSaveBtn, topSubmitBtn, subjectEl, bottomSaveBtn]
        });

        const mockWin: any = {
          innerWidth: 1280,
          innerHeight: 800,
          devicePixelRatio: 2,
          location: new URL('https://onlineexamh5new.zhihuishu.com/stuExamWeb.html?recruitId=431511&examId=5j9oNEVe'),
          confirm: () => false,
          alert: () => undefined,
          setTimeout,
          clearTimeout,
          setInterval,
          clearInterval,
          addEventListener: () => {},
          removeEventListener: () => {},
          getComputedStyle: (el: any) => ({
            display: el?.style?.display || 'block',
            visibility: el?.style?.visibility || 'visible'
          })
        };
        mockWin.top = mockWin;

        const mockCanvas = {
          width: 0,
          height: 0,
          getContext: () => ({
            fillStyle: '',
            fillRect: () => {},
            drawImage: () => {},
            getImageData: () => ({
              // Contains varying pixel colors -> passes blank/occluded frame detector
              data: new Uint8ClampedArray([
                255, 255, 255, 255, 20, 20, 20, 255, 255, 255, 255, 255, 30, 30, 30, 255,
                255, 255, 255, 255, 40, 40, 40, 255, 255, 255, 255, 255, 50, 50, 50, 255
              ])
            })
          }),
          toDataURL: () => 'data:image/jpeg;base64,/9j/croppedClosedStem'
        };

        const mockDoc: any = {
          title: '绪论单元测试',
          location: mockWin.location,
          defaultView: mockWin,
          documentElement: { clientWidth: 1280, clientHeight: 800 },
          createElement: (tag: string) => (tag === 'canvas' ? mockCanvas : createMockNode({ tagName: tag })),
          querySelectorAll: (sel: string) => root.querySelectorAll(sel),
          querySelector: (sel: string) => root.querySelector(sel)
        };
        mockWin.document = mockDoc;

        return {
          mockWin,
          mockDoc,
          panelEl,
          selectedState,
          getCounts: () => ({ bottomSaveClicks, topTempSaveClicks, topSubmitClicks })
        };
      };

      try {
        // 1. 静态检查 manifest.json 与 background.js 契约
        const rootDir = path.resolve(process.cwd());
        const manifest = JSON.parse(
          fs.readFileSync(path.join(rootDir, 'chrome-extension', 'manifest.json'), 'utf8')
        );
        assert.equal(manifest.background?.service_worker, 'background.js');
        assert.ok(manifest.permissions?.includes('storage'));
        assert.ok(manifest.permissions?.includes('tabs'));
        assert.ok(manifest.host_permissions?.includes('<all_urls>'));
        assert.ok(manifest.host_permissions?.includes('*://*.zhihuishu.com/*'));

        const bgSrc = fs.readFileSync(path.join(rootDir, 'chrome-extension', 'background.js'), 'utf8');
        assert.ok(bgSrc.includes('KASA_CAPTURE_VISIBLE_TAB'));
        assert.ok(bgSrc.includes('KASA_EXT_FETCH'));
        assert.ok(bgSrc.includes('tab.active !== true'));
        assert.ok(bgSrc.includes("'minimized'"));

        // 2. buildAiPrompt 无文字仅附图提示词校验
        const visionPrompt = buildAiPrompt('single', '', ['选项A', '选项B'], undefined, [
          'data:image/jpeg;base64,abc'
        ]);
        const userParts = visionPrompt[1].content as any[];
        assert.ok(
          Array.isArray(userParts) &&
            String(userParts[0]?.text || '').includes('题干文字位于附图中'),
          '纯附图题目 Prompt 必须明确指引 AI 阅读附图中的题干'
        );

        // 3. 场景 A：Chrome 扩展运行环境 + 激活标签页 -> 隐身面板截题干图 + 扩展后台发多模态 AI -> 选中 B + 保存 & 暂存
        store.acknowledgeAllErrors();
        clearExamAutoResumeState();
        (globalThis as any).GM_xmlhttpRequest = undefined;
        store.config.aiApiKey = 'sk-ext-vision-key';
        store.config.aiBaseUrl = 'https://api.example.com/v1';
        store.config.aiModel = 'gpt-4o-mini';
        store.config.autoSubmitWork = false;
        store.config.enabledQuestionTypes = { single: true, multiple: true, judge: true, fill: true, essay: true };

        (globalThis as any).Image = class MockImage {
          naturalWidth = 2560;
          naturalHeight = 1600;
          onload: any = null;
          onerror: any = null;
          set src(_val: string) {
            setTimeout(() => this.onload?.(), 5);
          }
        };

        const sceneA = buildClosedShadowScene();
        (globalThis as any).window = sceneA.mockWin;
        (globalThis as any).document = sceneA.mockDoc;

        let panelVisDuringCapture = '';
        let panelOpacityDuringCapture = '';
        let capturedRequestPayload: any = null;

        (globalThis as any).chrome = {
          runtime: {
            id: 'kasa-ext-test-id',
            lastError: null,
            sendMessage: (msg: any, cb: (res: any) => void) => {
              if (msg?.type === 'KASA_CAPTURE_VISIBLE_TAB') {
                panelVisDuringCapture = sceneA.panelEl.style.visibility;
                panelOpacityDuringCapture = sceneA.panelEl.style.opacity;
                setTimeout(() => {
                  cb({ ok: true, dataUrl: 'data:image/png;base64,fullScreenPng' });
                }, 5);
                return;
              }
              if (msg?.type === 'KASA_EXT_FETCH') {
                capturedRequestPayload = JSON.parse(msg.body);
                setTimeout(() => {
                  cb({
                    ok: true,
                    status: 200,
                    text: JSON.stringify({ choices: [{ message: { content: '["B"]' } }] })
                  });
                }, 5);
              }
            }
          }
        };

        await doQuizTask(null, sceneA.mockDoc, {
          signal: new AbortController().signal,
          isCurrent: () => true
        });

        assert.equal(panelVisDuringCapture, 'hidden', '截屏瞬间必须临时隐藏脚本悬浮面板防遮挡题干');
        assert.equal(panelOpacityDuringCapture, '0');
        assert.equal(sceneA.panelEl.style.visibility, '', '截屏后必须 100% 恢复悬浮面板显示');
        assert.equal(sceneA.panelEl.style.opacity, '');

        const sentUserMsg = capturedRequestPayload?.messages?.[1]?.content;
        assert.ok(Array.isArray(sentUserMsg), '发给 AI 的消息必须包含多模态内容数组');
        assert.ok(
          sentUserMsg.some(
            (p: any) => p.type === 'image_url' && p.image_url?.url === 'data:image/jpeg;base64,/9j/croppedClosedStem'
          ),
          '必须把裁剪后的封闭题干 JPEG 图发送给多模态 AI'
        );
        assert.ok(
          String(sentUserMsg[0]?.text || '').includes('B. 确保人工智能的算法不带有任何偏见和歧视'),
          '附图同时必须携带全部明文选项文本'
        );
        assert.equal(sceneA.selectedState.get('B'), true, '扩展视觉识题后应准确选中 B');
        assert.deepEqual(sceneA.getCounts(), {
          bottomSaveClicks: 1,
          topTempSaveClicks: 1,
          topSubmitClicks: 0
        });

        // 4. 场景 B：标签页不在激活状态（TAB_NOT_ACTIVE）-> 隐私保护跳过截屏、零 AI 请求、触发红字告警且阻断自动提交
        clearExamAutoResumeState();
        store.acknowledgeAllErrors();
        store.config.autoSubmitWork = true;
        const sceneB = buildClosedShadowScene();
        (globalThis as any).window = sceneB.mockWin;
        (globalThis as any).document = sceneB.mockDoc;

        let extFetchCallsB = 0;
        (globalThis as any).chrome = {
          runtime: {
            id: 'kasa-ext-test-id',
            lastError: null,
            sendMessage: (msg: any, cb: (res: any) => void) => {
              if (msg?.type === 'KASA_CAPTURE_VISIBLE_TAB') {
                setTimeout(() => {
                  cb({
                    ok: false,
                    code: 'TAB_NOT_ACTIVE',
                    error: '当前网课标签页未处于所在窗口激活状态，为防误截其他标签页已跳过截屏'
                  });
                }, 5);
                return;
              }
              if (msg?.type === 'KASA_EXT_FETCH') {
                extFetchCallsB++;
                cb({ ok: true, status: 200, text: '{"choices":[]}' });
              }
            }
          }
        };

        await doQuizTask(null, sceneB.mockDoc, {
          signal: new AbortController().signal,
          isCurrent: () => true
        });
        assert.equal(extFetchCallsB, 0, '非激活标签跳过截屏后绝不可调用 AI');
        assert.equal(sceneB.selectedState.get('A'), false);
        assert.equal(sceneB.getCounts().topSubmitClicks, 0, '截屏跳过触发熔断后绝不可提交作业');
        assert.ok(
          store.pinnedErrors.some((e) => e.message.includes('未处于所在窗口激活状态')),
          'pinnedErrors 必须记录具体失败原因'
        );

        // 5. 场景 C：纯视觉题干配纯文本模型（后台返回 HTTP 400）-> 严禁剥离唯一图片重试，直接告警返回 []
        store.acknowledgeAllErrors();
        let visionModelFetchCalls = 0;
        (globalThis as any).chrome = {
          runtime: {
            id: 'kasa-ext-test-id',
            lastError: null,
            sendMessage: (msg: any, cb: (res: any) => void) => {
              if (msg?.type === 'KASA_EXT_FETCH') {
                visionModelFetchCalls++;
                setTimeout(() => {
                  cb({
                    ok: false,
                    status: 400,
                    text: '{"error":{"message":"image_url is not supported by this text-only model"}}'
                  });
                }, 5);
              }
            }
          }
        };

        const qRes = await queryAiAnswer(
          {
            id: 'vision-only-1',
            index: 1,
            type: 'single',
            title: '',
            options: ['选项A', '选项B'],
            images: ['data:image/jpeg;base64,/9j/croppedClosedStem'],
            status: 'searching'
          },
          '',
          new AbortController().signal
        );
        assert.deepEqual(qRes, []);
        assert.equal(visionModelFetchCalls, 1, '纯视觉题干遭模型拒图时绝不可剥离唯一图片退回纯文本重试');
        assert.ok(
          store.pinnedErrors.some((e) => e.message.includes('当前配置的 AI 模型不支持图片输入')),
          '必须在 pinnedErrors 提示切换支持视觉识图的多模态模型'
        );
      } finally {
        clearExamAutoResumeState();
        (globalThis as any).chrome = prevChrome;
        (globalThis as any).Image = prevImage;
        (globalThis as any).GM_xmlhttpRequest = prevXhr;
        (globalThis as any).document = prevDoc;
        (globalThis as any).window = prevWin;
        (globalThis as any).sessionStorage = prevSession;
        store.config.aiApiKey = prevKey;
        store.config.aiModel = prevModel;
        store.config.aiBaseUrl = prevBaseUrl;
        store.config.autoSubmitWork = prevAutoSubmit;
        store.acknowledgeAllErrors();
      }
    });

    it('25.14 断网自动暂停续答 + 禁用保底题库/盲选 A + 错误对象格式化 + 红色告警自动关闭自动提交并同步设置勾选框', async () => {
      const prevXhr = (globalThis as any).GM_xmlhttpRequest;
      const prevSession = (globalThis as any).sessionStorage;
      const prevKey = store.config.aiApiKey;
      const prevAutoSubmit = store.config.autoSubmitWork;
      const prevProgress = { ...store.progress };
      const navObj = (globalThis as any).navigator;
      const prevOnLineDesc = navObj ? Object.getOwnPropertyDescriptor(navObj, 'onLine') : undefined;

      const sMap = new Map<string, string>();
      (globalThis as any).sessionStorage = {
        getItem: (k: string) => sMap.get(k) ?? null,
        setItem: (k: string, v: string) => sMap.set(k, String(v)),
        removeItem: (k: string) => sMap.delete(k),
        clear: () => sMap.clear()
      };

      const makeRadioTimu = (id: string, title: string, opts: string[]) => {
        let selectedIdx = -1;
        const clickCounts = opts.map(() => 0);
        const optEls = opts.map((txt, idx) => {
          const letter = String.fromCharCode(65 + idx);
          const inputEl = {
            type: 'radio',
            get checked() {
              return selectedIdx === idx;
            },
            set checked(v: boolean) {
              if (v) selectedIdx = idx;
            },
            dispatchEvent: () => true
          };
          const el: any = {
            innerText: `${letter}. ${txt}`,
            textContent: `${letter}. ${txt}`,
            getAttribute: () => null,
            setAttribute: () => {},
            contains: () => false,
            scrollIntoView: () => {},
            classList: {
              contains: (c: string) => selectedIdx === idx && (c === 'check_answer' || c === 'cur' || c === 'active'),
              add: () => {},
              remove: () => {}
            },
            click: () => {
              clickCounts[idx]++;
              selectedIdx = idx;
            },
            querySelector: (sel: string) => {
              if (sel.includes('input[type="radio"]')) return inputEl;
              if (sel.includes('num_option')) {
                return {
                  getAttribute: () => letter,
                  innerText: letter,
                  textContent: letter,
                  classList: { contains: () => false, add: () => {}, remove: () => {} }
                };
              }
              return null;
            },
            _getClickCount: () => clickCounts[idx]
          };
          return el;
        });

        const timu: any = {
          style: {},
          getAttribute: (k: string) => (k === 'data-id' ? id : null),
          closest: () => null,
          contains: () => false,
          cloneNode: function() { return this; },
          querySelector: (sel: string) => {
            if (sel.includes('mark_name') || sel.includes('Zy_TItle')) {
              return { innerText: title, textContent: title };
            }
            if (sel.includes(':checked') || sel.includes('.check_answer')) {
              return selectedIdx >= 0 ? optEls[selectedIdx] : null;
            }
            if (sel.includes('input') || sel.includes('li')) return optEls[0];
            return null;
          },
          querySelectorAll: (sel: string) => {
            if (sel === 'ul.Zy_ulTop, ul.Zy_ulBottom, ul.options, ul.mark_letter, .stem_answer') return [{}];
            if (sel.includes('li')) return optEls;
            return [];
          }
        };

        return { timu, optEls, getSelectedIdx: () => selectedIdx };
      };

      try {
        // 1. 错误对象格式化绝不产生 [object Object]
        assert.equal(
          formatRequestError({ error: 'net::ERR_INTERNET_DISCONNECTED', statusText: '' }),
          'net::ERR_INTERNET_DISCONNECTED'
        );
        const emptyObjMsg = formatRequestError({});
        assert.ok(emptyObjMsg.length > 0 && !emptyObjMsg.includes('[object Object]'));
        assert.equal(formatRequestError(new Error('Failed to fetch')), 'Failed to fetch');

        // 2. 联网第 1 题成功，第 3 题触发 GM_xmlhttpRequest 网络异常 -> 自动暂停、不启保底 [B, 原神]、不盲选、自动关自动提交
        store.acknowledgeAllErrors();
        store.logs = [];
        store.config.aiApiKey = 'sk-network-test';
        store.config.autoSubmitWork = true;
        store.updateProgress({ status: 'playing', currentTime: '作答中', percent: 0 });

        const q1 = makeRadioTimu('chem-q1', '1. (单选题) 第一题测试', ['选项甲', '选项乙']);
        const q2 = makeRadioTimu('chem-q2', '3. (单选题) 海绵中发现的C25-呋喃萜类化合物可分为两类', ['线形和无环', '环状和倍半萜']);
        let submitClicks = 0;
        let saveClicks = 0;

        const mockDoc: any = {
          defaultView: {
            addEventListener: () => {},
            removeEventListener: () => {},
            getComputedStyle: () => ({ display: 'block', visibility: 'visible' })
          },
          querySelector: (sel: string) => {
            if (sel.includes('.questionLi') || sel.includes('.TiMu')) return q1.timu;
            if (sel.includes('btnSubmit') || sel.includes('#submitBtn')) return { click: () => { submitClicks++; } };
            if (sel.includes('btnSave') || sel.includes('#saveBtn')) return { click: () => { saveClicks++; } };
            return null;
          },
          querySelectorAll: (sel: string) => {
            if (sel.includes('.questionLi') || sel.includes('.TiMu')) return [q1.timu, q2.timu];
            return [];
          }
        };

        let aiCalls = 0;
        let simulateOnlineRecovery = false;
        (globalThis as any).GM_xmlhttpRequest = (opts: any) => {
          aiCalls++;
          const msgs = JSON.parse(opts.data).messages;
          const userPromptTxt = JSON.stringify(msgs[msgs.length - 1] ?? msgs);
          setTimeout(() => {
            if (userPromptTxt.includes('题目：海绵中发现')) {
              if (!simulateOnlineRecovery) {
                opts.onerror({ error: 'net::ERR_NAME_NOT_RESOLVED', statusText: '' });
              } else {
                opts.onload({
                  status: 200,
                  responseText: JSON.stringify({ choices: [{ message: { content: '["B"]' } }] })
                });
              }
            } else {
              opts.onload({
                status: 200,
                responseText: JSON.stringify({ choices: [{ message: { content: '["A"]' } }] })
              });
            }
          }, 5);
        };

        await doQuizTask(null, mockDoc, { signal: new AbortController().signal, isCurrent: () => true });

        assert.equal(q1.getSelectedIdx(), 0, '第 1 题应成功选中 A');
        assert.equal(q2.getSelectedIdx(), -1, '断网时后续题目绝不可启保底或盲选，必须保留空白');
        assert.equal(q2.optEls[0]._getClickCount(), 0);
        assert.equal(q2.optEls[1]._getClickCount(), 0);
        assert.equal(submitClicks, 0, '网络暂停时绝不可提交');
        assert.equal(saveClicks, 0, '网络暂停时绝不可点击暂存收尾');
        assert.equal(store.progress.status, 'paused', '网络异常必须立即切换为 paused');
        assert.equal(store.progress.currentTime, '网络异常已暂停');
        assert.equal(getLastAiQueryFailure().kind, 'network');
        assert.equal(getExamAutoResumeState(), null);
        assert.equal(store.config.autoSubmitWork, false, '出现红色告警后必须自动关闭答完自动提交');

        const allLogText = store.logs.map((l) => l.message).join('\n');
        assert.ok(!allLogText.includes('保底题库'), '正式答题严禁启用保底题库');
        assert.ok(!allLogText.includes('原神'), '正式答题严禁出现保底题库残留选项');
        assert.ok(!allLogText.includes('[object Object]'), '错误日志严禁出现 [object Object]');
        assert.ok(allLogText.includes('net::ERR_NAME_NOT_RESOLVED'), '应输出格式化后的真实网络错误');
        assert.ok(
          store.pinnedErrors.some((e) => e.message.includes('已自动关闭【答完自动提交】开关')),
          '必须在置顶红色告警明确提醒用户已关闭自动提交'
        );

        // 3. 恢复网络后点击继续答题（再次调用 doQuizTask），自动跳过已答的第 1 题，只请求并完成第 2 题
        simulateOnlineRecovery = true;
        const callsBeforeResume = aiCalls;
        await doQuizTask(null, mockDoc, { signal: new AbortController().signal, isCurrent: () => true });

        assert.equal(aiCalls - callsBeforeResume, 1, '恢复网络继续答题时应自动跳过已作答的第 1 题');
        assert.equal(q2.getSelectedIdx(), 1, '恢复后第 2 题应正常选中 B');
        assert.equal(store.progress.status, 'finished');
        assert.equal(submitClicks, 0, '先前红色告警已永久关闭自动提交，恢复答完后仅暂存不自动提交');
        assert.equal(saveClicks, 1);

        // 4. 离线快速失败测试 (navigator.onLine === false)
        if (navObj) {
          Object.defineProperty(navObj, 'onLine', { configurable: true, get: () => false });
          const offlineQ = makeRadioTimu('offline-q1', '1. (单选题) 离线快速拦截测试', ['选项1', '选项2']);
          const offlineDoc: any = {
            ...mockDoc,
            querySelector: (sel: string) =>
              sel.includes('.questionLi') || sel.includes('.TiMu') ? offlineQ.timu : null,
            querySelectorAll: (sel: string) =>
              sel.includes('.questionLi') || sel.includes('.TiMu') ? [offlineQ.timu] : []
          };
          const callsBeforeOffline = aiCalls;
          await doQuizTask(null, offlineDoc, { signal: new AbortController().signal, isCurrent: () => true });
          assert.equal(aiCalls, callsBeforeOffline, '浏览器离线时应零网络请求立即快速暂停');
          assert.equal(offlineQ.getSelectedIdx(), -1);
          assert.equal(store.progress.status, 'paused');
          if (prevOnLineDesc) {
            Object.defineProperty(navObj, 'onLine', prevOnLineDesc);
          } else {
            delete navObj.onLine;
          }
        }

        // 5. HTTP 200 但未匹配选项 -> 保留空白、取消自动提交，绝不误判为断网暂停
        submitClicks = 0;
        saveClicks = 0;
        store.config.autoSubmitWork = true;
        const unmatchQ = makeRadioTimu('unmatch-q1', '1. (单选题) 无法匹配选项测试', ['北京', '上海']);
        const unmatchDoc: any = {
          ...mockDoc,
          querySelectorAll: (sel: string) =>
            sel.includes('.questionLi') || sel.includes('.TiMu') ? [unmatchQ.timu] : []
        };
        (globalThis as any).GM_xmlhttpRequest = (opts: any) => {
          setTimeout(() => {
            opts.onload({
              status: 200,
              responseText: JSON.stringify({ choices: [{ message: { content: '["不存在选项XYZ"]' } }] })
            });
          }, 5);
        };
        await doQuizTask(null, unmatchDoc, { signal: new AbortController().signal, isCurrent: () => true });
        assert.equal(unmatchQ.getSelectedIdx(), -1, '无匹配选项时绝不盲选 A');
        assert.equal(store.progress.status, 'finished', 'HTTP 200 未匹配选项仅保留空白，不触发断网暂停');
        assert.equal(submitClicks, 0);
        assert.equal(saveClicks, 1);

        // 6. FloatingCard 设置页 #cfg-auto-submit 同步取消勾选验证
        const { FloatingCard } = await import('../src/ui/floating-card');
        const card = new FloatingCard();
        store.config.autoSubmitWork = true;
        store.config.panelMinimized = false;
        (card as any).renderedMinimized = false;
        (card as any).currentTab = 'setting';
        const mockAutoSubmitCheckbox = { checked: true };
        (card as any).shadow = {
          querySelector: (sel: string) => {
            if (sel === '#cfg-auto-submit') return mockAutoSubmitCheckbox;
            return null;
          }
        };
        store.addLog('触发页面红色异常告警', 'error');
        (card as any).onStoreUpdate();
        assert.equal(store.config.autoSubmitWork, false);
        assert.equal(mockAutoSubmitCheckbox.checked, false, '设置页自动提交开关复选框必须同步取消勾选');
      } finally {
        clearExamAutoResumeState();
        if (navObj) {
          if (prevOnLineDesc) {
            Object.defineProperty(navObj, 'onLine', prevOnLineDesc);
          } else {
            delete navObj.onLine;
          }
        }
        (globalThis as any).GM_xmlhttpRequest = prevXhr;
        (globalThis as any).sessionStorage = prevSession;
        store.config.aiApiKey = prevKey;
        store.config.autoSubmitWork = prevAutoSubmit;
        store.updateProgress(prevProgress);
        store.acknowledgeAllErrors();
      }
    });

    it('25.15 wisdom-mooc.zhihuishu.com/study/index 融合共享课防点回主界面：忽略 .el-menu-item/.menu-item/顶部返回导航，精准命中下一节 .chapter-content-second', async () => {
      const prevAutoNext = store.config.autoNextChapter;
      const prevDelayBase = store.config.randomDelayBase;
      const prevDelayJitter = store.config.randomDelayJitter;

      const matchesSimple = (el: any, part: string): boolean => {
        const cls = (el.className || '').split(/\s+/).filter(Boolean);
        const tag = (el.tagName || '').toUpperCase();
        if (part.startsWith('.') && part.slice(1).includes('.')) {
          return part.slice(1).split('.').every((sub) => cls.includes(sub));
        }
        if (part.startsWith('.')) return cls.includes(part.slice(1));
        const attrContains = part.match(/^\[class\*="([^"]+)"\]$/);
        if (attrContains) return (el.className || '').includes(attrContains[1]);
        const roleMatch = part.match(/^\[role="([^"]+)"\]$/);
        if (roleMatch) return el.getAttribute?.('role') === roleMatch[1];
        if (part === '[onclick]') return Boolean(el.getAttribute?.('onclick'));
        if (/^[a-z0-9]+$/i.test(part)) return tag === part.toUpperCase();
        return false;
      };

      const matchesSel = (el: any, sel: string): boolean =>
        sel
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .some((p) => matchesSimple(el, p));

      const makeNode = (opts: {
        tagName: string;
        className?: string;
        attrs?: Record<string, string>;
        text?: string;
        children?: any[];
        onClick?: () => void;
      }): any => {
        const node: any = {
          tagName: opts.tagName,
          className: opts.className || '',
          style: { display: '', visibility: '' },
          parentElement: null as any,
          children: opts.children || [],
          clicked: 0,
          _attrs: { ...(opts.attrs || {}) },
          classList: {
            contains: (c: string) => (node.className || '').split(/\s+/).includes(c),
            add: (c: string) => {
              const parts = (node.className || '').split(/\s+/).filter(Boolean);
              if (!parts.includes(c)) node.className = [...parts, c].join(' ');
            },
            remove: (c: string) => {
              node.className = (node.className || '')
                .split(/\s+/)
                .filter((x: string) => x && x !== c)
                .join(' ');
            }
          },
          getAttribute: (k: string) => (k in node._attrs ? node._attrs[k] : null),
          hasAttribute: (k: string) => k in node._attrs,
          contains: (other: any): boolean => {
            if (!other) return false;
            if (node === other) return true;
            return (node.children || []).some((ch: any) => ch === other || ch.contains?.(other));
          },
          closest: (sel: string): any => {
            let cur: any = node;
            while (cur) {
              if (matchesSel(cur, sel)) return cur;
              cur = cur.parentElement;
            }
            return null;
          },
          querySelectorAll: (sel: string): any[] => {
            const res: any[] = [];
            const walk = (n: any) => {
              for (const ch of n.children || []) {
                if (matchesSel(ch, sel)) res.push(ch);
                walk(ch);
              }
            };
            walk(node);
            return res;
          },
          querySelector: (sel: string): any => node.querySelectorAll(sel)[0] || null,
          click: () => {
            node.clicked++;
            opts.onClick?.();
          },
          get innerText(): string {
            if (opts.text !== undefined && (!node.children || node.children.length === 0)) return opts.text;
            return (node.children || [])
              .map((c: any) => c.innerText || c.textContent || '')
              .filter(Boolean)
              .join(' ');
          },
          get textContent(): string {
            return node.innerText;
          }
        };
        for (const ch of node.children) ch.parentElement = node;
        return node;
      };

      try {
        clearZhihuishuCompletionSuppression();
        store.config.autoNextChapter = true;
        store.config.randomDelayBase = 0.05;
        store.config.randomDelayJitter = 0;
        store.logs = [];

        const pageUrl = 'https://wisdom-mooc.zhihuishu.com/study/index?recruitAndCourseId=4e5b585d44584859454a58585a4d5d4751';
        assert.equal(isZhihuishuVideoPage(undefined, pageUrl), true, 'wisdom-mooc /study/index 必须识别为视频学习页');

        // 干扰 1：顶部导航栏返回主界面链接 + 左侧 .el-menu-item / .menu-item 主导航
        const backHomeLink = makeNode({
          tagName: 'A',
          className: 'go-back-link menu-item',
          attrs: { href: '/home/index' },
          text: '返回课程首页'
        });
        const topHeader = makeNode({ tagName: 'HEADER', className: 'site-header', children: [backHomeLink] });

        const navHomeItem = makeNode({
          tagName: 'LI',
          className: 'el-menu-item',
          children: [makeNode({ tagName: 'A', attrs: { href: '/myCourse' }, text: '课程主页' })]
        });
        const navGraphItem = makeNode({
          tagName: 'DIV',
          className: 'menu-item knowledge-item',
          text: '知识图谱'
        });
        const leftNav = makeNode({
          tagName: 'NAV',
          className: 'side-nav',
          children: [navHomeItem, navGraphItem]
        });

        // 真实课时目录：.chapter-content -> .chapter-item -> .chapter-content-second
        const listeners: Record<string, Set<() => void>> = {
          timeupdate: new Set(),
          pause: new Set(),
          ended: new Set()
        };
        const videoEl: any = {
          tagName: 'VIDEO',
          className: 'vjs-tech',
          src: 'https://video.zhihuishu.com/lesson-1.mp4',
          currentSrc: 'https://video.zhihuishu.com/lesson-1.mp4',
          duration: 120,
          currentTime: 119.5,
          ended: true,
          paused: false,
          muted: false,
          playbackRate: 1,
          isConnected: true,
          play: async () => {},
          pause: () => {
            videoEl.paused = true;
          },
          addEventListener: (ev: string, fn: () => void) => listeners[ev]?.add(fn),
          removeEventListener: (ev: string, fn: () => void) => listeners[ev]?.delete(fn)
        };

        const lesson1 = makeNode({
          tagName: 'DIV',
          className: 'chapter-content-second current',
          text: '1.1 课程导论与背景'
        });
        const lesson2 = makeNode({
          tagName: 'DIV',
          className: 'chapter-content-second',
          text: '1.2 核心原理详解',
          onClick: () => {
            lesson1.classList.remove('current');
            lesson2.classList.add('current');
            videoEl.src = 'https://video.zhihuishu.com/lesson-2.mp4';
            videoEl.currentSrc = 'https://video.zhihuishu.com/lesson-2.mp4';
            videoEl.currentTime = 0;
            videoEl.ended = false;
          }
        });
        const chapter1 = makeNode({
          tagName: 'DIV',
          className: 'chapter-item',
          children: [
            makeNode({ tagName: 'DIV', className: 'chapter-content-first', text: '第一章 绪论' }),
            lesson1,
            lesson2
          ]
        });
        const chapterContent = makeNode({
          tagName: 'DIV',
          className: 'chapter-content',
          children: [chapter1]
        });

        const rootBody = makeNode({
          tagName: 'BODY',
          children: [topHeader, leftNav, chapterContent]
        });

        const mockDoc: any = {
          location: { href: pageUrl },
          defaultView: { getComputedStyle: () => ({ display: 'block', visibility: 'visible', backgroundColor: 'transparent' }) },
          querySelectorAll: (sel: string) => {
            if (sel === 'video' || sel.includes('#vjs_container_html5_api')) return [videoEl];
            return rootBody.querySelectorAll(sel);
          },
          querySelector: (sel: string) => {
            if (sel === 'video' || sel.includes('#vjs_container_html5_api')) return videoEl;
            return rootBody.querySelector(sel);
          }
        };

        // 1. 静态目录扫描绝不可把 .el-menu-item / 知识图谱 / 返回首页当成课时
        const discovered = findZhihuishuAiLessonItems(mockDoc);
        assert.deepEqual(discovered, [lesson1, lesson2], '必须精准识别 .chapter-content-second 课时而非导航菜单');
        const nextBtn = findNextZhihuishuVideoItem(mockDoc);
        assert.equal(nextBtn, lesson2, '必须精准命中下一节 1.2 而绝不命中返回主界面或导航项');

        // 2. 端到端播完切集：成功切到 1.2，且返回首页 / 课程主页 / 知识图谱全部 0 点击
        await playZhihuishuVideoTask(
          mockDoc,
          { signal: new AbortController().signal, isCurrent: () => true },
          { pollIntervalMs: 30, switchWaitTimeoutMs: 500 }
        );

        assert.equal(backHomeLink.clicked, 0, '绝不可点击顶部返回首页链接');
        assert.equal(navHomeItem.clicked, 0, '绝不可点击侧边栏课程主页 .el-menu-item');
        assert.equal(navGraphItem.clicked, 0, '绝不可点击知识图谱 .menu-item');
        assert.equal(lesson2.clicked, 1, '必须点击真正的下一节课时 1.2');
        assert.ok(
          store.logs.some((l) => l.message.includes('触发智慧树下一节视频切换：【1.2 核心原理详解】')),
          '切集日志必须明确输出实际点击的课时名称'
        );
      } finally {
        clearZhihuishuCompletionSuppression();
        store.config.autoNextChapter = prevAutoNext;
        store.config.randomDelayBase = prevDelayBase;
        store.config.randomDelayJitter = prevDelayJitter;
      }
    });

    it('25.16 新版智慧树真实 DOM 对齐（.el-collapse-item__header + .item-box + img.finish-icon 95% 提前切章）与安全验证弹窗暂停/三重提醒/自动续播', async () => {
      const prevAutoNext = store.config.autoNextChapter;
      const prevDelayBase = store.config.randomDelayBase;
      const prevDelayJitter = store.config.randomDelayJitter;
      const prevNotify = (globalThis as any).GM_notification;

      const matchesSimple = (el: any, part: string): boolean => {
        const cls = (el.className || '').split(/\s+/).filter(Boolean);
        const tag = (el.tagName || '').toUpperCase();
        if (part.startsWith('.') && part.slice(1).includes('.')) {
          return part.slice(1).split('.').every((sub) => cls.includes(sub));
        }
        if (part.startsWith('.')) return cls.includes(part.slice(1));
        const attrContains = part.match(/^\[class\*="([^"]+)"\]$/);
        if (attrContains) return (el.className || '').includes(attrContains[1]);
        const roleMatch = part.match(/^\[role="([^"]+)"\]$/);
        if (roleMatch) return el.getAttribute?.('role') === roleMatch[1];
        if (part === '[onclick]') return Boolean(el.getAttribute?.('onclick'));
        if (/^[a-z0-9]+$/i.test(part)) return tag === part.toUpperCase();
        return false;
      };

      const matchesSel = (el: any, sel: string): boolean =>
        sel
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .some((p) => matchesSimple(el, p));

      const makeNode = (opts: {
        tagName: string;
        className?: string;
        attrs?: Record<string, string>;
        style?: { display?: string; visibility?: string };
        bg?: string;
        text?: string;
        children?: any[];
        onClick?: () => void;
      }): any => {
        const node: any = {
          tagName: opts.tagName,
          className: opts.className || '',
          style: opts.style || { display: '', visibility: '' },
          _bg: opts.bg || 'transparent',
          parentElement: null as any,
          children: opts.children || [],
          clicked: 0,
          _attrs: { ...(opts.attrs || {}) },
          classList: {
            contains: (c: string) => (node.className || '').split(/\s+/).includes(c),
            add: (c: string) => {
              const parts = (node.className || '').split(/\s+/).filter(Boolean);
              if (!parts.includes(c)) node.className = [...parts, c].join(' ');
            },
            remove: (c: string) => {
              node.className = (node.className || '')
                .split(/\s+/)
                .filter((x: string) => x && x !== c)
                .join(' ');
            }
          },
          getAttribute: (k: string) => (k in node._attrs ? node._attrs[k] : null),
          setAttribute: (k: string, v: string) => {
            node._attrs[k] = v;
          },
          hasAttribute: (k: string) => k in node._attrs,
          contains: (other: any): boolean => {
            if (!other) return false;
            if (node === other) return true;
            return (node.children || []).some((ch: any) => ch === other || ch.contains?.(other));
          },
          closest: (sel: string): any => {
            let cur: any = node;
            while (cur) {
              if (matchesSel(cur, sel)) return cur;
              cur = cur.parentElement;
            }
            return null;
          },
          querySelectorAll: (sel: string): any[] => {
            const res: any[] = [];
            const walk = (n: any) => {
              for (const ch of n.children || []) {
                if (matchesSel(ch, sel)) res.push(ch);
                walk(ch);
              }
            };
            walk(node);
            return res;
          },
          querySelector: (sel: string): any => node.querySelectorAll(sel)[0] || null,
          click: () => {
            node.clicked++;
            opts.onClick?.();
          },
          get innerText(): string {
            if (opts.text !== undefined && (!node.children || node.children.length === 0)) return opts.text;
            return (node.children || [])
              .map((c: any) => c.innerText || c.textContent || '')
              .filter(Boolean)
              .join(' ');
          },
          get textContent(): string {
            return node.innerText;
          }
        };
        for (const ch of node.children) ch.parentElement = node;
        return node;
      };

      try {
        clearZhihuishuCompletionSuppression();
        store.acknowledgeAllErrors();
        store.logs = [];
        store.config.autoNextChapter = true;
        store.config.randomDelayBase = 0.04;
        store.config.randomDelayJitter = 0;

        // ===== 子场景 A：真实 DOM (.el-collapse-item__header + .item-box + img.finish-icon) 在 95.6% 未播完时提前切入第二章 2.1 =====
        const backBtn = makeNode({ tagName: 'DIV', className: 'back-btn', text: '浙江大学' });
        const mainHeader = makeNode({
          tagName: 'DIV',
          className: 'main-header',
          children: [makeNode({ tagName: 'DIV', className: 'header-com', children: [backBtn] })]
        });

        const lesson14FinishIcon = makeNode({
          tagName: 'IMG',
          className: 'finish-icon el-tooltip__trigger',
          attrs: { src: 'https://image.zhihuishu.com/zhs/b2cm/base1/202512/fe9d6193.png' },
          style: { display: 'none', visibility: '' }
        });
        const lesson14Box = makeNode({
          tagName: 'DIV',
          className: 'item-box',
          bg: 'rgb(236, 237, 255)',
          children: [
            lesson14FinishIcon,
            makeNode({ tagName: 'DIV', className: 'item-num', text: '1.4' }),
            makeNode({ tagName: 'DIV', className: 'item-name', text: '人工智能的伦理安全' })
          ]
        });
        const lesson11Box = makeNode({
          tagName: 'DIV',
          className: 'item-box',
          children: [
            makeNode({ tagName: 'IMG', className: 'finish-icon' }),
            makeNode({ tagName: 'DIV', className: 'item-num', text: '1.1' }),
            makeNode({ tagName: 'DIV', className: 'item-name', text: '人工智能的新时代和起源定义' })
          ]
        });
        const quizItemBox = makeNode({
          tagName: 'DIV',
          className: 'item-box',
          children: [makeNode({ tagName: 'DIV', className: 'item-name', text: '测试' })]
        });

        const video1: any = {
          tagName: 'VIDEO',
          src: 'https://video.zhihuishu.com/1-4.mp4',
          currentSrc: 'https://video.zhihuishu.com/1-4.mp4',
          duration: 802,
          currentTime: 766, // 95.5% 未播完！
          ended: false,
          paused: false,
          muted: false,
          playbackRate: 1,
          isConnected: true,
          playCalls: 0,
          play: async () => {
            video1.playCalls++;
            video1.paused = false;
          },
          pause: () => {
            video1.paused = true;
          },
          addEventListener: () => {},
          removeEventListener: () => {}
        };

        const lesson21Box = makeNode({
          tagName: 'DIV',
          className: 'item-box',
          children: [
            makeNode({ tagName: 'DIV', className: 'item-num', text: '2.1' }),
            makeNode({ tagName: 'DIV', className: 'item-name', text: '人工智能系统架构与计算机系统基础' })
          ],
          onClick: () => {
            lesson14Box._bg = 'transparent';
            lesson21Box._bg = 'rgb(236, 237, 255)';
            video1.src = 'https://video.zhihuishu.com/2-1.mp4';
            video1.currentSrc = 'https://video.zhihuishu.com/2-1.mp4';
            video1.currentTime = 0;
          }
        });
        const ch2Wrap = makeNode({
          tagName: 'DIV',
          className: 'el-collapse-item__wrap',
          style: { display: 'none', visibility: '' },
          children: [
            makeNode({
              tagName: 'DIV',
              className: 'chapter-content',
              children: [makeNode({ tagName: 'DIV', className: 'chapter-item', children: [lesson21Box] })]
            })
          ]
        });

        const ch1Header = makeNode({
          tagName: 'DIV',
          className: 'el-collapse-item__header is-active',
          attrs: { 'aria-expanded': 'true', role: 'button' },
          children: [
            makeNode({
              tagName: 'SPAN',
              className: 'el-collapse-item__title',
              children: [
                makeNode({
                  tagName: 'DIV',
                  className: 'chapter-first',
                  children: [
                    makeNode({ tagName: 'DIV', className: 'chapter-title', text: '第一章:' }),
                    makeNode({ tagName: 'DIV', className: 'chapter-name', text: '初识人工智能' })
                  ]
                })
              ]
            })
          ]
        });
        const ch2Header = makeNode({
          tagName: 'DIV',
          className: 'el-collapse-item__header',
          attrs: { 'aria-expanded': 'false', role: 'button' },
          children: [
            makeNode({
              tagName: 'SPAN',
              className: 'el-collapse-item__title',
              children: [
                makeNode({
                  tagName: 'DIV',
                  className: 'chapter-first',
                  children: [
                    makeNode({ tagName: 'DIV', className: 'chapter-title', text: '第二章:' }),
                    makeNode({ tagName: 'DIV', className: 'chapter-name', text: '人工智能的系统数据基础' })
                  ]
                })
              ]
            })
          ],
          onClick: () => {
            ch2Header.setAttribute('aria-expanded', 'true');
            ch2Header.classList.add('is-active');
            ch2Wrap.style.display = 'block';
          }
        });
        const ch3Header = makeNode({
          tagName: 'DIV',
          className: 'el-collapse-item__header',
          attrs: { 'aria-expanded': 'false', role: 'button' },
          children: [
            makeNode({
              tagName: 'SPAN',
              className: 'el-collapse-item__title',
              children: [
                makeNode({
                  tagName: 'DIV',
                  className: 'chapter-first',
                  children: [
                    makeNode({ tagName: 'DIV', className: 'chapter-title', text: '第三章:' }),
                    makeNode({ tagName: 'DIV', className: 'chapter-name', text: '人工智能的应用开发基础' })
                  ]
                })
              ]
            })
          ]
        });

        const ch1Item = makeNode({
          tagName: 'DIV',
          className: 'el-collapse-item is-active',
          children: [
            ch1Header,
            makeNode({
              tagName: 'DIV',
              className: 'el-collapse-item__wrap',
              children: [
                makeNode({
                  tagName: 'DIV',
                  className: 'chapter-content',
                  children: [
                    makeNode({ tagName: 'DIV', className: 'chapter-item', children: [lesson11Box] }),
                    makeNode({ tagName: 'DIV', className: 'chapter-item', children: [lesson14Box] }),
                    makeNode({ tagName: 'DIV', className: 'chapter-item', children: [quizItemBox] })
                  ]
                })
              ]
            })
          ]
        });
        const ch2Item = makeNode({ tagName: 'DIV', className: 'el-collapse-item', children: [ch2Header, ch2Wrap] });
        const ch3Item = makeNode({ tagName: 'DIV', className: 'el-collapse-item', children: [ch3Header] });

        const collapseRoot = makeNode({
          tagName: 'DIV',
          className: 'course-catalog',
          children: [
            makeNode({
              tagName: 'DIV',
              className: 'el-collapse',
              children: [ch1Item, ch2Item, ch3Item]
            })
          ]
        });

        const rootBody = makeNode({ tagName: 'BODY', children: [mainHeader, collapseRoot] });
        const pageUrl = 'https://wisdom-mooc.zhihuishu.com/study/index?recruitAndCourseId=test142';
        const mockDocA: any = {
          title: '智慧树网 - 人工智能通识基础',
          location: { href: pageUrl },
          defaultView: {
            getComputedStyle: (el: any) => ({
              display: el?.style?.display || 'block',
              visibility: el?.style?.visibility || 'visible',
              backgroundColor: el?._bg || 'transparent'
            })
          },
          querySelectorAll: (sel: string) => {
            if (sel === 'video' || sel.includes('#vjs_container_html5_api')) return [video1];
            return rootBody.querySelectorAll(sel);
          },
          querySelector: (sel: string) => {
            if (sel === 'video' || sel.includes('#vjs_container_html5_api')) return video1;
            return rootBody.querySelector(sel);
          }
        };

        // 1. 必须保留 .el-collapse-item__header 作为章节折叠头（不可降级为内层 .chapter-title）
        const headers = findZhihuishuChapterHeaders(mockDocA);
        assert.deepEqual(headers, [ch1Header, ch2Header, ch3Header], '必须锁定 .el-collapse-item__header 保留 aria-expanded');
        assert.deepEqual(findZhihuishuAiLessonItems(mockDocA), [lesson11Box, lesson14Box], '必须精准识别 .item-box 课时并排除测试与顶部返回栏');

        // 2. 启动播放（此时 1.4 进度 95.5% 未亮勾），80ms 后模拟平台亮起 img.finish-icon -> 立刻提前切入第二章 2.1
        setTimeout(() => {
          lesson14FinishIcon.style.display = 'inline-block';
        }, 70);

        await playZhihuishuVideoTask(
          mockDocA,
          { signal: new AbortController().signal, isCurrent: () => true },
          { pollIntervalMs: 30, switchWaitTimeoutMs: 400, chapterExpandDelayMs: 30 }
        );

        assert.equal(backBtn.clicked, 0, '绝不可点击顶部返回按钮');
        assert.equal(ch2Header.clicked, 1, '必须展开第二章');
        assert.equal(ch3Header.clicked, 0, '绝不可跳章连点第三章');
        assert.equal(lesson21Box.clicked, 1, '左侧亮蓝勾后必须提前切入第二章 2.1');

        // ===== 子场景 B：安全验证弹窗检测 + 暂停防抢播 + 三重提醒（红警/标题闪烁/桌面通知）+ 手动关闭后自动续播 =====
        store.acknowledgeAllErrors();
        store.logs = [];
        let notifyCalls = 0;
        (globalThis as any).GM_notification = () => {
          notifyCalls++;
        };

        const captchaModal = makeNode({
          tagName: 'DIV',
          className: 'el-dialog verify-dialog',
          attrs: { role: 'dialog' },
          style: { display: 'none', visibility: '' },
          text: '请完成安全验证 请点击立方体颜色一样的大写N'
        });
        const aiPracticeModal = makeNode({
          tagName: 'DIV',
          className: 'el-dialog',
          attrs: { role: 'dialog' },
          style: { display: 'block', visibility: '' },
          text: 'AI随堂练习 1. [单选题] 测试题目 提交作答'
        });

        const listenersB: Record<string, Set<() => void>> = {
          timeupdate: new Set(),
          pause: new Set(),
          ended: new Set()
        };
        const videoB: any = {
          tagName: 'VIDEO',
          src: 'https://video.zhihuishu.com/2-1.mp4',
          currentSrc: 'https://video.zhihuishu.com/2-1.mp4',
          duration: 300,
          currentTime: 60,
          ended: false,
          paused: false,
          muted: false,
          playbackRate: 1,
          isConnected: true,
          playCalls: 0,
          play: async () => {
            videoB.playCalls++;
            videoB.paused = false;
          },
          pause: () => {
            videoB.paused = true;
          },
          addEventListener: (ev: string, fn: () => void) => listenersB[ev]?.add(fn),
          removeEventListener: (ev: string, fn: () => void) => listenersB[ev]?.delete(fn)
        };

        const bodyB = makeNode({ tagName: 'BODY', children: [captchaModal, aiPracticeModal] });
        const mockDocB: any = {
          title: '智慧树课程页',
          location: { href: pageUrl },
          defaultView: {
            getComputedStyle: (el: any) => ({
              display: el?.style?.display || 'block',
              visibility: el?.style?.visibility || 'visible',
              backgroundColor: 'transparent'
            })
          },
          querySelectorAll: (sel: string) => {
            if (sel === 'video' || sel.includes('#vjs_container_html5_api')) return [videoB];
            return bodyB.querySelectorAll(sel);
          },
          querySelector: (sel: string) => {
            if (sel === 'video' || sel.includes('#vjs_container_html5_api')) return videoB;
            return bodyB.querySelector(sel);
          }
        };

        // 确认 AI随堂练习绝不被误判为安全验证
        assert.equal(findVisibleZhihuishuCaptchaDialog(mockDocB), null, 'AI随堂练习绝不可误判为安全验证');
        aiPracticeModal.style.display = 'none';

        const controllerB = new AbortController();
        const taskB = playZhihuishuVideoTask(
          mockDocB,
          { signal: controllerB.signal, isCurrent: () => !controllerB.signal.aborted },
          { pollIntervalMs: 30 }
        );

        await new Promise((r) => setTimeout(r, 80));
        const playsBeforeCaptcha = videoB.playCalls;

        // 模拟安全验证弹窗出现并暂停视频
        captchaModal.style.display = 'block';
        videoB.paused = true;
        listenersB.pause.forEach((fn) => fn());

        await new Promise((r) => setTimeout(r, 120));

        assert.equal(captchaModal.clicked, 0, '绝不可点击或尝试绕过安全验证弹窗');
        assert.equal(videoB.playCalls, playsBeforeCaptcha, '安全验证弹窗期间绝不可抢播 video.play()');
        assert.equal(store.progress.status, 'paused');
        assert.equal(store.progress.currentTime, '等待安全验证');
        assert.equal(notifyCalls, 1, '弹出安全验证必须触发桌面通知');
        assert.ok(mockDocB.title.includes('【请完成安全验证】'), '页面标题必须切换为安全验证闪烁提醒');
        assert.ok(
          store.pinnedErrors.some((e) => e.message.includes('请完成安全验证')),
          '面板必须写入红色置顶安全验证提醒'
        );

        // 模拟用户手动完成验证（弹窗消失）-> 标题恢复且自动续播
        captchaModal.style.display = 'none';
        await new Promise((r) => setTimeout(r, 120));

        assert.equal(mockDocB.title, '智慧树课程页', '安全验证关闭后必须恢复原标题');
        assert.ok(videoB.playCalls > playsBeforeCaptcha, '安全验证关闭后必须自动恢复播放');

        controllerB.abort();
        await taskB;
      } finally {
        clearZhihuishuCompletionSuppression();
        (globalThis as any).GM_notification = prevNotify;
        store.config.autoNextChapter = prevAutoNext;
        store.config.randomDelayBase = prevDelayBase;
        store.config.randomDelayJitter = prevDelayJitter;
        store.acknowledgeAllErrors();
      }
    });
  });
});
