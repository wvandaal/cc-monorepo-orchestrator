import { createInterface } from "node:readline";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadConfig,
  saveConfig,
  resolveAllRepos,
  resolveRepoConfig,
  REPOS_ROOT,
  type ResolvedRepoConfig,
} from "./lib/config.js";
import { run } from "./lib/git.js";

// ── Subcommands ────────────────────────────────────────────────────────────

function add(args: string[]): void {
  if (args.length < 2) {
    console.error("Usage: repo add <name> <remote> [--default-branch X] [--package-manager X]");
    process.exit(1);
  }

  const name = args[0];
  const remote = args[1];

  // Parse optional flags
  let defaultBranch: string | undefined;
  let packageManager: string | undefined;

  for (let i = 2; i < args.length; i++) {
    if (args[i] === "--default-branch" && args[i + 1]) {
      defaultBranch = args[++i];
    } else if (args[i] === "--package-manager" && args[i + 1]) {
      packageManager = args[++i];
    }
  }

  // Validate name is filesystem-safe
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    console.error(
      `Error: repo name '${name}' contains invalid characters. Use only [A-Za-z0-9._-].`,
    );
    process.exit(1);
  }

  const config = loadConfig();

  // Check for conflicts
  if (config.repos[name]) {
    console.error(`Error: repo '${name}' already exists in config.`);
    process.exit(1);
  }

  // Optionally verify remote is accessible
  console.log(`Verifying remote '${remote}'...`);
  try {
    run(`git ls-remote "${remote}"`, { silent: true });
    console.log("Remote is accessible.");
  } catch {
    console.warn(
      "Warning: Could not reach remote. Adding to config anyway (will fail at bootstrap if unreachable).",
    );
  }

  // Add to config
  const entry: { remote: string; defaultBranch?: string; packageManager?: string } = { remote };
  if (defaultBranch) entry.defaultBranch = defaultBranch;
  if (packageManager) entry.packageManager = packageManager;

  config.repos[name] = entry;
  saveConfig(config);
  console.log(`Added '${name}' to project.config.json.`);

  // Bootstrap the new repo (inherit stdio so user sees progress)
  console.log(`\nBootstrapping '${name}'...`);
  try {
    const scriptDir = new URL(".", import.meta.url).pathname;
    execSync(`node "${join(scriptDir, "bootstrap.js")}" "${name}"`, {
      stdio: "inherit",
    });
  } catch (error) {
    console.error("Bootstrap failed. The repo has been added to config but is not yet set up.");
    console.error((error as Error).message);
    process.exit(1);
  }

  console.log(`\nRepo '${name}' added and bootstrapped successfully.`);
}

