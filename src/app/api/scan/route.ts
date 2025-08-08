import { NextRequest } from "next/server";
import { z } from "zod";
import { requireJwtFromRequest } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rateLimit";
import { cloneOrPullRepo } from "@/lib/github";
import { extractPythonPrompts } from "@/lib/extract/pythonExtractor";
import { scanTextForSecrets, type SecretFinding } from "@/lib/secretsScan";
import { scanTextForPromptKeywords, type PromptKeywordHit } from "@/lib/promptKeywordScan";
import { analyzePromptContext } from "@/lib/analyzePrompts";
import { join } from "node:path";
import { promises as fs, existsSync } from "node:fs";
import type { Dirent } from "node:fs";

const bodySchema = z
  .object({
    repoUrl: z
      .string()
      .min(1)
      .refine(
        (url) => /^(https:\/\/|git@).+\.(git)?/.test(url) || /^(https:\/\/github\.com\/)\[\w.-]+\/\[\w.-]+(\.git)?$/.test(url),
        { message: "repoUrl must be a valid Git URL or GitHub HTTPS URL" }
      )
      .optional(),
    localPath: z.string().min(1).optional(),
    branch: z.string().min(1).max(100).optional().default("main"),
    useModel: z.boolean().optional().default(false),
  })
  .refine((v) => Boolean(v.repoUrl || v.localPath), {
    message: "Provide either repoUrl or localPath",
    path: ["repoUrl"],
  });

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "unknown";
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp;
  return "local";
}

async function listAllFiles(root: string, maxFiles = 2000): Promise<string[]> {
  const out: string[] = [];
  const ignore = new Set([".git", "node_modules", "__pycache__", ".next", ".venv", "venv", ".tmp-extractor", "prisma"]);
  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (out.length >= maxFiles) return;
      if (ignore.has(entry.name)) continue;
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(p);
      } else if (entry.isFile()) {
        out.push(p);
      }
    }
  }
  await walk(root);
  return out;
}

type FileTreeNode = {
  name: string;
  path: string;
  type: "dir" | "file";
  children?: FileTreeNode[];
};

async function buildFileTree(root: string, options?: { maxDepth?: number; maxNodes?: number }): Promise<FileTreeNode> {
  const ignoreNames = new Set([".git", "node_modules", "__pycache__", ".next", ".venv", "venv", ".tmp-extractor", "prisma"]);
  const maxDepth = options?.maxDepth ?? 8;
  const maxNodes = options?.maxNodes ?? 5000;
  let nodeCount = 0;

  async function walk(dirPath: string, depth: number): Promise<FileTreeNode> {
    const node: FileTreeNode = { name: dirPath.split("/").pop() || dirPath, path: dirPath, type: "dir", children: [] };
    if (depth > maxDepth || nodeCount >= maxNodes) return node;
    let entries: Dirent[];
    try {
      entries = (await fs.readdir(dirPath, { withFileTypes: true })) as unknown as Dirent[];
    } catch {
      return node;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (nodeCount >= maxNodes) break;
      if (ignoreNames.has(entry.name)) continue;
      const childPath = join(dirPath, entry.name);
      if (childPath.toLowerCase().includes("prisma")) continue;
      if (entry.isDirectory()) {
        node.children?.push(await walk(childPath, depth + 1));
        nodeCount += 1;
      } else if (entry.isFile()) {
        node.children?.push({ name: entry.name, path: childPath, type: "file" });
        nodeCount += 1;
      }
    }
    return node;
  }

  return walk(root, 1);
}

export async function POST(req: NextRequest) {
  // Require JWT
  try {
    requireJwtFromRequest(req as unknown as Request);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return new Response(JSON.stringify({ error: message }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  // Rate limit
  const ip = getClientIp(req);
  const rate = checkRateLimit(ip);
  if (!rate.ok) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(rate.retryAfterSeconds),
      },
    });
  }

  // Validate input
  let body: z.infer<typeof bodySchema>;
  try {
    const json = await req.json();
    body = bodySchema.parse(json);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Invalid request body";
    return new Response(JSON.stringify({ error: "Invalid request body", details: message }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  // Determine target directory: localPath (if provided) or clone repo
  let targetDir: string;
  if (body.localPath) {
    targetDir = body.localPath;
    try {
      const stat = await fs.stat(targetDir);
      if (!stat.isDirectory()) {
        return new Response(JSON.stringify({ error: "localPath must be a directory" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
    } catch {
      return new Response(JSON.stringify({ error: "localPath does not exist" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
  } else if (body.repoUrl) {
    const reposBase = join(process.cwd(), ".data", "repos");
    const repoName = body.repoUrl.split("/").pop()?.replace(/\.git$/, "") || "repo";
    targetDir = join(reposBase, repoName);
    try {
      await fs.mkdir(reposBase, { recursive: true });
    } catch {}
    try {
      await cloneOrPullRepo({ repoUrl: body.repoUrl, destDir: reposBase, branch: body.branch });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return new Response(JSON.stringify({ error: `Failed to clone/pull repo: ${message}` }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    if (!existsSync(targetDir)) {
      return new Response(JSON.stringify({ error: "Repository target path not found after clone" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
  } else {
    return new Response(JSON.stringify({ error: "Provide repoUrl or localPath" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  // Extract prompts (Python first)
  let pythonPrompts = [] as Awaited<ReturnType<typeof extractPythonPrompts>>;
  try {
    pythonPrompts = await extractPythonPrompts(targetDir);
  } catch {
    // Continue; return empty extraction on failure
    pythonPrompts = [];
  }

  // Scan for obvious secrets across files and keyword prompt indicators
  const secretFindings: SecretFinding[] = [];
  const promptKeywordHits: PromptKeywordHit[] = [];
  try {
    const files = await listAllFiles(targetDir, 3000);
    for (const file of files) {
      if (file.toLowerCase().includes("prisma")) continue;
      try {
        const stat = await fs.stat(file);
        if (stat.size > 1024 * 1024) continue; // skip files >1MB
        const content = await fs.readFile(file, "utf8");
        const findings = scanTextForSecrets(content, file);
        if (findings.length) secretFindings.push(...findings.slice(0, 5)); // cap per-file for response brevity
        const promptHits = scanTextForPromptKeywords(content, file);
        if (promptHits.length) promptKeywordHits.push(...promptHits.slice(0, 10));
        if (secretFindings.length > 200) break; // cap overall
      } catch {}
    }
  } catch {}

  // Optional model-based end analysis using combined context
  let modelAnalysis = null as Awaited<ReturnType<typeof analyzePromptContext>> | null;
  if (body.useModel) {
    try {
      modelAnalysis = await analyzePromptContext({
        hits: promptKeywordHits,
        python: pythonPrompts,
        fileTree: await buildFileTree(targetDir, { maxDepth: 4, maxNodes: 1200 }),
      });
    } catch {}
  }

  // Build file tree (lightweight, ignores large/system directories)
  let fileTree: FileTreeNode | null = null;
  try {
    fileTree = await buildFileTree(targetDir, { maxDepth: 8, maxNodes: 5000 });
  } catch {
    fileTree = null;
  }

  return new Response(
    JSON.stringify({
      ok: true,
      repo: { url: body.repoUrl ?? null, branch: body.branch, path: targetDir },
      extracted: { python: pythonPrompts },
      secrets: secretFindings,
      prompts: { keywords: promptKeywordHits, analysis: modelAnalysis },
      fileTree,
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

