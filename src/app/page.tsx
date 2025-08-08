"use client";

import { useMemo, useState } from "react";

type FileTreeNode = {
  name: string;
  path: string;
  type: "dir" | "file";
  children?: FileTreeNode[];
};

type ScanResponse = {
  ok: boolean;
  repo: { url: string | null; branch: string; path: string };
  extracted: { python: Array<Record<string, unknown>> };
  secrets: Array<{ match: string; filePath: string; line: number }>;
  prompts?: {
    keywords?: Array<{ filePath: string; line: number; matchLabel: string; snippet: string }>;
    analysis?: { summary: string; files: Array<{ filePath: string; count: number; reasoning?: string }> } | null;
  };
  fileTree?: FileTreeNode | null;
};

function TreeNode({ node, level, expanded, toggle }: {
  node: FileTreeNode;
  level: number;
  expanded: (path: string) => boolean;
  toggle: (path: string) => void;
}) {
  const isDir = node.type === "dir";
  const isExpanded = expanded(node.path);
  const paddingLeft = 8 + level * 16;
  return (
    <div>
      <div
        className="flex items-center gap-2 cursor-pointer select-none hover:bg-gray-50 rounded px-2 py-1"
        style={{ paddingLeft }}
        onClick={() => isDir && toggle(node.path)}
      >
        {isDir ? (
          <span className={`inline-block transition-transform text-gray-500 ${isExpanded ? "rotate-90" : "rotate-0"}`}>
            ▶
          </span>
        ) : (
          <span className="inline-block text-transparent">▶</span>
        )}
        <span className={isDir ? "font-medium text-gray-800" : "text-gray-700"}>{node.name}</span>
        {isDir && node.children && node.children.length > 0 && (
          <span className="text-xs text-gray-400">({node.children.length})</span>
        )}
      </div>
      {isDir && isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeNode key={child.path} node={child} level={level + 1} expanded={expanded} toggle={toggle} />
          ))}
        </div>
      )}
    </div>
  );
}

