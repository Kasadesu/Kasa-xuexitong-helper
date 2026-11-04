import { QuestionType } from '../../types';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export const buildAiPrompt = (
  type: QuestionType,
  stem: string,
  options: string[],
  paperContext?: string
): ChatMessage[] => {
  let rule = '';
  switch (type) {
    case 'judge':
      rule = '这是判断题。答案必须是“对”或“错”，亦可直接使用字母标号（A 代表对/正确，B 代表错/错误）。';
      break;
    case 'single':
      rule = '这是单选题。请给出唯一正确选项的字母标号（如 A、B、C 或 D）。可直接返回字母或字母+选项文本（如 ["B"] 或 ["B. 选项文本"]）。';
      break;
    case 'multiple':
      rule = '这是多选题。请逐一核验每个选项，给出所有正确选项的字母标号数组（如 ["A", "C"] 或 ["A. 选项1", "C. 选项2"]）。';
      break;
    case 'fill':
      rule = '这是填空题。按题目中各个空格先后顺序给出教材标准答案，每个空对应返回数组里的一个字符串元素。';
      break;
    case 'essay':
      rule = '这是主观简答题。请直接给出准确、精炼的教材核心答案正文。';
      break;
    default:
      rule = '请根据题目内容直接给出准确答案。';
      break;
  }

  const systemContent = `你是一位高效、专业、思维严密的高校答题助教，精通中国高校权威教材（如马工程教材、国家级规划教材、高等教育出版社教材）的标准定义与学科体系。你的思考推理过程将帮助你得出最精准的结论。${rule}
审题与作答准则：
1. 【教材定义溯源】：严格依据中国高校统编教材的标准定义与原话表述作答，切勿用日常口语或直觉臆测替代教材专有名词定义（例如：严格区分“分销渠道（取得所有权或帮助所有权转移）”与“市场营销渠道”、“愿望竞争者/属类竞争者（平行或一般竞争者，如不同交通工具满足同一出行愿望）/产品形式竞争者/品牌竞争者”、“核心产品/形式产品/延伸产品”、“导入期（知晓了解）/成长期（品牌偏爱）/成熟期（提醒维持）”等高校经典考点）。
2. 【限定词与正反核对】：精准锁定题干中的核心限定词（如“基本模式”、“最基本/首要/根本”、“直接/间接”、“属于/不属于”、“正确/错误”）。
3. 【相近干扰项辨析】：遇到相近选项时，必须先对比二者的教材定义边界并明确排除干扰项，切勿盲目锚定第一个看似沾边的选项。
4. 【输出格式】：请先用 1~2 句话简要陈述教材依据与选项辨析，最后一行务必输出标准 JSON 数组包含你的最终答案项，例如：["B"] 或 ["A", "C"]。`;

  const formattedOptions = options.length
    ? '\n选项列表：\n' + options.map((opt, i) => `${String.fromCharCode(65 + i)}. ${opt}`).join('\n')
    : '';

  const contextPrefix = paperContext && paperContext.trim()
    ? `【试卷上下文】：${paperContext.trim()}\n\n`
    : '';

  const userContent = `${contextPrefix}题目：${stem.trim()}${formattedOptions}`;

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent }
  ];
};
