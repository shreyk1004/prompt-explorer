import simpleGit from "simple-git";
import { join } from "node:path";
import { existsSync, promises as fs } from "node:fs";

export type CloneOptions = {
  repoUrl: string;
  destDir: string;
  branch?: string;
};

export async function cloneOrPullRepo({ repoUrl, destDir, branch = "main" }: CloneOptions): Promise<void> {
  if (!existsSync(destDir)) {
    await fs.mkdir(destDir, { recursive: true });
  }
  const repoName = repoUrl.split("/").pop()?.replace(/\.git$/, "") || "repo";
  const target = join(destDir, repoName);
  const git = simpleGit();

  if (!existsSync(target)) {
    await git.clone(repoUrl, target, ["--branch", branch, "--depth", "1"]);
  } else {
    await simpleGit(target).fetch();
    await simpleGit(target).reset(["--hard", `origin/${branch}`]);
    await simpleGit(target).pull("origin", branch);
  }
}