function FileTree({ root }: { root: FileTreeNode }) {
  const [openSet, setOpenSet] = useState<Set<string>>(() => new Set([root.path]));
  const expanded = (path: string) => openSet.has(path);
  const toggle = (path: string) => {
    setOpenSet((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  const expandAll = () => {
    const collect = (n: FileTreeNode, acc: Set<string>) => {
      if (n.type === "dir") acc.add(n.path);
      if (n.children) n.children.forEach((c) => collect(c, acc));
    };
    const acc = new Set<string>();
    collect(root, acc);
    setOpenSet(acc);
  };

  const collapseAll = () => setOpenSet(new Set([root.path]));

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium text-gray-800 truncate">{root.name}</div>
        <div className="flex items-center gap-2">
          <button className="text-xs bg-gray-100 text-gray-700 rounded px-2 py-1 hover:bg-gray-200" onClick={expandAll}>Expand All</button>
          <button className="text-xs bg-gray-100 text-gray-700 rounded px-2 py-1 hover:bg-gray-200" onClick={collapseAll}>Collapse All</button>
        </div>
      </div>
      <div className="text-sm">
        <TreeNode node={root} level={0} expanded={expanded} toggle={toggle} />
      </div>
    </div>
  );
}

export default function Home() {
  const [repoUrl, setRepoUrl] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [branch, setBranch] = useState("main");
  const [token, setToken] = useState("");
  const [sshKey, setSshKey] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [useModel, setUseModel] = useState(true);
  
  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      console.error("Copy failed", e);
    }
  }

  async function onScan() {
    console.log("Scan inputs:", {
      repoUrl: repoUrl || undefined,
      localPath: localPath || undefined,
      branch,
      hasToken: !!token,
      hasSshKey: !!sshKey,
      hasGithubToken: !!githubToken
    });
    
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ 
          repoUrl: repoUrl || undefined, 
          localPath: localPath || undefined, 
          branch, 
          useModel,
          sshKey: sshKey || undefined,
          githubToken: githubToken || undefined
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Request failed");
      }
      setResult(data);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <h1 className="text-2xl font-semibold">Prompt Explorer</h1>
        <div className="space-y-3">
          <input
            className="w-full border rounded px-3 py-2"
            placeholder="Git URL (e.g., https://github.com/owner/repo.git)"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
          />
          <input
            className="w-full border rounded px-3 py-2"
            placeholder="Local path (e.g., /Users/you/code/my-repo)"
            value={localPath}
            onChange={(e) => setLocalPath(e.target.value)}
          />
          <div className="flex gap-3">
            <input
              className="flex-1 border rounded px-3 py-2"
              placeholder="Branch (default: main)"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
            />
            <label className="flex items-center gap-2 text-sm">
              <div className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={useModel}
                  onChange={(e) => setUseModel(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                <span className="ml-3 text-sm font-medium text-gray-900">Use model for analysis</span>
              </div>
            </label>
            <input
              className="flex-1 border rounded px-3 py-2"
              placeholder="JWT (Authorization Bearer)"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>
          <div className="flex gap-3">
            <input
              className="flex-1 border rounded px-3 py-2"
              placeholder="SSH Private Key (for private repos)"
              value={sshKey}
              onChange={(e) => setSshKey(e.target.value)}
              type="password"
            />
            <input
              className="flex-1 border rounded px-3 py-2"
              placeholder="GitHub Token (for private repos)"
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
              type="password"
            />
          </div>
          <div className="flex gap-3">
            <button
              className="bg-black text-white rounded px-4 py-2 disabled:opacity-50 flex-1"
              onClick={onScan}
              disabled={loading || (!repoUrl && !localPath) || !token}
            >
              {loading ? "Scanning..." : "Scan repo"}
            </button>
            <button
              className="bg-gray-500 text-white rounded px-4 py-2"
              onClick={() => {
                setRepoUrl("");
                setLocalPath("/Users/shreykakkar/Desktop/github-projects/procura");
                setToken("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJsb2NhbC1zY2FuIiwiaWF0IjoxNzU0NjA0NjE5fQ.axuv4DrXjrsdu15Jex8HqWwIslorqPGBuvfOQUHigVc");
                console.log("Test button clicked - fields populated");
              }}
            >
              Test
            </button>
          </div>
        </div>

        {error && (
          <div className="text-red-600 text-sm">{error}</div>
        )}

        {result && (
          <div className="space-y-6">
            {/* Summary Stats */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-blue-900">Scan Summary</h2>
                <button
                  className="text-xs bg-blue-600 text-white rounded px-3 py-1 hover:bg-blue-700"
                  onClick={() => {
                    const allText = JSON.stringify(
                      {
                        repo: result.repo,
                        extracted: { python: result.extracted?.python || [] },
                        prompts: { keywords: result.prompts?.keywords || [], analysis: result.prompts?.analysis },
                        secrets: result.secrets || [],
                        fileTree: result.fileTree || null,
                      },
                      null,
                      2
                    );
                    copyToClipboard(allText);
                  }}
                >
                  Copy All Results
                </button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">{result.prompts?.keywords?.length || 0}</div>
                  <div className="text-blue-700">Prompt Hits</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{result.extracted?.python?.length || 0}</div>
                  <div className="text-green-700">Python Extracted</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">{result.secrets?.length || 0}</div>
                  <div className="text-red-700">Secrets Found</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-600">{result.prompts?.analysis ? 1 : 0}</div>
                  <div className="text-purple-700">Model Analysis</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-600">{result.fileTree ? (result.fileTree.children?.length || 0) : 0}</div>
                  <div className="text-gray-700">Top-level Items</div>
                </div>
              </div>
            </div>

            {/* Repository File Tree */}
            {result.fileTree && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-gray-800">Repository File Tree</h2>
                </div>
                <FileTree root={result.fileTree} />
              </div>
            )}

            {/* Prompt Instances */}
            {(result.prompts?.keywords && result.prompts.keywords.length > 0) && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-gray-800">Prompt Instances</h2>
                  <button
                    className="text-xs bg-gray-600 text-white rounded px-3 py-1 hover:bg-gray-700"
                    onClick={() => copyToClipboard(JSON.stringify(result.prompts?.keywords || [], null, 2))}
                  >
                    Copy All Prompts
                  </button>
                </div>
                <div className="grid gap-4">
                  {result.prompts.keywords.map((prompt, index) => (
                    <div key={index} className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                              {prompt.matchLabel}
                            </span>
                            <span className="text-sm text-gray-500">Line {prompt.line}</span>
                          </div>
                          <div className="text-sm font-medium text-gray-900 truncate">
                            {prompt.filePath.split('/').pop()}
                          </div>
                          <div className="text-xs text-gray-500 truncate">
                            {prompt.filePath}
                          </div>
                        </div>
                        <button
                          className="text-xs bg-gray-100 text-gray-700 rounded px-2 py-1 hover:bg-gray-200 ml-2"
                          onClick={() => copyToClipboard(prompt.snippet)}
                        >
                          Copy
                        </button>
                      </div>
                      <div className="bg-gray-50 rounded p-3">
                        <pre className="text-sm text-gray-800 whitespace-pre-wrap break-words">{prompt.snippet}</pre>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Python Extracted */}
            {(result.extracted?.python && result.extracted.python.length > 0) && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-gray-800">Python Extracted</h2>
                  <button
                    className="text-xs bg-gray-600 text-white rounded px-3 py-1 hover:bg-gray-700"
                    onClick={() => copyToClipboard(JSON.stringify(result.extracted?.python || [], null, 2))}
                  >
                    Copy All Python
                  </button>
                </div>
                <div className="grid gap-4">
                  {result.extracted.python.map((item: Record<string, unknown>, index) => (
                    <div key={index} className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                              {(item.role as string) || 'unknown'}
                            </span>
                            <span className="text-sm text-gray-500">Line {item.line as number}</span>
                          </div>
                          <div className="text-sm font-medium text-gray-900 truncate">
                            {(item.filePath as string)?.split('/').pop()}
                          </div>
                          <div className="text-xs text-gray-500 truncate">
                            {item.filePath as string}
                          </div>
                        </div>
                        <button
                          className="text-xs bg-gray-100 text-gray-700 rounded px-2 py-1 hover:bg-gray-200 ml-2"
                          onClick={() => copyToClipboard((item.text as string) || '')}
                        >
                          Copy
                        </button>
                      </div>
                      <div className="bg-gray-50 rounded p-3">
                        <pre className="text-sm text-gray-800 whitespace-pre-wrap break-words">{(item.text as string) || ''}</pre>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Model Analysis */}
            {result.prompts?.analysis && (
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-semibold text-purple-900">Model Analysis</h2>
                  <button
                    className="text-xs bg-purple-600 text-white rounded px-3 py-1 hover:bg-purple-700"
                    onClick={() => copyToClipboard(JSON.stringify(result.prompts?.analysis, null, 2))}
                  >
                    Copy Analysis
                  </button>
                </div>
                <div className="space-y-3">
                  <div>
                    <h3 className="font-medium text-purple-800 mb-2">Summary</h3>
                    <p className="text-sm text-purple-700 bg-purple-100 rounded p-3">{result.prompts.analysis.summary}</p>
                  </div>
                  {result.prompts.analysis.files && result.prompts.analysis.files.length > 0 && (
                    <div>
                      <h3 className="font-medium text-purple-800 mb-2">Files with Prompts</h3>
                      <div className="space-y-2">
                        {result.prompts.analysis.files.map((file, index) => (
                          <div key={index} className="bg-white rounded p-2 border border-purple-200">
                            <div className="flex items-center justify-between">
                              <div className="flex-1">
                                <div className="text-sm font-medium text-gray-900">{file.filePath.split('/').pop()}</div>
                                <div className="text-xs text-gray-500">{file.filePath}</div>
                              </div>
                              <div className="text-right">
                                <div className="text-sm font-bold text-purple-600">{file.count}</div>
                                <div className="text-xs text-gray-500">hits</div>
                              </div>
                            </div>
                            {file.reasoning && (
                              <div className="text-xs text-gray-600 mt-1 italic">&ldquo;{file.reasoning}&rdquo;</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Secrets */}
            {(result.secrets && result.secrets.length > 0) && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-gray-800">Security Findings</h2>
                  <button
                    className="text-xs bg-red-600 text-white rounded px-3 py-1 hover:bg-red-700"
                    onClick={() => copyToClipboard(JSON.stringify(result.secrets || [], null, 2))}
                  >
                    Copy All Secrets
                  </button>
                </div>
                <div className="grid gap-3">
                  {result.secrets.map((secret, index) => (
                    <div key={index} className="bg-red-50 border border-red-200 rounded-lg p-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="text-sm font-medium text-red-900 truncate">
                            {secret.filePath.split('/').pop()}
                          </div>
                          <div className="text-xs text-red-600">Line {secret.line}</div>
                          <div className="text-xs text-red-500 truncate">
                            {secret.filePath}
                          </div>
                        </div>
                        <button
                          className="text-xs bg-red-100 text-red-700 rounded px-2 py-1 hover:bg-red-200 ml-2"
                          onClick={() => copyToClipboard(secret.match)}
                        >
                          Copy
                        </button>
                      </div>
                      <div className="mt-2">
                        <code className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded break-all">{secret.match}</code>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Empty State */}
            {(!result.prompts?.keywords || result.prompts.keywords.length === 0) && 
             (!result.extracted?.python || result.extracted.python.length === 0) && 
             (!result.secrets || result.secrets.length === 0) && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
                <div className="text-gray-500 text-lg mb-2">No prompts or findings detected</div>
                <div className="text-gray-400 text-sm">Try scanning a different repository or check if prompts are in a different format</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
