import { NextRequest } from "next/server";
import { z } from "zod";
import { requireJwtFromRequest } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rateLimit";
import { cloneOrPullRepo } from "@/lib/github";
import { extractPythonPrompts } from "@/lib/extract/pythonExtractor";
import { scanTextForSecrets, type SecretFinding } from "@/lib/secretsScan";
import { join } from "node:path";
import { promises as fs, existsSync } from "node:fs";

const bodySchema = z
  .object({
    repoUrl: z
      .string()
      .min(1)
      .refine(
        (url) => /^(https:\/\/|git@).+\.(git)?/.test(url) || /^(https:\/\/github\.com\/)[\w.-]+\/[\w.-]+(\.git)?$/.test(url),
        { message: "repoUrl must be a valid Git URL or GitHub HTTPS URL" }
      )
      .optional(),
    localPath: z.string().min(1).optional(),
    branch: z.string().min(1).max(100).optional().default("main"),
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
  const ignore = new Set([".git", "node_modules", "__pycache__", ".next", ".venv", "venv", ".tmp-extractor"]);
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

  // Scan for obvious secrets across files
  const secretFindings: SecretFinding[] = [];
  try {
    const files = await listAllFiles(targetDir, 3000);
    for (const file of files) {
      try {
        const stat = await fs.stat(file);
        if (stat.size > 1024 * 1024) continue; // skip files >1MB
        const content = await fs.readFile(file, "utf8");
        const findings = scanTextForSecrets(content, file);
        if (findings.length) secretFindings.push(...findings.slice(0, 5)); // cap per-file for response brevity
        if (secretFindings.length > 200) break; // cap overall
      } catch {}
    }
  } catch {}

  return new Response(
    JSON.stringify({
      ok: true,
      repo: { url: body.repoUrl ?? null, branch: body.branch, path: targetDir },
      extracted: {
        python: pythonPrompts,
      },
      secrets: secretFindings,
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

