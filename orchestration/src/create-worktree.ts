import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveRepoConfig } from "./lib/config.js";
import {
  branchExists,
  createTrackingBranch,
  createWorktree,
  fetchLatest,
  sanitizeBranchName,
} from "./lib/git.js";
import { installDependencies } from "./lib/deps.js";

function main(): void {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error("Usage: create-worktree <repo> <branch>");
    console.error("Example: create-worktree cc-monorepo feature/my-feature");
    process.exit(1);
  }

  const [repoName, branch] = args;
  const config = loadConfig();
  const repo = resolveRepoConfig(config, repoName);
  const sanitizedName = sanitizeBranchName(branch, repo.branchSanitizer);
  const worktreePath = join(repo.worktreesRoot, sanitizedName);

  console.log(`=== Creating worktree for '${repoName}' branch '${branch}' ===\n`);
  console.log(`Branch name: ${branch}`);
  console.log(`Folder name: ${sanitizedName}`);
  console.log(`Worktree path: ${worktreePath}\n`);

  // Validate repo is bootstrapped
  if (!existsSync(repo.barePath)) {
    console.error(`Error: Bare repository not found at ${repo.barePath}`);
    console.error("Please run 'pnpm bootstrap' first to set up the repository.");
    process.exit(1);
  }

  // Check if worktree folder already exists
  if (existsSync(worktreePath)) {
    console.error(`Error: Worktree folder already exists at ${worktreePath}`);
    console.error("If you want to recreate it, first remove it with:");
    console.error(
      `  git --git-dir "${repo.barePath}" worktree remove --force "${worktreePath}"`,
    );
    process.exit(1);
  }

  // Fetch latest from remote
  fetchLatest(repo.barePath);

  // Determine branch state and create worktree
  const localExists = branchExists(repo.barePath, branch, "local");
  const remoteExists = branchExists(repo.barePath, branch, "remote");

  if (localExists) {
    console.log(`Local branch '${branch}' exists.`);
    createWorktree(repo.barePath, worktreePath, branch, false);
  } else if (remoteExists) {
    console.log(
      `Remote branch 'origin/${branch}' exists, creating local tracking branch.`,
    );
    createTrackingBranch(repo.barePath, branch);
    createWorktree(repo.barePath, worktreePath, branch, false);
  } else {
    console.log(`Branch '${branch}' doesn't exist, creating new branch.`);
    createWorktree(repo.barePath, worktreePath, branch, true);
  }

  console.log("Worktree created successfully.\n");

  // Install dependencies
  installDependencies(worktreePath, repo.packageManager);

  console.log("\n=== Worktree ready! ===");
  console.log(`\nYou can now work in: ${worktreePath}`);
  console.log(`  cd ${worktreePath}`);
}

main();
