import simpleGit from "simple-git";
import { join } from "node:path";
import { existsSync, promises as fs } from "node:fs";

export type CloneOptions = {
  repoUrl: string;
  destDir: string;
  branch?: string;
  sshKey?: string; // Private SSH key for authentication
  githubToken?: string; // GitHub personal access token for HTTPS auth
};

export async function cloneOrPullRepo({ repoUrl, destDir, branch = "main", sshKey, githubToken }: CloneOptions): Promise<void> {
  if (!existsSync(destDir)) {
    await fs.mkdir(destDir, { recursive: true });
  }
  const repoName = repoUrl.split("/").pop()?.replace(/\.git$/, "") || "repo";
  const target = join(destDir, repoName);
  
  // Configure git with authentication if provided
  const git = simpleGit();
  
  if (sshKey) {
    // Set up SSH key for authentication
    const sshDir = join(process.cwd(), '.ssh');
    await fs.mkdir(sshDir, { recursive: true });
    await fs.writeFile(join(sshDir, 'id_rsa'), sshKey, { mode: 0o600 });
    await fs.writeFile(join(sshDir, 'id_rsa.pub'), '', { mode: 0o644 });
    
    // Configure git to use the SSH key
    await git.addConfig('core.sshCommand', `ssh -i ${join(sshDir, 'id_rsa')} -o StrictHostKeyChecking=no`);
  }
  
  if (githubToken && repoUrl.startsWith('https://')) {
    // For HTTPS URLs, embed the token in the URL
    const urlWithToken = repoUrl.replace('https://', `https://${githubToken}@`);
    repoUrl = urlWithToken;
  }

  if (!existsSync(target)) {
    await git.clone(repoUrl, target, ["--branch", branch, "--depth", "1"]);
  } else {
    await simpleGit(target).fetch();
    await simpleGit(target).reset(["--hard", `origin/${branch}`]);
    await simpleGit(target).pull("origin", branch);
  }
}

