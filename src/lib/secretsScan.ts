export type SecretFinding = {
  match: string;
  filePath: string;
  line: number;
};

// Simple regexes to flag obvious tokens/URLs. This is a heuristic pre-scan.
const patterns: { name: string; regex: RegExp }[] = [
  { name: "openai_key", regex: /sk-[A-Za-z0-9]{20,}/g },
  { name: "bearer_token", regex: /Bearer\s+[A-Za-z0-9\-_\.]+/g },
  { name: "url_private", regex: /https?:\/\/[\w.-]+\.[\w.-]+\/.+\/(?:token|key|secret)[^\s"']*/gi },
];

export function scanTextForSecrets(text: string, filePath: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const lineText = lines[i];
    for (const { regex } of patterns) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(lineText))) {
        findings.push({ match: match[0], filePath, line: i + 1 });
      }
    }
  }
  return findings;
}