function create(args: string[]): void {
  if (args.length < 1) {
    console.error(
      "Usage: repo create <name> --template <template> [--remote <url>] [--public] [--default-branch X] [--package-manager X]",
    );
    process.exit(1);
  }

  const name = args[0];

  // Parse flags
  let template: string | undefined;
  let remote: string | undefined;
  let isPublic = false;
  let defaultBranch: string | undefined;
  let packageManager: string | undefined;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--template" && args[i + 1]) {
      template = args[++i];
    } else if (args[i] === "--remote" && args[i + 1]) {
      remote = args[++i];
    } else if (args[i] === "--public") {
      isPublic = true;
    } else if (args[i] === "--default-branch" && args[i + 1]) {
      defaultBranch = args[++i];
    } else if (args[i] === "--package-manager" && args[i + 1]) {
      packageManager = args[++i];
    }
  }

  if (!template) {
    console.error("Error: --template is required.");
    console.error(
      "Usage: repo create <name> --template <template> [--remote <url>] [--public] [--default-branch X] [--package-manager X]",
    );
    process.exit(1);
  }

  // Validate name
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    console.error(
      `Error: repo name '${name}' contains invalid characters. Use only [A-Za-z0-9._-].`,
    );
    process.exit(1);
  }

  const config = loadConfig();

  // Check for conflicts
  if (config.repos[name]) {
    console.error(`Error: repo '${name}' already exists in config.`);
    process.exit(1);
  }

  // Verify template exists in config and has a bootstrapped main worktree
  if (!config.repos[template]) {
    console.error(`Error: template repo '${template}' not found in config.`);
    process.exit(1);
  }

  const templateConfig = resolveRepoConfig(config, template);
  const templateWorktree = join(templateConfig.worktreesRoot, "main");
  if (!existsSync(templateWorktree)) {
    console.error(
      `Error: template repo '${template}' does not have a bootstrapped main worktree at ${templateWorktree}.`,
    );
    console.error("Run `pnpm bootstrap` first to set up the template repo.");
    process.exit(1);
  }

  const branch = defaultBranch ?? config.defaults.defaultBranch;

  // Excluded basenames when copying template
  const excludedBasenames = new Set([".git", "node_modules", "dist"]);
  const filter = (src: string): boolean => {
    const base = basename(src);
    if (excludedBasenames.has(base)) return false;
    if (base.endsWith(".tsbuildinfo")) return false;
    return true;
  };

  // Copy template to temp dir, init git, push to remote
  const tmpDir = mkdtempSync(join(tmpdir(), `repo-create-${name}-`));
  let remoteUrl = remote;
  let ghCreated = false;

  try {
    // Step 1: Copy template files
    console.log(`Copying template '${template}' to temp directory...`);
    cpSync(templateWorktree, tmpDir, { recursive: true, filter });

    // Step 2: Git init + commit
    console.log("Initializing git repository...");
    run(`git init -b "${branch}"`, { cwd: tmpDir });
    run("git add .", { cwd: tmpDir });
    run(`git commit -m "Initial commit from template: ${template}"`, { cwd: tmpDir });

    // Step 3: Remote handling
    if (remoteUrl) {
      console.log(`Adding remote: ${remoteUrl}`);
      run(`git remote add origin "${remoteUrl}"`, { cwd: tmpDir });
      console.log(`Pushing to origin/${branch}...`);
      run(`git push -u origin "${branch}"`, { cwd: tmpDir });
    } else {
      console.log(`Creating GitHub repository '${name}'...`);
      const visibility = isPublic ? "--public" : "--private";
      const ghOutput = run(`gh repo create "${name}" ${visibility} --clone=false`, { silent: true });
      // gh repo create prints the URL to stdout
      remoteUrl = ghOutput.trim();
      if (!remoteUrl) {
        throw new Error("gh repo create did not return a repository URL.");
      }
      ghCreated = true;
      console.log(`Created GitHub repo: ${remoteUrl}`);

      run(`git remote add origin "${remoteUrl}"`, { cwd: tmpDir });
      console.log(`Pushing to origin/${branch}...`);
      run(`git push -u origin "${branch}"`, { cwd: tmpDir });
    }
  } catch (error) {
    if (ghCreated && remoteUrl) {
      console.error(`\nError occurred after GitHub repo was created.`);
      console.error(`To clean up, run: gh repo delete "${remoteUrl}" --yes`);
    }
    console.error(`\nCreate failed: ${(error as Error).message}`);
    process.exit(1);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  // Step 4: Add to config + bootstrap
  const entry: { remote: string; defaultBranch?: string; packageManager?: string } = {
    remote: remoteUrl,
  };
  if (defaultBranch) entry.defaultBranch = defaultBranch;
  if (packageManager) entry.packageManager = packageManager;

  config.repos[name] = entry;
  saveConfig(config);
  console.log(`Added '${name}' to project.config.json.`);

  // Bootstrap the new repo
  console.log(`\nBootstrapping '${name}'...`);
  try {
    const scriptDir = new URL(".", import.meta.url).pathname;
    execSync(`node "${join(scriptDir, "bootstrap.js")}" "${name}"`, {
      stdio: "inherit",
    });
  } catch (error) {
    console.error("Bootstrap failed. The repo has been added to config but is not yet set up.");
    console.error((error as Error).message);
    process.exit(1);
  }

  console.log(`\nRepo '${name}' created from template '${template}' and bootstrapped successfully.`);
}

async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y");
    });
  });
}

async function remove(args: string[]): Promise<void> {
  if (args.length < 1) {
    console.error("Usage: repo remove <name> [--clean] [--force]");
    process.exit(1);
  }

  const name = args[0];
  const clean = args.includes("--clean");
  const force = args.includes("--force");

  const config = loadConfig();

  if (!config.repos[name]) {
    console.error(`Error: repo '${name}' not found in config.`);
    process.exit(1);
  }

  // Remove from config
  delete config.repos[name];
  saveConfig(config);
  console.log(`Removed '${name}' from project.config.json.`);

  // Optionally clean files
  if (clean) {
    const repoDir = join(REPOS_ROOT, name);
    if (existsSync(repoDir)) {
      if (!force) {
        const ok = await confirm(
          `This will permanently delete ${repoDir} (all worktrees, local branches, uncommitted work). Continue?`,
        );
        if (!ok) {
          console.log("Aborted. Files left on disk.");
          return;
        }
      }
      console.log(`Removing ${repoDir}...`);
      rmSync(repoDir, { recursive: true, force: true });
      console.log("Files removed.");
    } else {
      console.log("No files to clean (directory does not exist).");
    }
  } else {
    console.log("Files left on disk. Use --clean to remove them.");
  }
}

function list(): void {
  const config = loadConfig();
  const repos = resolveAllRepos(config);

  if (repos.length === 0) {
    console.log("No repos configured.");
    return;
  }

  console.log("Configured repositories:\n");
  console.log(
    padRight("Name", 25) +
    padRight("Branch", 12) +
    padRight("PM", 8) +
    padRight("Cloned", 8) +
    "Worktrees",
  );
  console.log("-".repeat(80));

  for (const repo of repos) {
    const cloned = existsSync(repo.barePath) ? "yes" : "no";
    const worktrees = listWorktrees(repo);

    console.log(
      padRight(repo.name, 25) +
      padRight(repo.defaultBranch, 12) +
      padRight(repo.packageManager, 8) +
      padRight(cloned, 8) +
      worktrees,
    );
  }
}

