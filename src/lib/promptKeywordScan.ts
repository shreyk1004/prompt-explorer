export type PromptKeywordHit = {
  filePath: string;
  line: number; // 1-based
  matchLabel: string;
  snippet: string; // small context snippet around the match
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

// Lightweight heuristics for likely system prompt definitions/usages across languages
// Intentionally conservative to reduce noise
const keywordMatchers: Array<{
  label: string;
  test: (line: string) => boolean;
}> = [
  {
    label: "role_system",
    test: (line) => /\brole\b/i.test(line) && /\bsystem\b/i.test(line),
  },
  {
    label: "system_prompt_identifier",
    test: (line) => /\bsystem[_-]?prompt\b/i.test(line),
  },
  {
    label: "system_message_identifier",
    test: (line) => /\bsystem\s*message\b|\bsystemMessage\b/i.test(line),
  },
  {
    label: "messages_role_system_inline",
    test: (line) => /\bmessages?\b/i.test(line) && /\brole\b/i.test(line) && /\bsystem\b/i.test(line),
  },
  {
    label: "system_directive_you_are",
    test: (line) => /\byou are\b/i.test(line) && /\b(system|assistant)\b/i.test(line),
  },
  {
    label: "generic_prompt_with_system",
    test: (line) => /\bprompt\b/i.test(line) && /\bsystem\b/i.test(line),
  },
  {
    label: "common_identifier_variants",
    test: (line) =>
      /(initialSystemPrompt|baseSystemPrompt|systemInstructions|systemSpec)/i.test(line),
  },
];

export function scanTextForPromptKeywords(text: string, filePath: string): PromptKeywordHit[] {
  const hits: PromptKeywordHit[] = [];
  const lines = text.split(/\r?\n/);

  function lineNumberAtIndex(idx: number): number {
    if (idx <= 0) return 1;
    let count = 1;
    for (let i = 0; i < idx; i += 1) {
      if (text.charCodeAt(i) === 10) count += 1; // \n
    }
    return count;
  }

  // Multiline block extractors for full prompt bodies
  const blockPatterns: Array<{ label: string; regex: RegExp; groupIndex: number }> = [
    // JS/TS: system: `...`
    { label: "js_ts_system_template_literal", regex: /\bsystem\s*:\s*`([\s\S]*?)`/g, groupIndex: 1 },
    // JS/TS: { role: "system", ... content: `...` }
    { label: "js_ts_role_system_then_content_template", regex: /role\s*:\s*["']system["'][\s\S]*?content\s*:\s*`([\s\S]*?)`/gi, groupIndex: 1 },
    // JS/TS: { content: `...`, ... role: "system" }
    { label: "js_ts_content_template_then_role_system", regex: /content\s*:\s*`([\s\S]*?)`[\s\S]*?role\s*:\s*["']system["']/gi, groupIndex: 1 },
    // Python-like: system: """ ... """ or system = """ ... """
    { label: "py_system_triple_quoted", regex: /\bsystem\s*[:=]\s*(["']{3})([\s\S]*?)\1/g, groupIndex: 2 },
    // Python-like: role='system', content=""" ... """
    { label: "py_role_system_triple_content", regex: /role\s*=\s*["']system["'][\s\S]*?content\s*=\s*(["']{3})([\s\S]*?)\1/gi, groupIndex: 2 },
    // Python-like reversed order
    { label: "py_content_triple_then_role_system", regex: /content\s*=\s*(["']{3})([\s\S]*?)\1[\s\S]*?role\s*=\s*["']system["']/gi, groupIndex: 2 },
  ];

  const seen = new Set<string>();

  for (const { label, regex, groupIndex } of blockPatterns) {
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text))) {
      const fullIndex = m.index;
      const content = m[groupIndex] || "";
      const line = lineNumberAtIndex(fullIndex);
      const key = `${label}:${line}:${content.slice(0, 50)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ filePath, line, matchLabel: label, snippet: content });
    }
  }

  // Fallback line-based heuristics for smaller hints
  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const lineText = rawLine.toString();
    for (const { label, test } of keywordMatchers) {
      if (test(lineText)) {
        const contextPrev = i > 0 ? lines[i - 1] : "";
        const contextNext = i + 1 < lines.length ? lines[i + 1] : "";
        const snippet = normalizeWhitespace([contextPrev, rawLine, contextNext].filter(Boolean).join(" \n "));
        const key = `${label}:${i + 1}:${snippet.slice(0, 50)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({ filePath, line: i + 1, matchLabel: label, snippet });
        break; // one label per line is enough
      }
    }
  }

  return hits;
}

