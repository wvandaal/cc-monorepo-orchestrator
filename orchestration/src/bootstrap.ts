import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  loadConfig,
  resolveAllRepos,
  resolveAllTemplates,
  resolveRepoConfig,
  resolveTemplateConfig,
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

  // Ensure parent directory exists (works for both repos/ and templates/)
  mkdirSync(dirname(repo.barePath), { recursive: true });

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
      run(["git", "-C", mainWorktreePath, "rev-parse", "--is-inside-work-tree"], {
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
    } catch (error) {
      console.error(
        `  Error: ${mainWorktreePath} exists but is not a valid git worktree.`,
      );
      console.error(`  Cause: ${(error as Error).message}`);
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

  // Determine what to bootstrap
  let targets: ResolvedRepoConfig[];
  if (repoName) {
    // Try repos first, then templates
    const repo = config.repos[repoName] ? resolveRepoConfig(config, repoName) : undefined;
    const tpl = !repo ? resolveTemplateConfig(config, repoName) : undefined;
    if (!repo && !tpl) {
      console.error(`Error: '${repoName}' not found in repos or templates in project.config.json`);
      process.exit(1);
    }
    targets = [(repo ?? tpl)!];
  } else {
    targets = [...resolveAllRepos(config), ...resolveAllTemplates(config)];
  }

  for (const target of targets) {
    bootstrapRepo(target, forceInstall);
  }

  console.log("\n=== Bootstrap complete! ===");

  // Only show worktree locations for repos, not templates
  const repos = targets.filter((t) => config.repos[t.name]);
  if (repos.length === 1) {
    console.log(
      `\nYou can now work in: ${join(repos[0].worktreesRoot, "main")}`,
    );
  } else if (repos.length > 1) {
    console.log("\nWorktree locations:");
    for (const repo of repos) {
      console.log(`  ${repo.name}: ${join(repo.worktreesRoot, "main")}`);
    }
  }
}

main();