function rename(args: string[]): void {
  if (args.length < 2) {
    console.error("Usage: repo rename <oldName> <newName>");
    process.exit(1);
  }

  const oldName = args[0];
  const newName = args[1];

  // Validate newName is filesystem-safe
  if (!/^[A-Za-z0-9._-]+$/.test(newName)) {
    console.error(
      `Error: repo name '${newName}' contains invalid characters. Use only [A-Za-z0-9._-].`,
    );
    process.exit(1);
  }

  const config = loadConfig();

  if (!config.repos[oldName]) {
    console.error(`Error: repo '${oldName}' not found in config.`);
    process.exit(1);
  }

  if (config.repos[newName]) {
    console.error(`Error: repo '${newName}' already exists in config.`);
    process.exit(1);
  }

  const oldDir = join(REPOS_ROOT, oldName);
  const newDir = join(REPOS_ROOT, newName);

  if (!existsSync(oldDir)) {
    console.error(`Error: directory '${oldDir}' does not exist.`);
    process.exit(1);
  }

  if (existsSync(newDir)) {
    console.error(`Error: directory '${newDir}' already exists.`);
    process.exit(1);
  }

  // Step 1: Rename config key
  console.log(`Renaming '${oldName}' → '${newName}' in project.config.json...`);
  config.repos[newName] = config.repos[oldName];
  delete config.repos[oldName];
  saveConfig(config);

  try {
    // Step 2: Rename directory
    console.log(`Moving repos/${oldName}/ → repos/${newName}/ ...`);
    renameSync(oldDir, newDir);

    // Step 3: Rewrite worktree .git files and bare worktree pointers
    const oldAbsDir = oldDir;
    const newAbsDir = newDir;
    rewritePointerFiles(oldAbsDir, newAbsDir);

    // Step 4: Verify worktrees
    const worktreesRoot = join(newDir, "worktrees");
    if (existsSync(worktreesRoot)) {
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
  } catch (error) {
    console.error(`\nRename failed: ${(error as Error).message}`);
    console.error("\nRecovery instructions:");
    console.error(`  # If directory was moved, move it back:`);
    console.error(`  [ -d "repos/${newName}" ] && mv "repos/${newName}" "repos/${oldName}"`);
    console.error(`  # Restore config from git:`);
    console.error(`  git checkout -- project.config.json`);
    process.exit(1);
  }

  console.log(`\nRepo '${oldName}' renamed to '${newName}' successfully.`);
}

function rewritePointerFiles(oldDir: string, newDir: string): void {
  // Rewrite worktree .git files
  const worktreesRoot = join(newDir, "worktrees");
  if (existsSync(worktreesRoot)) {
    console.log("Rewriting worktree .git files...");
    const entries = readdirSync(worktreesRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const gitFile = join(worktreesRoot, entry.name, ".git");
      if (!existsSync(gitFile)) continue;
      const content = readFileSync(gitFile, "utf-8");
      const updated = content.replaceAll(oldDir, newDir);
      if (updated !== content) {
        writeFileSync(gitFile, updated, "utf-8");
        console.log(`  Updated: ${entry.name}/.git`);
      }
    }
  }

  // Rewrite .bare/worktrees/*/gitdir files
  const bareWtDir = join(newDir, ".bare", "worktrees");
  if (existsSync(bareWtDir)) {
    console.log("Rewriting bare repo worktree pointers...");
    const entries = readdirSync(bareWtDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const gitdirFile = join(bareWtDir, entry.name, "gitdir");
      if (!existsSync(gitdirFile)) continue;
      const content = readFileSync(gitdirFile, "utf-8");
      const updated = content.replaceAll(oldDir, newDir);
      if (updated !== content) {
        writeFileSync(gitdirFile, updated, "utf-8");
        console.log(`  Updated: .bare/worktrees/${entry.name}/gitdir`);
      }
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function listWorktrees(repo: ResolvedRepoConfig): string {
  if (!existsSync(repo.worktreesRoot)) {
    return "(none)";
  }

  try {
    const entries = readdirSync(repo.worktreesRoot, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    return dirs.length > 0 ? dirs.join(", ") : "(none)";
  } catch {
    return "(error)";
  }
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str + " " : str + " ".repeat(len - str.length);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const subcommand = args[0];

  switch (subcommand) {
    case "add":
      add(args.slice(1));
      break;
    case "create":
      create(args.slice(1));
      break;
    case "remove":
      await remove(args.slice(1));
      break;
    case "rename":
      rename(args.slice(1));
      break;
    case "list":
      list();
      break;
    default:
      console.error("Usage: repo <add|create|remove|rename|list>");
      console.error("  repo add <name> <remote> [--default-branch X] [--package-manager X]");
      console.error(
        "  repo create <name> --template <template> [--remote <url>] [--public] [--default-branch X] [--package-manager X]",
      );
      console.error("  repo remove <name> [--clean] [--force]");
      console.error("  repo rename <oldName> <newName>");
      console.error("  repo list");
      process.exit(1);
  }
}

main();
