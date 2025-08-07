"use client";

import { useState } from "react";

type ScanResponse = {
  ok: boolean;
  repo: { url: string | null; branch: string; path: string };
  extracted: { python: Array<Record<string, unknown>> };
  secrets: Array<{ match: string; filePath: string; line: number }>;
};

export default function Home() {
  const [repoUrl, setRepoUrl] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [branch, setBranch] = useState("main");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onScan() {
    console.log("Scan inputs:", {
      repoUrl: repoUrl || undefined,
      localPath: localPath || undefined,
      branch,
      hasToken: !!token
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
        body: JSON.stringify({ repoUrl: repoUrl || undefined, localPath: localPath || undefined, branch }),
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
      <div className="max-w-3xl mx-auto space-y-6">
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
            <input
              className="flex-1 border rounded px-3 py-2"
              placeholder="JWT (Authorization Bearer)"
              value={token}
              onChange={(e) => setToken(e.target.value)}
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
                setLocalPath("/Users/shreykakkar/Desktop/github-projects/new-procuro2");
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
          <div className="space-y-4">
            <div>
              <h2 className="font-medium">Repo</h2>
              <pre className="text-xs bg-gray-200 text-gray-900 p-3 rounded overflow-x-auto">{JSON.stringify(result.repo, null, 2)}</pre>
            </div>
            <div>
              <h2 className="font-medium">Extracted (Python)</h2>
              <pre className="text-xs bg-gray-200 text-gray-900 p-3 rounded overflow-x-auto">{JSON.stringify(result.extracted?.python || [], null, 2)}</pre>
            </div>
            <div>
              <h2 className="font-medium">Secrets</h2>
              <pre className="text-xs bg-gray-200 text-gray-900 p-3 rounded overflow-x-auto">{JSON.stringify(result.secrets || [], null, 2)}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
