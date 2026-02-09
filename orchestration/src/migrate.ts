import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  CONFIG_PATH,
  META_REPO_ROOT,
  REPOS_ROOT,
  repoNameFromRemote,
  saveConfig,
  type LegacyConfig,
  type ProjectConfig,
} from "./lib/config.js";
import { run } from "./lib/git.js";

// ── Legacy paths ───────────────────────────────────────────────────────────

const LEGACY_BARE = join(META_REPO_ROOT, ".bare");
const LEGACY_WORKTREES = join(META_REPO_ROOT, "worktrees");
const GITIGNORE_PATH = join(META_REPO_ROOT, ".gitignore");

// ── Main migration logic ───────────────────────────────────────────────────

function main(): void {
  console.log("=== Migration: single-repo → multi-repo layout ===\n");

  // Step 1: Detect legacy layout
  if (!existsSync(LEGACY_BARE)) {
    console.log("No legacy .bare/ directory found at project root.");
    console.log("Nothing to migrate. If you're starting fresh, just use 'pnpm bootstrap'.");
    process.exit(0);
  }

  // Step 2: Load legacy config
  if (!existsSync(CONFIG_PATH)) {
    console.error("Error: project.config.json not found.");
    process.exit(1);
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch (error) {
    console.error("Error: Failed to parse project.config.json");
    console.error((error as Error).message);
    process.exit(1);
  }

  if (!raw.codebase) {
    console.log("Config is already in new format. Nothing to migrate.");
    process.exit(0);
  }

  const legacy = raw as unknown as LegacyConfig;
  const repoName = repoNameFromRemote(legacy.codebase.remote);
  const targetDir = join(REPOS_ROOT, repoName);

  // Step 3: Print migration plan
  console.log("Detected legacy layout. Migration plan:\n");
  console.log(`  Repo name (derived from remote): ${repoName}`);
  console.log(`  .bare/             → repos/${repoName}/.bare/`);

  if (existsSync(LEGACY_WORKTREES)) {
    console.log(`  worktrees/         → repos/${repoName}/worktrees/`);
  }

  console.log(`  project.config.json → updated to new format`);
  console.log(`  .gitignore         → updated (.bare/ + worktrees/ → repos/)\n`);

  // Step 4: Check target doesn't exist
  if (existsSync(targetDir)) {
    console.error(`Error: Target directory already exists: ${targetDir}`);
    console.error("Cannot migrate — please resolve manually.");
    process.exit(1);
  }

  // Perform destructive migration steps inside try/catch
  try {
    performMigration(legacy, repoName, targetDir);
  } catch (error) {
    console.error(`\nMigration failed: ${(error as Error).message}`);
    console.error("\nTo recover, reverse the partial migration:");
    console.error(`  # If .bare was moved:`);
    console.error(`  [ -d "repos/${repoName}/.bare" ] && mv "repos/${repoName}/.bare" .bare`);
    console.error(`  # If worktrees were moved:`);
    console.error(`  [ -d "repos/${repoName}/worktrees" ] && mv "repos/${repoName}/worktrees" worktrees`);
    console.error(`  # Restore config and .gitignore from git:`);
    console.error(`  git checkout -- project.config.json .gitignore`);
    process.exit(1);
  }
}

function performMigration(
  legacy: LegacyConfig,
  repoName: string,
  targetDir: string,
): void {
  mkdirSync(targetDir, { recursive: true });

  // Step 5: Move .bare/
  const newBarePath = join(targetDir, ".bare");
  console.log(`Moving .bare/ → repos/${repoName}/.bare/ ...`);
  renameSync(LEGACY_BARE, newBarePath);

  // Step 6: Move worktrees/
  const newWorktreesRoot = join(targetDir, "worktrees");
  if (existsSync(LEGACY_WORKTREES)) {
    console.log(`Moving worktrees/ → repos/${repoName}/worktrees/ ...`);
    renameSync(LEGACY_WORKTREES, newWorktreesRoot);
  }

  // Step 7: Rewrite worktree .git files (update gitdir: paths)
  if (existsSync(newWorktreesRoot)) {
    rewriteWorktreeGitFiles(newBarePath, newWorktreesRoot);
  }

  // Step 8: Rewrite .bare/worktrees/*/gitdir files (reverse pointers)
  rewriteBareWorktreePointers(newBarePath, newWorktreesRoot);

  // Step 9: Verify each worktree
  if (existsSync(newWorktreesRoot)) {
    verifyWorktrees(newWorktreesRoot);
  }

  // Step 10: Update project.config.json
  console.log("Updating project.config.json...");
  const newConfig: ProjectConfig = {
    defaults: {
      defaultBranch: legacy.codebase.defaultBranch || "main",
      packageManager: "pnpm",
      branchSanitizer: legacy.worktrees?.branchSanitizer || "replace-slash",
    },
    repos: {
      [repoName]: {
        remote: legacy.codebase.remote,
      },
    },
  };
  saveConfig(newConfig);

  // Step 11: Update .gitignore
  updateGitignore();

  console.log("\n=== Migration complete! ===\n");
  console.log("Your workspace is now in multi-repo layout.");
  console.log(`Main worktree: repos/${repoName}/worktrees/main/`);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function rewriteWorktreeGitFiles(
  newBarePath: string,
  worktreesRoot: string,
): void {
  console.log("Rewriting worktree .git files...");

  const entries = readdirSync(worktreesRoot, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const wtDir = join(worktreesRoot, entry.name);
    const gitFile = join(wtDir, ".git");

    if (!existsSync(gitFile)) continue;

    const content = readFileSync(gitFile, "utf-8").trim();
    if (!content.startsWith("gitdir:")) continue;

    const oldGitdir = content.substring("gitdir:".length).trim();

    // The old gitdir points to something like: /abs/path/.bare/worktrees/<name>
    // We need it to point to: /abs/path/repos/<repoName>/.bare/worktrees/<name>
    const match = oldGitdir.match(/\.bare\/worktrees\/(.+)$/);
    if (match) {
      const refName = match[1];
      const newGitdir = join(newBarePath, "worktrees", refName);
      writeFileSync(gitFile, `gitdir: ${newGitdir}\n`, "utf-8");
      console.log(`  Updated: ${entry.name}/.git → ${newGitdir}`);
    } else {
      // For main worktree, gitdir might point directly to .bare
      writeFileSync(gitFile, `gitdir: ${resolve(newBarePath)}\n`, "utf-8");
      console.log(`  Updated: ${entry.name}/.git → ${resolve(newBarePath)}`);
    }
  }
}

function rewriteBareWorktreePointers(
  newBarePath: string,
  newWorktreesRoot: string,
): void {
  const bareWtDir = join(newBarePath, "worktrees");
  if (!existsSync(bareWtDir)) return;

  console.log("Rewriting bare repo worktree pointers...");

  const entries = readdirSync(bareWtDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const gitdirFile = join(bareWtDir, entry.name, "gitdir");
    if (!existsSync(gitdirFile)) continue;

    const oldPath = readFileSync(gitdirFile, "utf-8").trim();
    // The old path points to something like: /abs/path/worktrees/<name>/.git
    // We need: /abs/path/repos/<repoName>/worktrees/<name>/.git
    const newPath = join(newWorktreesRoot, entry.name, ".git");
    writeFileSync(gitdirFile, newPath + "\n", "utf-8");
    console.log(`  Updated: .bare/worktrees/${entry.name}/gitdir → ${newPath}`);
  }
}

function verifyWorktrees(worktreesRoot: string): void {
  console.log("Verifying worktrees...");

  const entries = readdirSync(worktreesRoot, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const wtPath = join(worktreesRoot, entry.name);
    try {
      run(`git -C "${wtPath}" status`, { silent: true });
      console.log(`  OK: ${entry.name}`);
    } catch (error) {
      console.error(`  FAIL: ${entry.name} — verification failed`);
      console.error(`    ${(error as Error).message}`);
    }
  }
}

function updateGitignore(): void {
  console.log("Updating .gitignore...");

  if (!existsSync(GITIGNORE_PATH)) {
    writeFileSync(GITIGNORE_PATH, "repos/\n", "utf-8");
    return;
  }

  let content = readFileSync(GITIGNORE_PATH, "utf-8");

  // Remove old entries
  content = content.replace(/^\.bare\/?\n?/gm, "");
  content = content.replace(/^worktrees\/?\n?/gm, "");

  // Replace the old comment if present
  content = content.replace(
    /^# Two-repo architecture:.*\n?/gm,
    "",
  );

  // Add new entry at the top
  const reposEntry = "# Multi-repo workspace\nrepos/\n";

  if (content.trim()) {
    content = reposEntry + "\n" + content.trimStart();
  } else {
    content = reposEntry;
  }

  writeFileSync(GITIGNORE_PATH, content, "utf-8");
}

main();
