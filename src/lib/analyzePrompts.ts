import type { PromptKeywordHit } from "@/lib/promptKeywordScan";
import type { PythonPrompt } from "@/lib/extract/pythonExtractor";

export type PromptModelAnalysis = {
  summary: string;
  logic?: string;
  files: Array<{
    filePath: string;
    count: number;
    reasoning?: string;
  }>;
  redundancies?: Array<{ filePath: string; description: string }>;
};

type FileTreeNodeLite = {
  name: string;
  path: string;
  type: "dir" | "file";
  children?: FileTreeNodeLite[];
};

function flattenFileTree(root: FileTreeNodeLite | null, maxDepth = 3, maxItems = 400): string[] {
  if (!root) return [];
  const out: string[] = [];
  function walk(n: FileTreeNodeLite, depth: number) {
    if (out.length >= maxItems) return;
    out.push(n.path);
    if (depth >= maxDepth) return;
    if (n.type === "dir" && n.children) {
      for (const c of n.children) {
        if (out.length >= maxItems) break;
        walk(c, depth + 1);
      }
    }
  }
  walk(root, 0);
  return out;
}

export async function analyzePromptContext(input: {
  hits: PromptKeywordHit[];
  python: PythonPrompt[];
  fileTree: FileTreeNodeLite | null;
}): Promise<PromptModelAnalysis | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const hits = input.hits.slice(0, 200).map((h) => ({
    filePath: h.filePath,
    line: h.line,
    label: h.matchLabel,
    snippet: h.snippet.slice(0, 400),
  }));
  const python = (input.python || []).slice(0, 150).map((p) => ({
    role: p.role,
    text: (p.text || "").slice(0, 500),
    filePath: p.filePath,
    line: p.line,
    functionName: p.functionName || null,
    callSignature: p.callSignature || null,
  }));
  const filePaths = flattenFileTree(input.fileTree, 3, 400);

  const system = [
    "You are a senior code analyst.",
    "Given prompt artifacts and a file tree, synthesize a concise explanation of how prompts are used across the codebase.",
    "Focus on: (1) overall prompt flow/logic, (2) where prompts are defined/assembled, (3) how messages compose together, (4) redundancies or duplicates.",
    "Be conservative; do not hallucinate. Base claims on provided snippets and paths.",
    "Respond as JSON with keys: {summary: string, logic: string, files: [{filePath, count, reasoning?}], redundancies: [{filePath, description}]}.",
  ].join(" ");

  const user = `CONTEXT:\n- FILE_PATHS_SAMPLE: ${JSON.stringify(filePaths)}\n- PROMPT_HITS: ${JSON.stringify(hits)}\n- PYTHON_PROMPTS: ${JSON.stringify(python)}\n`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.1,
      }),
    });
    const data = await res.json();
    const content: string | undefined = data?.choices?.[0]?.message?.content;
    if (!content) return null;
    let jsonText = content;
    const firstBrace = content.indexOf("{");
    const lastBrace = content.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1) {
      jsonText = content.slice(firstBrace, lastBrace + 1);
    }
    const parsed = JSON.parse(jsonText) as PromptModelAnalysis;
    if (!parsed?.summary || !Array.isArray(parsed?.files)) return null;
    return parsed;
  } catch {
    return null;
  }
}

