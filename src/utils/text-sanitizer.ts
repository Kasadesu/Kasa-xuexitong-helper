/**
 * HTML 转义与富文本答案净化工具模块
 * 专为超星 UEditor 富文本编辑器与高校主观题作答打造
 */

/**
 * 识别 AI 明确声明无法确定答案、缺少图片/结构式/数据等免责声明
 */
export const isAiRefusalOrApology = (text: string): boolean => {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();
  if (!t) return false;
  // 识别 AI 明确声明无法确定答案、缺少图片/结构式/数据等免责声明
  return /(?:无法(?:唯一)?确定(?:答案|其名称|其分类)|无法(?:做出)?解答|无法回答|(?:没有|未)(?:给出|提供|包含).*?(?:结构式|图片|图谱|选项|数据)|请(?:提供|补充).*?(?:结构式|图片|题干)|缺少.*?图片)/i.test(t);
};

/**
 * HTML 基础特殊字符转义（防御 XSS 与 DOM 解析异常）
 */
export const escapeHtml = (text: string): string => {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const LATEX_SYMBOLS: [RegExp, string][] = [
  [/\\alpha(?![a-zA-Z])/g, 'α'],
  [/\\beta(?![a-zA-Z])/g, 'β'],
  [/\\gamma(?![a-zA-Z])/g, 'γ'],
  [/\\delta(?![a-zA-Z])/g, 'δ'],
  [/\\Delta(?![a-zA-Z])/g, 'Δ'],
  [/\\omega(?![a-zA-Z])/g, 'ω'],
  [/\\Omega(?![a-zA-Z])/g, 'Ω'],
  [/\\lambda(?![a-zA-Z])/g, 'λ'],
  [/\\mu(?![a-zA-Z])/g, 'μ'],
  [/\\pi(?![a-zA-Z])/g, 'π'],
  [/\\sigma(?![a-zA-Z])/g, 'σ'],
  [/\\theta(?![a-zA-Z])/g, 'θ'],
  [/\\pm(?![a-zA-Z])/g, '±'],
  [/\\times(?![a-zA-Z])/g, '×'],
  [/\\div(?![a-zA-Z])/g, '÷'],
  [/\\approx(?![a-zA-Z])/g, '≈'],
  [/\\neq(?![a-zA-Z])/g, '≠'],
  [/\\leq(?![a-zA-Z])/g, '≤'],
  [/\\geq(?![a-zA-Z])/g, '≥'],
  [/\\(?:rightarrow|to)(?![a-zA-Z])/g, '→'],
  [/\\(?:degree|\^\\circ|\^\{\\circ\})(?![a-zA-Z])/g, '°'],
  [/\^\\circ(?![a-zA-Z])/g, '°'],
  [/\^\{\\circ\}/g, '°']
];

/**
 * 净化 AI 输出的主观题答案，剥离 LaTeX 标记与 Markdown 符号，还原为人类教材阅读文本
 */
export const cleanRichTextAnswer = (text: string): string => {
  if (!text || typeof text !== 'string') return '';

  let res = text;

  // 1. 还原 LaTeX 希腊字母与常用数学/化学符号
  for (const [pattern, replacement] of LATEX_SYMBOLS) {
    res = res.replace(pattern, replacement);
  }

  // 2. 循环解包宏与上下标花括号（最多 3 轮循环），使得 \mathrm{H_{2}O} 先解内层 _{2} 变成 \mathrm{H2O} 后，外层 \mathrm{} 也能安全解包
  for (let round = 0; round < 3; round++) {
    const prev = res;
    // 解包上下标花括号：^{13} -> 13, _{2} -> 2
    res = res.replace(/[\^_]\{([^{}]*)\}/g, '$1');
    // 解包常见 LaTeX 字体宏（如 \mathrm{...}, \mathbf{...}, \textbf{...}, \textit{...}, \text{...}）
    res = res.replace(/\\(?:mathrm|mathbf|textbf|textit|text|textrm|textsf)\{([^{}]*)\}/g, '$1');
    if (res === prev) break;
  }
  // 单字符上下标简化：^2 -> 2, _2 -> 2
  res = res.replace(/[\^_]([0-9a-zA-Z])/g, '$1');

  // 3. 剥离 LaTeX 定界符 \( \) \[ \] $$ $
  res = res.replace(/\\\([ \t]*/g, '');
  res = res.replace(/[ \t]*\\\)/g, '');
  res = res.replace(/\\\[[ \t]*/g, '');
  res = res.replace(/[ \t]*\\\]/g, '');
  res = res.replace(/\$\$([^\$]+)\$\$/g, '$1');
  // 行内公式定界符：只解包不含汉字且内部首尾非空白的真实成对公式，保留经济金融题中的货币符号（如 "$100 每件，预计亏损 $50"）
  res = res.replace(/\$(?!\s)([^\$\n\u4e00-\u9fa5]+?)(?<!\s)\$/g, '$1');
  // 注意：美元符号只针对成对公式进行解包，不无差别全局删除单个 $，保留经济金融题中的 $100

  // 4. 剥离行内 Markdown 标记：`code`、***bold-italic***、**bold**、__bold__、*italic*
  res = res.replace(/`([^`]+)`/g, '$1');
  res = res.replace(/\*\*\*([^*]+)\*\*\*/g, '$1');
  res = res.replace(/\*\*([^*]+)\*\*/g, '$1');
  res = res.replace(/__([^_]+)__/g, '$1');
  // Markdown 斜体：只匹配内部首尾非空白的成对星号 *text*，且两端不能是数字乘号语境（如 2 * 3 = 6 不受影响）
  res = res.replace(/(?<=^|[\s\u4e00-\u9fa5，。；、？！\(\)（）\[\]])\*([^*\n\s](?:[^*\n]*[^*\n\s])?)\*(?=[\s\u4e00-\u9fa5，。；、？！\(\)（）\[\]]|$)/g, '$1');
  // 额外支持两端带空白或首尾的 Markdown 斜体
  res = res.replace(/(?:^|\s)\*([^*\n\s]+)\*(?=\s|$)/g, (match, p1) => {
    const prefixSpace = match.startsWith(' ') ? ' ' : '';
    return `${prefixSpace}${p1}`;
  });

  // 5. 剥离生硬冗余的别名/释义括号补丁（例如“（又称...）”、“（亦称...）”、“（即...）”、“（俗称...）”）
  res = res.replace(/[（\(](?:又称|亦称|即|俗称)[^）\)]*[）\)]/g, '');

  // 6. 剥离整段回答开头的“答：”、“答案：”、“参考答案：”、“标准答案：”、“解答：”、“解：”（含带方括号形式或单独成行）
  res = res.replace(/^\s*(?:【?(?:(?:标准|参考)?答案|解答|答|解)】?)\s*(?:[:：]\s*|\r?\n+)/, '');

  // 7. 按行处理：移除行首 Markdown 标题 (# ## 等)、引用 (>) 以及行首多余答案标签
  const lines = res.split(/\r?\n/).map((line) => {
    let l = line.trim();
    l = l.replace(/^#{1,6}\s+/, '');
    l = l.replace(/^>\s+/, '');
    l = l.replace(/^(?:【?(?:(?:标准|参考)?答案|解答|答|解)】?)\s*[:：]\s*/, '');
    return l;
  });

  return lines.join('\n').trim();
};

/**
 * 将 AI 生成的主观题纯文本答案格式化为符合超星 UEditor 规范的 <p>...</p> 段落 HTML
 */
export const formatToUEditorParagraphs = (content: string | string[]): string => {
  if (!content) return '<p></p>';

  const rawLines: string[] = Array.isArray(content)
    ? content.flatMap((item) => (item ? String(item).split(/\r?\n/) : []))
    : String(content).split(/\r?\n/);

  const cleanParagraphs = rawLines
    .map((line) => cleanRichTextAnswer(line).trim())
    .filter((line) => line.length > 0)
    .map((line) => `<p>${escapeHtml(line)}</p>`);

  return cleanParagraphs.length > 0 ? cleanParagraphs.join('') : '<p></p>';
};
