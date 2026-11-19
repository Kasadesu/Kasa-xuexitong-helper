import { QuestionType } from '../../types';

const expandOptionTokens = (items: string[], questionType?: QuestionType): string[] => {
  if (questionType === 'multiple') {
    const result: string[] = [];
    const addUnique = (val: string) => {
      if (!result.includes(val)) result.push(val);
    };
    for (const rawItem of items) {
      const item = String(rawItem).trim();
      if (!item) continue;
      if (/^[A-H]{2,8}$/.test(item)) {
        for (const ch of item) {
          addUnique(ch);
        }
        continue;
      }
      const parts = item
        .split(/[,，、/\s;；|和与]+/)
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length >= 2 && parts.every((p) => /^[A-H]$/i.test(p))) {
        for (const p of parts) {
          addUnique(p.toUpperCase());
        }
        continue;
      }
      addUnique(/^[a-h]$/i.test(item) ? item.toUpperCase() : item);
    }
    return result;
  }

  const cleanItems = items.map((x) => String(x).trim()).filter(Boolean);
  if (questionType === 'single' && cleanItems.length > 1 && cleanItems.every((x) => /^[A-H]$/i.test(x))) {
    return [cleanItems[0].toUpperCase()];
  }
  return cleanItems;
};

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
        return expandOptionTokens(items, questionType);
      }
    }
    if (typeof parsed === 'string') {
      const trimmed = parsed.trim();
      return trimmed ? expandOptionTokens([trimmed], questionType) : [];
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
            return expandOptionTokens(items, questionType);
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

  // 4b. Tolerate single-quoted arrays (e.g. ['A', 'B', 'D'])
  const singleQuoteArrayMatches = cleaned.match(/\[\s*(?:'(?:\\.|[^'\\])*'(?:\s*,\s*)?)+\]/g);
  if (singleQuoteArrayMatches && singleQuoteArrayMatches.length > 0) {
    for (let i = singleQuoteArrayMatches.length - 1; i >= 0; i--) {
      const items = Array.from(singleQuoteArrayMatches[i].matchAll(/'((?:\\.|[^'\\])*)'/g))
        .map((m) => m[1].replace(/\\'/g, "'").trim())
        .filter(Boolean);
      if (items.length > 0) {
        return expandOptionTokens(items, questionType);
      }
    }
  }

  // 4c. Tolerate unquoted bare letter list arrays (e.g. [A, B, D] or [A、B、D]) without matching [答案: **D**, 解析: ...]
  const bareLetterArrayMatches = cleaned.match(/\[\s*[A-H](?:\s*[,，、/]\s*[A-H])+\s*\]/gi);
  if (bareLetterArrayMatches && bareLetterArrayMatches.length > 0) {
    const lastBare = bareLetterArrayMatches[bareLetterArrayMatches.length - 1];
    const items = lastBare
      .slice(1, -1)
      .split(/[,，、/]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (items.length > 0) {
      return expandOptionTokens(items, questionType);
    }
  }

  // 5. Semantic extraction for affirmative/negative judgment answers (checked BEFORE letter extraction
  // so words like "true" or "false" are never split into ['F','A','L','S','E'])
  const judgeRegex =
    /(?:最终答案|正确答案|标准答案|参考答案|答案|故选|应选|因此选|所以选|选择|结论|判断)(?:[\s*_`]{0,6}(?:是|为))?(?:[\s*_`]{0,4}[:：])?[\s*_`【\(\["'“]{0,16}(正确|错误|对|错|true|false|√|×)(?![a-zA-Z])/gi;
  const judgeMatches = Array.from(cleaned.matchAll(judgeRegex));
  if (judgeMatches.length > 0) {
    const lastJudge = judgeMatches[judgeMatches.length - 1][1];
    if (lastJudge) {
      return [lastJudge];
    }
  }

  // 6. Semantic regular expression extraction with two-tier priority: Strong conclusions > Weak conclusions
  const NEGATED_SEL = '(?<![不勿别误排错漏少未忌])(?<!不能|不应|切忌|不可|不宜|不要|严禁|禁止|错误)';
  const STRONG_PREFIX = '(?:最终答案|正确答案|标准答案|参考答案|答案|结论|本题选)';
  const WEAK_PREFIX = `(?:故选|(?<![不勿别])应选|因此选|所以选|${NEGATED_SEL}选择|${NEGATED_SEL}选(?!项))`;

  const extractLetters = (prefixPattern: string): string[] | null => {
    // 严格限制选项字母 [A-H]：
    // 1. 严禁使用单纯的 \b 单词边界（因为汉字在 JS 正则中属于 \W，如 "B族" 之间的边界会被 \b 误判为词尾）
    // 2. 排除紧随其后的连字符与常见化学/药学/学术后缀汉字：(?![a-zA-Z\-型族环链层级])
    const prefixSep =
      '(?:[\\s*_\\u0060【】]{0,4}(?:是|为))?[*_\\u0060【】]{0,4}(?:[:：][\\s\\r\\n]{0,8}|[\\s\\r\\n]{1,8}|(?=[*_\\u0060【\\(\\[“"\'A-H]))';
    const letterAtom = '[A-H](?![a-zA-Z\\-型族环链层级])';
    const itemOpen = '[*_\\u0060【\\(\\[“"\']{0,6}';
    const itemText =
      '(?:[*_\\u0060]{0,4}[\\.．:：](?:[^\\n。!！?？,，;；\\]】]|[,，](?![ \\t]{0,4}[*_\\u0060【\\(\\[“"\']{0,4}[A-H](?![a-zA-Z\\-型族环链层级])[*_\\u0060]{0,4}[\\.．:：]))+|[ \\t]{0,3}项|[*_\\u0060]{0,4}[（\\(][^（）\\(\\)\\n。!！?？]{1,60}[）\\)])?';
    const itemClose = '[*_\\u0060】\\)\\]"\'”]{0,6}';
    const itemPattern = `${itemOpen}${letterAtom}${itemText}${itemClose}`;
    const itemSep = '(?:[ \\t]{0,4}[,，、;；和与/][ \\t\\r\\n]{0,6}|[ \\t]{0,4}\\r?\\n[ \\t]{0,4}|[ \\t]{1,6})';

    const pattern = new RegExp(
      `${prefixPattern}${prefixSep}(${itemPattern}(?:${itemSep}${itemPattern})*)`,
      'g'
    );
    const singleMatches = Array.from(cleaned.matchAll(pattern));
    const lastSingleMatch = singleMatches.length > 0 ? singleMatches[singleMatches.length - 1] : null;

    // 多选题额外支持严格大写连续字母格式（如 "答案：ABD" / "**正确答案**：ABCD"），不加 'i' 标志以杜绝小写单词 "each"/"bad"/"head" 误伤
    let lastCompactMatch: RegExpMatchArray | null = null;
    if (questionType === 'multiple') {
      const compactAtom = '[A-H]{2,8}(?![a-zA-Z\\-型族环链层级])';
      const compactItem = `${itemOpen}${compactAtom}${itemClose}`;
      const compactPattern = new RegExp(
        `${prefixPattern}${prefixSep}(${compactItem}(?:${itemSep}${compactItem})*)`,
        'g'
      );
      const compactMatches = Array.from(cleaned.matchAll(compactPattern));
      if (compactMatches.length > 0) {
        lastCompactMatch = compactMatches[compactMatches.length - 1];
      }
    }

    const singleIdx = lastSingleMatch?.index ?? -1;
    const compactIdx = lastCompactMatch?.index ?? -1;

    if (compactIdx > singleIdx && lastCompactMatch?.[1]) {
      const compactLetters: string[] = [];
      const tokenMatches = Array.from(
        lastCompactMatch[1].matchAll(/([A-H]{2,8})(?![a-zA-Z\-型族环链层级])/g)
      );
      for (const tm of tokenMatches) {
        for (const ch of tm[1]) {
          if (!compactLetters.includes(ch)) {
            compactLetters.push(ch);
          }
        }
      }
      if (compactLetters.length > 0) {
        return compactLetters;
      }
    }

    if (!lastSingleMatch) return null;
    const lastCapture = lastSingleMatch[1];
    if (!lastCapture) return null;

    // 1. 若包含点号/全角点号/冒号等选项标号格式（例如 "A."、"A．"、"A："），提取紧跟合规选项分隔符的字母（排除句末句号 "。" 误判）
    const hasExplicitOptionMarker = /[\.．:：]/.test(lastCapture);
    if (hasExplicitOptionMarker) {
      const dotMatches = Array.from(
        lastCapture.matchAll(
          /(?:^|[,，、;；和与/\s]+)[*_\u0060【\(\[“"'\s]*([A-H])(?![a-zA-Z\-型族环链层级])[*_\u0060]*[\.．:：]/g
        )
      );
      if (dotMatches.length > 0) {
        const letters = Array.from(new Set(dotMatches.map((m) => m[1].toUpperCase())));
        if (questionType === 'single' && letters.length > 1) {
          return [letters[0]];
        }
        return letters;
      }
    }

    // 2. 提取被明确加粗/定界符/标点分隔的独立选项字母（例如 **A**、**C** 或 A, B 或 A（...）、B（...）或 A 项、B 项）
    const standaloneMatches = Array.from(
      lastCapture.matchAll(
        /(?<=^|[,，、;；和与/\s*_\u0060【\(\[“"'])([A-H])(?![a-zA-Z\-型族环链层级])(?=[*_\u0060】\)\]"'”，,、;；和与/\s（\(项]|$)/g
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
