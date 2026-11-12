import { QuestionType } from '../../types';

/**
 * Extracts and sanitizes answer string array from raw AI completion output
 */
export const parseAiResponse = (rawText: string, questionType?: QuestionType): string[] => {
  if (!rawText || typeof rawText !== 'string' || !rawText.trim()) return [];

  // 1. Strip internal reasoning chain tag <think>...</think> (e.g. DeepSeek-R1 / QwQ / V4)
  let cleaned = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!cleaned) {
    // Defensive: if stripping completely emptied the response (e.g. truncated without closing tag), strip the tag markers only
    cleaned = rawText.replace(/<\/?think>/gi, '').trim();
  }
  if (!cleaned) return [];

  // 2. Strip markdown code fences if whole response is wrapped
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  if (!cleaned) return [];

  // 3. Try direct JSON parsing first
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      const items = parsed.map((item) => String(item).trim()).filter(Boolean);
      if (items.length > 0) {
        if (questionType === 'single' && items.length > 1 && items.every((x) => /^[A-H]$/i.test(x))) {
          return [items[0].toUpperCase()];
        }
        return items;
      }
    }
    if (typeof parsed === 'string') {
      const trimmed = parsed.trim();
      return trimmed ? [trimmed] : [];
    }
  } catch {
    // Fallback to pattern extraction below
  }

  // 4. Match ALL bracketed JSON array patterns and take the LAST valid one
  // (Since reasoning/analysis precedes the final conclusion at the end of the output)
  const arrayMatches = cleaned.match(/\[\s*(?:"(?:\\.|[^"\\])*"(?:\s*,\s*)?)+\]/g);
  if (arrayMatches && arrayMatches.length > 0) {
    for (let i = arrayMatches.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(arrayMatches[i]);
        if (Array.isArray(parsed)) {
          const items = parsed.map((item) => String(item).trim()).filter(Boolean);
          if (items.length > 0) {
            if (questionType === 'single' && items.length > 1 && items.every((x) => /^[A-H]$/i.test(x))) {
              return [items[0].toUpperCase()];
            }
            return items;
          }
        }
      } catch {
        // try earlier match
      }
    }
  }

  // Special branch for Subjective Essay / Definition questions:
  // If not standard JSON array, return the whole cleaned text directly.
  // Never strip to single letters, never chop paragraphs into fragmented pieces!
  if (questionType === 'essay') {
    return [cleaned];
  }

  // 5. Semantic extraction for affirmative/negative judgment answers (checked BEFORE letter extraction
  // so words like "true" or "false" are never split into ['F','A','L','S','E'])
  const judgeRegex =
    /(?:最终答案|正确答案|标准答案|参考答案|答案|故选|应选|因此选|所以选|选择|结论|判断)\s*(?:是|为)?\s*[:：]?\s*[\*\_`【\(\["'“\s]*\s*(正确|错误|对|错|true|false|√|×)(?![a-zA-Z])\s*[\*\_`】\)\]"'”\s]*/gi;
  const judgeMatches = Array.from(cleaned.matchAll(judgeRegex));
  if (judgeMatches.length > 0) {
    const lastJudge = judgeMatches[judgeMatches.length - 1][1];
    if (lastJudge) {
      return [lastJudge];
    }
  }

  // 6. Semantic regular expression extraction with two-tier priority: Strong conclusions > Weak conclusions
  const STRONG_PREFIX = '(?:最终答案|正确答案|标准答案|参考答案|答案|结论|本题选)';
  const WEAK_PREFIX = '(?:故选|应选|因此选|所以选|选择|(?<![不勿别误排])选(?!项))';

  const extractLetters = (prefixPattern: string): string[] | null => {
    // 严格限制选项字母 [A-H]：
    // 1. 严禁使用单纯的 \b 单词边界（因为汉字在 JS 正则中属于 \W，如 "B族" 之间的边界会被 \b 误判为词尾）
    // 2. 排除紧随其后的连字符与常见化学/药学/学术后缀汉字：(?![a-zA-Z\-型族环链层级])
    const pattern = new RegExp(
      `${prefixPattern}\\s*(?:是|为)?\\s*[:：]?\\s*([*_\\u0060【\\(\\[“"'\\s]*` +
        `[A-H](?![a-zA-Z\\-型族环链层级])(?:(?:[\\.。．:：][^\\n,，；\\]】]+)|(?:[*_\\u0060】\\)\\]"'”\\s]*[,，、和与/\\s]+[*_\\u0060【\\(\\[“"'\\s]*` +
        `[A-H](?![a-zA-Z\\-型族环链层级])(?:[\\.。．:：][^\\n,，；\\]】]+)?)*)[*_\\u0060】\\)\\]"'”\\s]*)`,
      'gi'
    );
    const matches = Array.from(cleaned.matchAll(pattern));
    if (!matches || matches.length === 0) return null;

    const lastCapture = matches[matches.length - 1][1];
    if (!lastCapture) return null;

    // 1. 若包含点号/顿号/冒号等选项标号格式（例如 "A."、"A、"、"A．"），提取紧跟合规选项分隔符的字母
    const hasExplicitOptionMarker = /[\.。．:：]/.test(lastCapture);
    if (hasExplicitOptionMarker) {
      const dotMatches = Array.from(
        lastCapture.matchAll(/(?:^|[,，、和与/\s]+)[*_\u0060【\(\[“"'\s]*([A-H])(?![a-zA-Z\-型族环链层级])[\.。．:：]/gi)
      );
      if (dotMatches.length > 0) {
        const letters = Array.from(new Set(dotMatches.map((m) => m[1].toUpperCase())));
        if (questionType === 'single' && letters.length > 1) {
          return [letters[0]];
        }
        return letters;
      }
    }

    // 2. 提取被明确加粗/定界符/标点分隔的独立选项字母（例如 **A**、**C** 或 A, B 或 A）
    const standaloneMatches = Array.from(
      lastCapture.matchAll(
        /(?:^|[,，、和与/\s*_\u0060【\(\[“"'])*([A-H])(?![a-zA-Z\-型族环链层级])(?=[*_\u0060】\)\]"'”，,、和与/\s]|$)/gi
      )
    );
    const validLetters = Array.from(
      new Set(
        standaloneMatches
          .map((m) => m[1]?.toUpperCase())
          .filter(Boolean)
      )
    );

    if (validLetters.length > 0) {
      if (questionType === 'single' && validLetters.length > 1) {
        return [validLetters[0]];
      }
      return validLetters;
    }

    return null;
  };

  // Tier 1: Strong conclusion prefix matches
  const strongResult = extractLetters(STRONG_PREFIX);
  if (strongResult && strongResult.length > 0) {
    return strongResult;
  }

  // Tier 2: Weak conclusion prefix matches
  const weakResult = extractLetters(WEAK_PREFIX);
  if (weakResult && weakResult.length > 0) {
    return weakResult;
  }

  // 7. Last resort: split by newlines
  const lines = cleaned.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  return lines.length ? lines : (cleaned ? [cleaned] : []);
};
