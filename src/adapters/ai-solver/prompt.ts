import { QuestionType, QuestionSubType, ContentPart } from '../../types';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export const buildAiPrompt = (
  type: QuestionType,
  stem: string,
  options: string[],
  paperContext?: string,
  images?: string[],
  subType?: QuestionSubType
): ChatMessage[] => {
  let typeRule = '';
  let outputContract = '';

  switch (type) {
    case 'judge':
      typeRule = '这是判断题。答案必须是“对”或“错”，亦可直接使用字母标号（A 代表对/正确，B 代表错/错误）。';
      outputContract = '请先简要陈述教材依据，最后一行务必输出标准 JSON 数组包含你的最终答案（例如：["对"] 或 ["A"]）。';
      break;
    case 'single':
      typeRule = '这是单选题。请给出唯一正确选项的字母标号（如 A、B、C 或 D）。可直接返回字母或字母+选项文本（如 ["B"] 或 ["B. 选项文本"]）。';
      outputContract = '请先用 1~2 句话简要陈述教材依据与选项辨析，最后一行务必输出标准 JSON 数组包含你的最终答案项，例如：["B"]。';
      break;
    case 'multiple':
      typeRule = '这是多选题。请逐一核验每个选项，给出所有正确选项的字母标号数组（如 ["A", "C"] 或 ["A. 选项1", "C. 选项2"]）。';
      outputContract = '请先用 1~2 句话简要陈述教材依据与选项辨析，最后一行务必输出标准 JSON 数组包含你的最终答案项，例如：["A", "C"]。';
      break;
    case 'fill':
      typeRule = '这是填空题。按题目中各个空格先后顺序给出教材标准答案，每个空对应返回数组里的一个字符串元素。';
      outputContract = '按空格顺序在最后一行务必输出标准 JSON 字符串数组，例如：["答案1", "答案2"]；严禁使用 Markdown 和 LaTeX 公式。';
      break;
    case 'essay':
      if (subType === 'definition') {
        typeRule = '这是主观名词解释题。请严格按照高校权威教材标准定义与中国高校优秀考生手写口吻作答，概括本质属性、核心机理与典型意义，严禁同义词别名括号打补丁，不要重复抄写词条题干。';
        outputContract = '严禁使用 Markdown 格式标记（如 **、#、- ）、LaTeX 公式符号（如 $、\\(、\\mathrm）和 JSON 数组，直接输出纯文本标准答案正文（涉及化学式或同位素用普通文本如 13C-NMR 表示）。';
      } else {
        typeRule = '这是主观简答/论述题。请以中国高校优秀本科生在期末考试中手写的标准答案口吻作答，聚焦核心采分点，条理自然凝练，严禁别名打补丁。';
        outputContract = '严禁使用 Markdown 格式符（如 **、#）、LaTeX 公式符号（如 $、\\(）和 JSON 数组，直接输出纯文本正文。';
      }
      break;
    default:
      typeRule = '请根据题目内容直接给出准确答案。';
      outputContract = '请先简要说明依据，最后一行输出最终答案。';
      break;
  }

  const baseGuidelines =
    type === 'essay'
      ? `审题与作答准则：
1. 【高校优秀考生作答风格】：严格以中国高校优秀本科生在期末考试中手写的标准答案口吻作答，逻辑自然凝练，直切采分点。
2. 【杜绝维基百科式报户口】：聚焦核心得分采分点（本质属性 + 核心机制/生理功能 + 关键应用或意义）。除非题目明确要求，否则切勿主动机械罗列化学结构简式（如 H2NCH2CH2SO3H）、分子式或机械套话。
3. 【严禁解释性括号与别名打补丁】：严禁在正文中使用括号给名词加同义词、英文简称或冗余别名（严禁使用“A（又称B）”、“A（即B）”），直接采用单一最标准教材术语，行文连贯自然。
4. 【纯文本规范】：输出内容将直接注入超星富文本编辑器，严禁携带任何 Markdown（如加粗、标题、列表符号）、LaTeX 语法标记（如 $、\\(、\\mathrm）或 JSON 数组。
5. 【输出格式】：${outputContract}`
      : `审题与作答准则：
1. 【教材定义溯源】：严格依据中国高校统编教材的标准定义与学科体系作答，切勿使用日常口语或直觉臆测替代专业教材表述。
2. 【限定词与正反核对】：精准锁定题干中的核心限定词（如“基本模式”、“最基本/首要/根本”、“直接/间接”、“属于/不属于”、“正确/错误”）。
3. 【相近干扰项辨析】：遇到相近选项时，必须先对比教材定义边界并明确排除干扰项，切勿盲目锚定第一个看似沾边的选项。
4. 【输出格式】：${outputContract}`;

  const systemContent = `你是一位高效、专业、思维严密的高校答题助教，精通中国高校权威教材（如马工程教材、国家级规划教材、高等教育出版社教材）的标准定义与学科体系。你的思考推理过程将帮助你得出最精准的结论。${typeRule}
${baseGuidelines}`;

  const formattedOptions = options.length
    ? '\n选项列表：\n' + options.map((opt, i) => `${String.fromCharCode(65 + i)}. ${opt}`).join('\n')
    : '';

  const contextPrefix =
    paperContext && paperContext.trim() ? `【试卷上下文】：${paperContext.trim()}\n\n` : '';

  let userTail = '';
  switch (type) {
    case 'single':
    case 'multiple':
    case 'judge':
      userTail =
        '\n\n【作答要求】请先简要说明教材依据，并在最后一行严格输出标准 JSON 数组（仅含选项字母），例如：["B"] 或 ["A", "C"]。';
      break;
    case 'fill':
      userTail =
        '\n\n【作答要求】请在最后一行严格输出标准 JSON 字符串数组，按空位顺序对应填入内容，例如：["答案1", "答案2"]；严禁使用 Markdown 和 LaTeX。';
      break;
    case 'essay':
      userTail =
        '\n\n【作答要求】请以高校优秀考生手写答案口吻直接输出纯文本标准答案正文，聚焦核心采分点，严禁解释性别名括号（如“（又称...）”），严禁使用 Markdown 格式符（如 **、#）和 LaTeX 公式（如 $、\\(），不要输出 JSON 数组。';
      break;
    default:
      userTail = '';
      break;
  }

  const userText = `${contextPrefix}题目：${stem.trim()}${formattedOptions}${userTail}`;

  const userContent: string | ContentPart[] =
    images && images.length > 0
      ? [
          { type: 'text', text: userText },
          ...images.map((url) => ({
            type: 'image_url' as const,
            image_url: { url }
          }))
        ]
      : userText;

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent }
  ];
};
