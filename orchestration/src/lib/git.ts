import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

// ── Shell helper ───────────────────────────────────────────────────────────

export function run(
  args: string[],
  opts?: { cwd?: string; silent?: boolean },
): string {
  const [cmd, ...rest] = args;
  try {
    return execFileSync(cmd, rest, {
      encoding: "utf-8",
      stdio: opts?.silent
        ? ["pipe", "pipe", "pipe"]
        : ["pipe", "pipe", "inherit"],
      cwd: opts?.cwd,
    }).trim();
  } catch (error) {
    const execError = error as {
      stderr?: string;
      message?: string;
      status?: number;
    };
    const detail = execError.stderr?.trim() || execError.message || "Command failed";
    const prefix = `Command failed: ${args.join(" ")}`;
    const code = execError.status != null ? ` (exit code ${execError.status})` : "";
    const cwd = opts?.cwd ? ` [cwd: ${opts.cwd}]` : "";
    const err = new Error(`${prefix}${code}${cwd}\n${detail}`);
    (err as Error & { status?: number }).status = execError.status ?? undefined;
    throw err;
  }
}

// ── Git operations ─────────────────────────────────────────────────────────

export function cloneBareRepo(remote: string, barePath: string): void {
  console.log(`Cloning bare repository from ${remote}...`);
  run(["git", "clone", "--bare", remote, barePath]);
  console.log("Bare repository cloned successfully.");
}

export function createWorktree(
  barePath: string,
  worktreePath: string,
  branch: string,
  isNew: boolean,
): void {
  if (isNew) {
    console.log(`Creating new branch '${branch}' and worktree...`);
    run(["git", "--git-dir", barePath, "worktree", "add", "-b", branch, worktreePath]);
  } else {
    console.log(`Creating worktree for existing branch '${branch}'...`);
    run(["git", "--git-dir", barePath, "worktree", "add", worktreePath, branch]);
  }
}

export function fetchLatest(barePath: string): void {
  if (!existsSync(barePath)) {
    throw new Error(`Bare repository not found at ${barePath}`);
  }

  console.log("Fetching latest from remote...");
  try {
    run(["git", "--git-dir", barePath, "fetch", "--all", "--prune"]);
    console.log("Fetch complete.");
  } catch (error) {
    console.warn(
      "Warning: Failed to fetch from remote. Continuing with local state.",
    );
    console.warn((error as Error).message);
  }
}

export function branchExists(
  barePath: string,
  branch: string,
  type: "local" | "remote",
): boolean {
  const ref =
    type === "local"
      ? `refs/heads/${branch}`
      : `refs/remotes/origin/${branch}`;
  try {
    run(
      ["git", "--git-dir", barePath, "show-ref", "--verify", "--quiet", ref],
      { silent: true },
    );
    return true;
  } catch (error) {
    const execError = error as { status?: number };
    // Exit code 1 means ref not found — that's expected
    if (execError.status === 1) {
      return false;
    }
    // Any other error (corrupt repo, missing git, permissions) should propagate
    throw error;
  }
}

export function createTrackingBranch(
  barePath: string,
  branch: string,
): void {
  console.log(
    `Creating local branch '${branch}' tracking 'origin/${branch}'...`,
  );
  run(["git", "--git-dir", barePath, "branch", branch, `origin/${branch}`]);
}

export function sanitizeBranchName(
  branch: string,
  _sanitizer: string,
): string {
  // Currently only "replace-slash" is supported: replaces "/" with "__"
  // and strips other unsafe filesystem characters. The sanitizer parameter
  // is reserved for future strategies (e.g. "kebab-case", "hash-prefix").
  return branch
    .replace(/\//g, "__")
    .replace(/[^A-Za-z0-9._-]/g, "_");
}

export function verifyWorktree(
  barePath: string,
  worktreePath: string,
): boolean {
  const gitFile = join(worktreePath, ".git");

  if (!existsSync(gitFile)) {
    return false;
  }

  const content = readFileSync(gitFile, "utf-8").trim();
  if (!content.startsWith("gitdir:")) {
    return false;
  }

  const gitdir = resolve(content.substring("gitdir:".length).trim());
  // The gitdir must start with this bare repo's path at a path boundary
  const normalizedBare = resolve(barePath);
  return gitdir === normalizedBare || gitdir.startsWith(normalizedBare + sep);
}
