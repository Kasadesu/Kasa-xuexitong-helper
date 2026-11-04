/**
 * Extracts and sanitizes answer string array from raw AI completion output
 */
export const parseAiResponse = (rawText: string): string[] => {
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
      if (items.length > 0) return items;
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
            return items;
          }
        }
      } catch {
        // try earlier match
      }
    }
  }

  // 5. Semantic extraction for affirmative/negative judgment answers (checked BEFORE letter extraction
  // so words like "true" or "false" are never split into ['F','A','L','S','E'])
  const judgeRegex =
    /(?:最终答案|正确答案|答案|故选|应选|因此选|所以选|选择|结论|判断)\s*(?:是|为)?\s*[:：]?\s*[【\(\["']?\s*(正确|错误|对|错|true|false|√|×)(?![a-zA-Z])\s*[】\)\]"']?/gi;
  const judgeMatches = Array.from(cleaned.matchAll(judgeRegex));
  if (judgeMatches.length > 0) {
    const lastJudge = judgeMatches[judgeMatches.length - 1][1];
    if (lastJudge) {
      return [lastJudge];
    }
  }

  // 6. Semantic regular expression extraction for option letters from the LAST conclusion phrase
  // Excludes negated contexts (不选/误选/排除) and noun phrase "选项X", and prevents matching English words via (?![a-zA-Z])
  const semanticRegex =
    /(?:最终答案|正确答案|答案|故选|应选|因此选|所以选|本题选|选择|(?<![不勿别误排])选(?!项))\s*(?:是|为)?\s*[:：]?\s*[【\(\[]?\s*([A-H](?:[\s,，、和与/]+[A-H])*)(?![a-zA-Z])/gi;
  const semanticMatches = Array.from(cleaned.matchAll(semanticRegex));
  if (semanticMatches.length > 0) {
    const lastCapture = semanticMatches[semanticMatches.length - 1][1];
    const letters = lastCapture.match(/[A-H]/gi);
    if (letters && letters.length > 0) {
      return Array.from(new Set(letters.map((l) => l.toUpperCase())));
    }
  }

  // 7. Last resort: split by newlines
  const lines = cleaned.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  return lines.length ? lines : (cleaned ? [cleaned] : []);
};
