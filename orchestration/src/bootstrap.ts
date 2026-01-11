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
    console.error("Please create project.config.json with codebase.remote and codebase.defaultBranch");
    process.exit(1);
  }

  try {
    const content = readFileSync(CONFIG_PATH, "utf-8");
    const config = JSON.parse(content) as ProjectConfig;

    // Validate required fields
    if (!config.codebase?.remote || typeof config.codebase.remote !== "string" || config.codebase.remote.trim() === "") {
      console.error("Error: project.config.json is malformed");
      console.error("  - codebase.remote must be a non-empty string (git remote URL)");
      process.exit(1);
    }

    // Apply defaults
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

function run(command: string, options?: { cwd?: string }): string {
  try {
    return execSync(command, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      cwd: options?.cwd,
    }).trim();
  } catch (error) {
    const execError = error as { stderr?: string; message?: string };
    throw new Error(execError.stderr || execError.message || "Command failed");
  }
}

function cloneBareRepo(remote: string): void {
  console.log(`Cloning bare repository from ${remote}...`);
  run(`git clone --bare "${remote}" "${BARE_PATH}"`);
  console.log("Bare repository cloned successfully.");
}

function verifyWorktreePointsToOurBare(worktreePath: string): boolean {
  const gitFile = join(worktreePath, ".git");

  if (!existsSync(gitFile)) {
    return false;
  }

  try {
    const content = readFileSync(gitFile, "utf-8").trim();
    // .git file should contain: gitdir: <path-to-.bare>/worktrees/<name>
    if (!content.startsWith("gitdir:")) {
      return false;
    }

    const gitdir = content.substring("gitdir:".length).trim();
    // The gitdir should contain our .bare path
    return gitdir.includes(".bare");
  } catch {
    return false;
  }
}

function createWorktree(config: ProjectConfig): void {
  const worktreesRoot = join(META_REPO_ROOT, config.worktrees.root);
  const mainWorktreePath = join(worktreesRoot, "main");
  const branch = config.codebase.defaultBranch;

  if (existsSync(mainWorktreePath)) {
    // Verify it's our worktree
    try {
      run(`git -C "${mainWorktreePath}" rev-parse --is-inside-work-tree`);

      if (!verifyWorktreePointsToOurBare(mainWorktreePath)) {
        console.error(`Error: ${mainWorktreePath} exists but is not a worktree for our .bare repository.`);
        console.error("Please remove or rename this directory and run bootstrap again.");
        process.exit(1);
      }

      console.log("Main worktree already exists and is valid.");
      return;
    } catch {
      console.error(`Error: ${mainWorktreePath} exists but is not a valid git worktree.`);
      console.error("Please remove or rename this directory and run bootstrap again.");
      process.exit(1);
    }
  }

  console.log(`Creating main worktree for branch '${branch}'...`);
  run(`git --git-dir "${BARE_PATH}" worktree add "${mainWorktreePath}" "${branch}"`);
  console.log("Main worktree created successfully.");
}

function enableCorepack(): void {
  console.log("Enabling corepack...");
  try {
    run("corepack enable");
    console.log("Corepack enabled.");
  } catch (error) {
    console.warn("Warning: Failed to enable corepack. You may need to run 'corepack enable' manually.");
    console.warn((error as Error).message);
  }
}

function installDependencies(config: ProjectConfig): void {
  const worktreesRoot = join(META_REPO_ROOT, config.worktrees.root);
  const mainWorktreePath = join(worktreesRoot, "main");

  console.log("Installing dependencies in main worktree...");
  try {
    run("pnpm install", { cwd: mainWorktreePath });
    console.log("Dependencies installed successfully.");
  } catch (error) {
    console.error("Error: Failed to install dependencies.");
    console.error((error as Error).message);
    process.exit(1);
  }
}

function main(): void {
  console.log("=== Bootstrap: Setting up monorepo ===\n");

  // Load and validate config
  const config = loadConfig();
  console.log(`Meta-repo root: ${META_REPO_ROOT}`);
  console.log(`Codebase remote: ${config.codebase.remote}`);
  console.log(`Default branch: ${config.codebase.defaultBranch}\n`);

  // Clone bare repo if it doesn't exist
  if (!existsSync(BARE_PATH)) {
    cloneBareRepo(config.codebase.remote);
  } else {
    console.log("Bare repository already exists.");
  }

  // Create main worktree if it doesn't exist
  createWorktree(config);

  // Enable corepack
  enableCorepack();

  // Install dependencies
  installDependencies(config);

  console.log("\n=== Bootstrap complete! ===");
  console.log(`\nYou can now work in: ${join(META_REPO_ROOT, config.worktrees.root, "main")}`);
}

main();
