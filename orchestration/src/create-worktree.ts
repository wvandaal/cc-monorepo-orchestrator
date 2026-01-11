import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve absolute paths from this script's location
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const META_REPO_ROOT = resolve(__dirname, "../..");
const CONFIG_PATH = join(META_REPO_ROOT, "project.config.json");
const BARE_PATH = join(META_REPO_ROOT, ".bare");

interface ProjectConfig {
  codebase: {
    remote: string;
    defaultBranch: string;
  };
  worktrees: {
    root: string;
    branchSanitizer?: string;
  };
}

function loadConfig(): ProjectConfig {
  if (!existsSync(CONFIG_PATH)) {
    console.error(`Error: project.config.json not found at ${CONFIG_PATH}`);
    process.exit(1);
  }

  try {
    const content = readFileSync(CONFIG_PATH, "utf-8");
    const config = JSON.parse(content) as ProjectConfig;

    if (!config.codebase?.remote) {
      console.error("Error: project.config.json is malformed - missing codebase.remote");
      process.exit(1);
    }

    config.codebase.defaultBranch = config.codebase.defaultBranch || "main";
    config.worktrees = config.worktrees || { root: "worktrees" };
    config.worktrees.root = config.worktrees.root || "worktrees";

    return config;
  } catch (error) {
    console.error("Error: Failed to parse project.config.json");
    console.error((error as Error).message);
    process.exit(1);
  }
}

function run(command: string, options?: { cwd?: string; silent?: boolean }): string {
  try {
    return execSync(command, {
      encoding: "utf-8",
      stdio: options?.silent ? ["pipe", "pipe", "pipe"] : ["pipe", "pipe", "inherit"],
      cwd: options?.cwd,
    }).trim();
  } catch (error) {
    const execError = error as { stderr?: string; message?: string };
    throw new Error(execError.stderr || execError.message || "Command failed");
  }
}

/**
 * Sanitize branch name for use as folder name.
 * - Replace any character not [A-Za-z0-9._-] with _
 * - Replace / with __ (for feature/branch style names)
 */
function sanitizeBranchName(branch: string): string {
  return branch
    .replace(/\//g, "__") // Replace / with __
    .replace(/[^A-Za-z0-9._-]/g, "_"); // Replace other unsafe chars with _
}

function fetchLatest(): void {
  console.log("Fetching latest from remote...");
  try {
    run(`git --git-dir "${BARE_PATH}" fetch --all --prune`);
    console.log("Fetch complete.");
  } catch (error) {
    console.warn("Warning: Failed to fetch from remote. Continuing with local state.");
    console.warn((error as Error).message);
  }
}

function branchExists(branch: string, type: "local" | "remote"): boolean {
  try {
    const ref = type === "local" ? `refs/heads/${branch}` : `refs/remotes/origin/${branch}`;
    run(`git --git-dir "${BARE_PATH}" show-ref --verify --quiet "${ref}"`, { silent: true });
    return true;
  } catch {
    return false;
  }
}

function createWorktree(branch: string, worktreePath: string, createNewBranch: boolean): void {
  if (createNewBranch) {
    console.log(`Creating new branch '${branch}' and worktree...`);
    run(`git --git-dir "${BARE_PATH}" worktree add -b "${branch}" "${worktreePath}"`);
  } else {
    console.log(`Creating worktree for existing branch '${branch}'...`);
    run(`git --git-dir "${BARE_PATH}" worktree add "${worktreePath}" "${branch}"`);
  }
}

function createTrackingBranch(branch: string): void {
  console.log(`Creating local branch '${branch}' tracking 'origin/${branch}'...`);
  run(`git --git-dir "${BARE_PATH}" branch "${branch}" "origin/${branch}"`);
}

function installDependencies(worktreePath: string): void {
  console.log("Installing dependencies...");
  try {
    run("pnpm install", { cwd: worktreePath });
    console.log("Dependencies installed successfully.");
  } catch (error) {
    console.error("Error: Failed to install dependencies.");
    console.error((error as Error).message);
    process.exit(1);
  }
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: create-worktree <branch-name>");
    console.error("Example: create-worktree feature/my-feature");
    process.exit(1);
  }

  const branch = args[0];
  const config = loadConfig();
  const sanitizedName = sanitizeBranchName(branch);
  const worktreesRoot = join(META_REPO_ROOT, config.worktrees.root);
  const worktreePath = join(worktreesRoot, sanitizedName);

  console.log(`=== Creating worktree for branch '${branch}' ===\n`);
  console.log(`Branch name: ${branch}`);
  console.log(`Folder name: ${sanitizedName}`);
  console.log(`Worktree path: ${worktreePath}\n`);

  // Check if bare repo exists
  if (!existsSync(BARE_PATH)) {
    console.error("Error: .bare repository not found.");
    console.error("Please run 'pnpm bootstrap' first to set up the repository.");
    process.exit(1);
  }

  // Check if worktree folder already exists
  if (existsSync(worktreePath)) {
    console.error(`Error: Worktree folder already exists at ${worktreePath}`);
    console.error("If you want to recreate it, first remove it with:");
    console.error(`  git --git-dir "${BARE_PATH}" worktree remove --force "${worktreePath}"`);
    process.exit(1);
  }

  // Fetch latest from remote
  fetchLatest();

  // Determine branch state and create worktree
  const localExists = branchExists(branch, "local");
  const remoteExists = branchExists(branch, "remote");

  if (localExists) {
    console.log(`Local branch '${branch}' exists.`);
    createWorktree(branch, worktreePath, false);
  } else if (remoteExists) {
    console.log(`Remote branch 'origin/${branch}' exists, creating local tracking branch.`);
    createTrackingBranch(branch);
    createWorktree(branch, worktreePath, false);
  } else {
    console.log(`Branch '${branch}' doesn't exist, creating new branch.`);
    createWorktree(branch, worktreePath, true);
  }

  console.log("Worktree created successfully.\n");

  // Install dependencies
  installDependencies(worktreePath);

  console.log("\n=== Worktree ready! ===");
  console.log(`\nYou can now work in: ${worktreePath}`);
  console.log(`  cd ${worktreePath}`);
}

main();
