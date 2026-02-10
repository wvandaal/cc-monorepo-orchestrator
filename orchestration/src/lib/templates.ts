import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { TEMPLATES_ROOT, type ProjectConfig } from "./config.js";
import { run } from "./git.js";

// ── Types ──────────────────────────────────────────────────────────────────

export type TemplateSource =
  | { type: "local"; path: string }
  | { type: "remote"; remote: string };

// ── Resolution ─────────────────────────────────────────────────────────────

/**
 * Resolve a --template argument to a TemplateSource.
 *
 * Resolution order:
 * 1. URL (contains "://" or starts with "git@") → remote
 * 2. Bootstrapped local template (templates/<name>/worktrees/<branch>/ exists) → local
 *    The worktree directory name is determined by the template's `ref` config
 *    (defaults to the workspace `defaultBranch`, typically "main").
 * 3. Config entry but not bootstrapped → error
 * 4. Not found → error listing available templates
 */
export function resolveTemplate(
  config: ProjectConfig,
  templateArg: string,
): TemplateSource {
  // 1. URL → ad-hoc remote
  if (templateArg.includes("://") || templateArg.startsWith("git@")) {
    return { type: "remote", remote: templateArg };
  }

  // 2. Bootstrapped local template — resolve the worktree branch from config
  const tplConfig = config.templates?.[templateArg];
  const worktreeBranch = tplConfig?.ref ?? config.defaults.defaultBranch;
  const localWorktree = join(TEMPLATES_ROOT, templateArg, "worktrees", worktreeBranch);
  if (existsSync(localWorktree)) {
    return { type: "local", path: localWorktree };
  }

  // 3. Config entry but not bootstrapped
  if (tplConfig) {
    throw new Error(
      `Error: template '${templateArg}' is configured but not bootstrapped.\nRun \`pnpm bootstrap\` first.`,
    );
  }

  // 4. Not found
  const available = config.templates ? Object.keys(config.templates) : [];
  const listing =
    available.length > 0
      ? `Available templates: ${available.join(", ")}`
      : "No templates configured in project.config.json.";
  throw new Error(
    `Error: template '${templateArg}' not found.\n${listing}`,
  );
}

// ── File copying ───────────────────────────────────────────────────────────

const EXCLUDED_BASENAMES = new Set([".git", "node_modules", "dist"]);

export function templateFileFilter(src: string): boolean {
  const base = basename(src);
  if (EXCLUDED_BASENAMES.has(base)) return false;
  if (base.endsWith(".tsbuildinfo")) return false;
  return true;
}

export function prepareTemplateFiles(
  source: TemplateSource,
  targetDir: string,
): void {
  if (source.type === "local") {
    cpSync(source.path, targetDir, { recursive: true, filter: templateFileFilter });
    return;
  }

  // Remote: shallow clone to temp dir, copy files, clean up
  const cloneDir = mkdtempSync(join(tmpdir(), "template-clone-"));
  try {
    run(["git", "clone", "--depth", "1", source.remote, cloneDir], { silent: true });
    cpSync(cloneDir, targetDir, { recursive: true, filter: templateFileFilter });
  } finally {
    rmSync(cloneDir, { recursive: true, force: true });
  }
}
