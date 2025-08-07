import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { join } from "node:path";

export type PythonPrompt = {
  role: "system" | "user" | "assistant" | "tool" | "unknown";
  text: string;
  filePath: string;
  line: number;
  functionName?: string;
  callSignature?: string;
};

export async function ensurePythonScript(tempDir: string): Promise<string> {
  const scriptPath = join(tempDir, "python_prompt_extractor.py");
  const script = `
import ast
import json
import sys
import os

LLM_CALLEE_NAMES = {
    ("openai", "ChatCompletion", "create"),
    ("openai", "chat", "completions", "create"),
    ("client", "chat", "completions", "create"),
    ("anthropic", "messages", "create"),
    ("llm", "invoke"),
}

class PromptVisitor(ast.NodeVisitor):
    def __init__(self, file_path):
        self.file_path = file_path
        self.results = []
        self.func_stack = []

    def visit_FunctionDef(self, node):
        self.func_stack.append(node.name)
        self.generic_visit(node)
        self.func_stack.pop()

    def visit_AsyncFunctionDef(self, node):
        self.visit_FunctionDef(node)

    def _callee_segments(self, node):
        segs = []
        while isinstance(node, ast.Attribute):
            segs.append(node.attr)
            node = node.value
        if isinstance(node, ast.Name):
            segs.append(node.id)
        segs.reverse()
        return tuple(segs)

    def _extract_string(self, node):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            return node.value
        if isinstance(node, ast.JoinedStr):
            parts = []
            for v in node.values:
                if isinstance(v, ast.Constant) and isinstance(v.value, str):
                    parts.append(v.value)
            return "".join(parts)
        return None

    def _infer_role_from_kw(self, kwarg_name):
        if kwarg_name in ("system", "system_prompt"): return "system"
        if kwarg_name in ("user", "prompt", "input"): return "user"
        if kwarg_name in ("tool", "tools_prompt"): return "tool"
        return "unknown"

    def visit_Call(self, node):
        callee = self._callee_segments(node.func)
        # Look for probable LLM call patterns
        if any(callee[-len(s):] == s for s in LLM_CALLEE_NAMES if len(callee) >= len(s)):
            # kwarg-based
            for kw in node.keywords:
                text = self._extract_string(kw.value)
                if text:
                    self.results.append({
                        "role": self._infer_role_from_kw(kw.arg) if kw.arg else "unknown",
                        "text": text,
                        "filePath": self.file_path,
                        "line": node.lineno,
                        "functionName": self.func_stack[-1] if self.func_stack else None,
                        "callSignature": ".".join(callee),
                    })
            # args-based: look for list/dict with role/text
            for arg in node.args:
                if isinstance(arg, ast.Dict):
                    keys = [k.s if isinstance(k, ast.Constant) else None for k in arg.keys]
                    values = arg.values
                    role = None
                    text = None
                    if keys and "role" in keys and "content" in keys:
                        for k, v in zip(keys, values):
                            if k == "role":
                                if isinstance(v, ast.Constant) and isinstance(v.value, str):
                                    role = v.value
                            if k == "content":
                                text = self._extract_string(v)
                        if text:
                            self.results.append({
                                "role": role or "unknown",
                                "text": text,
                                "filePath": self.file_path,
                                "line": node.lineno,
                                "functionName": self.func_stack[-1] if self.func_stack else None,
                                "callSignature": ".".join(callee),
                            })
                elif isinstance(arg, ast.List):
                    for elt in arg.elts:
                        if isinstance(elt, ast.Dict):
                            keys = [k.s if isinstance(k, ast.Constant) else None for k in elt.keys]
                            values = elt.values
                            role = None
                            text = None
                            if keys and "role" in keys and "content" in keys:
                                for k, v in zip(keys, values):
                                    if k == "role":
                                        if isinstance(v, ast.Constant) and isinstance(v.value, str):
                                            role = v.value
                                    if k == "content":
                                        text = self._extract_string(v)
                                if text:
                                    self.results.append({
                                        "role": role or "unknown",
                                        "text": text,
                                        "filePath": self.file_path,
                                        "line": node.lineno,
                                        "functionName": self.func_stack[-1] if self.func_stack else None,
                                        "callSignature": ".".join(callee),
                                    })
        self.generic_visit(node)


def extract_from_file(file_path):
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            source = f.read()
        tree = ast.parse(source)
        v = PromptVisitor(file_path)
        v.visit(tree)
        return v.results
    except Exception:
        return []


def walk_dir(root):
    results = []
    for dirpath, _, filenames in os.walk(root):
        for name in filenames:
            if name.endswith('.py'):
                path = os.path.join(dirpath, name)
                results.extend(extract_from_file(path))
    return results


def main():
    root = sys.argv[1]
    items = walk_dir(root)
    print(json.dumps(items))


if __name__ == '__main__':
    main()
`;
  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(scriptPath, script, "utf8");
  return scriptPath;
}

export async function extractPythonPrompts(projectRoot: string): Promise<PythonPrompt[]> {
  const tempDir = join(projectRoot, ".tmp-extractor");
  const script = await ensurePythonScript(tempDir);
  return new Promise<PythonPrompt[]>((resolve, reject) => {
    const proc = spawn("python3", [script, projectRoot], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`Extractor failed: ${err}`));
      }
      try {
        const parsed = JSON.parse(out) as PythonPrompt[];
        resolve(parsed);
      } catch (e) {
        reject(e);
      }
    });
  });
}

