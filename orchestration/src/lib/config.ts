import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve paths from this module's location
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const META_REPO_ROOT = resolve(__dirname, "../../..");
export const CONFIG_PATH = join(META_REPO_ROOT, "project.config.json");
export const REPOS_ROOT = join(META_REPO_ROOT, "repos");

// ── Types ──────────────────────────────────────────────────────────────────

export interface WorkspaceDefaults {
  defaultBranch: string;
  packageManager: string;
  branchSanitizer: string;
}

export interface RepoConfig {
  remote: string;
  defaultBranch?: string;
  packageManager?: string;
}

export interface ProjectConfig {
  defaults: WorkspaceDefaults;
  repos: Record<string, RepoConfig>;
}

export interface ResolvedRepoConfig {
  name: string;
  remote: string;
  defaultBranch: string;
  packageManager: string;
  branchSanitizer: string;
  barePath: string;
  worktreesRoot: string;
}

// ── Config loading / saving ────────────────────────────────────────────────

export function loadConfig(): ProjectConfig {
  if (!existsSync(CONFIG_PATH)) {
    console.error(`Error: project.config.json not found at ${CONFIG_PATH}`);
    console.error("Please create project.config.json with a repos section.");
    process.exit(1);
  }

  try {
    const content = readFileSync(CONFIG_PATH, "utf-8");
    const config = JSON.parse(content) as ProjectConfig;

    // Validate
    if (!config.repos || Object.keys(config.repos).length === 0) {
      console.error("Error: project.config.json must have at least one entry in 'repos'.");
      process.exit(1);
    }

    for (const [name, repo] of Object.entries(config.repos)) {
      if (!repo.remote || typeof repo.remote !== "string" || repo.remote.trim() === "") {
        console.error(`Error: repos.${name}.remote must be a non-empty string.`);
        process.exit(1);
      }
    }

    // Apply defaults for missing top-level fields
    config.defaults = Object.assign(
      { defaultBranch: "main", packageManager: "pnpm", branchSanitizer: "replace-slash" },
      config.defaults,
    );

    return config;
  } catch (error) {
    console.error("Error: Failed to parse project.config.json");
    console.error((error as Error).message);
    process.exit(1);
  }
}

export function saveConfig(config: ProjectConfig): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

// ── Resolution ─────────────────────────────────────────────────────────────

export function resolveRepoConfig(
  config: ProjectConfig,
  name: string,
): ResolvedRepoConfig {
  const repo = config.repos[name];
  if (!repo) {
    console.error(`Error: repo '${name}' not found in project.config.json`);
    process.exit(1);
  }

  return {
    name,
    remote: repo.remote,
    defaultBranch: repo.defaultBranch ?? config.defaults.defaultBranch,
    packageManager: repo.packageManager ?? config.defaults.packageManager,
    branchSanitizer: config.defaults.branchSanitizer,
    barePath: join(REPOS_ROOT, name, ".bare"),
    worktreesRoot: join(REPOS_ROOT, name, "worktrees"),
  };
}

export function resolveAllRepos(config: ProjectConfig): ResolvedRepoConfig[] {
  return Object.keys(config.repos).map((name) =>
    resolveRepoConfig(config, name),
  );
}
