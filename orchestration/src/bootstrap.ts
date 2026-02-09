import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  loadConfig,
  resolveAllRepos,
  resolveRepoConfig,
  META_REPO_ROOT,
  type ResolvedRepoConfig,
} from "./lib/config.js";
import {
  cloneBareRepo,
  createWorktree,
  verifyWorktree,
  run,
} from "./lib/git.js";
import { enableCorepack, installDependencies } from "./lib/deps.js";

function bootstrapRepo(
  repo: ResolvedRepoConfig,
  forceInstall: boolean,
): void {
  console.log(`\n── Bootstrapping '${repo.name}' ──`);
  console.log(`  Remote: ${repo.remote}`);
  console.log(`  Branch: ${repo.defaultBranch}`);

  // Ensure repos/<name>/ exists
  const repoDir = join(META_REPO_ROOT, "repos", repo.name);
  mkdirSync(repoDir, { recursive: true });

  // Clone bare repo if .bare/ doesn't exist
  if (!existsSync(repo.barePath)) {
    cloneBareRepo(repo.remote, repo.barePath);
  } else {
    console.log("  Bare repository already exists.");
  }

  // Create main worktree if it doesn't exist
  const mainWorktreePath = join(repo.worktreesRoot, "main");

  if (existsSync(mainWorktreePath)) {
    // Verify it's a valid worktree pointing to our bare repo
    try {
      run(`git -C "${mainWorktreePath}" rev-parse --is-inside-work-tree`, {
        silent: true,
      });

      if (!verifyWorktree(repo.barePath, mainWorktreePath)) {
        console.error(
          `  Error: ${mainWorktreePath} exists but is not a worktree for this bare repo.`,
        );
        console.error(
          "  Please remove or rename this directory and run bootstrap again.",
        );
        process.exit(1);
      }

      console.log("  Main worktree already exists and is valid.");
    } catch {
      console.error(
        `  Error: ${mainWorktreePath} exists but is not a valid git worktree.`,
      );
      console.error(
        "  Please remove or rename this directory and run bootstrap again.",
      );
      process.exit(1);
    }
  } else {
    createWorktree(repo.barePath, mainWorktreePath, repo.defaultBranch, false);
  }

  // Install dependencies
  installDependencies(mainWorktreePath, repo.packageManager, forceInstall);
}

function main(): void {
  const args = process.argv.slice(2);
  const forceInstall = args.includes("--force-install");
  const positional = args.filter((a) => !a.startsWith("--"));
  const repoName = positional[0];

  console.log("=== Bootstrap: Setting up workspace ===");

  const config = loadConfig();

  // Enable corepack once
  enableCorepack();

  // Determine which repos to bootstrap
  let repos: ResolvedRepoConfig[];
  if (repoName) {
    repos = [resolveRepoConfig(config, repoName)];
  } else {
    repos = resolveAllRepos(config);
  }

  for (const repo of repos) {
    bootstrapRepo(repo, forceInstall);
  }

  console.log("\n=== Bootstrap complete! ===");

  if (repos.length === 1) {
    console.log(
      `\nYou can now work in: ${join(repos[0].worktreesRoot, "main")}`,
    );
  } else {
    console.log("\nWorktree locations:");
    for (const repo of repos) {
      console.log(`  ${repo.name}: ${join(repo.worktreesRoot, "main")}`);
    }
  }
}

main();
