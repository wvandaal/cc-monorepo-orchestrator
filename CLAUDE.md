# CC Monorepo — Agent Instructions

## What This Is

A meta-repo that orchestrates multiple git repositories using bare clones + worktrees. The orchestration layer (TypeScript CLI) manages repos and templates under `repos/` and `templates/` (both gitignored). See @README.md for user-facing docs.

## Architecture (Key Mental Model)

```
cc-monorepo/          <- meta-repo (this git repo, tracks orchestration)
├── orchestration/    <- TypeScript CLI tools (bootstrap, repo, worktree)
│   └── src/lib/      <- shared modules: config, git, deps, templates
├── repos/            <- managed repos (gitignored, bare+worktree layout)
├── templates/        <- template repos (gitignored, same layout as repos)
└── project.config.json  <- declares repos + templates with remotes
```

Each managed repo: `repos/<name>/.bare/` (bare clone) + `repos/<name>/worktrees/main/` (checkout).
Templates follow the same layout under `templates/` but skip dependency installation.

## Build & Run Commands

```bash
# Build orchestration (MUST do after changing .ts files)
cd orchestration && pnpm install && pnpm build

# CLI commands (run from repo root)
pnpm bootstrap                    # Bootstrap all repos + templates
pnpm bootstrap <name>             # Bootstrap specific repo or template
pnpm repo create <n> --template <t> --remote <url>  # Create repo from template
pnpm repo add <name> <remote>     # Add existing repo
pnpm repo list                    # List repos and status
pnpm wt <repo> <branch>           # Create worktree for branch
```

## Code Conventions

- **TypeScript strict mode**, ES2022 target, NodeNext modules (ESM with `.js` extensions in imports)
- **Biome** handles linting and formatting — do NOT manually enforce style rules; run `biome check .` to verify
- MUST use `execFileSync` with argument arrays for shell commands — NEVER `execSync` with string interpolation (shell injection risk)
- The `run()` helper in `lib/git.ts` takes `string[]` args, not a command string
- Validate user-provided names against `/^[A-Za-z0-9._-]+$/` before filesystem use
- `META_REPO_ROOT` resolves from compiled output location (`dist/lib/` -> `../../..`). If file structure changes, this path breaks.

## Key Design Decisions

- **Templates are not repos.** They live in `config.templates` with `packageManager: "none"`. They exist solely as file sources for `repo create`.
- **Template `ref` field** controls which branch is checked out (defaults to `defaults.defaultBranch`). The worktree directory name matches the ref.
- **`resolveTemplate()` resolution order:** URL detection -> local worktree check -> config-but-not-bootstrapped error -> not-found error with available list.
- **`rewritePointerFiles()` uses read-all-then-write-all** to minimize partial-state risk during repo rename.
- **`branchExists()` inspects exit codes** — exit 1 = ref not found (expected), anything else propagates as an error.
- **Error handling pattern:** Prefer specific error messages with context (command, exit code, path) over bare catch blocks. Never silently discard errors.

## Common Gotchas

- `repos/` and `templates/` are gitignored — never try to commit files inside them
- After changing orchestration TypeScript, you MUST run `pnpm build` before testing — the CLI runs from `dist/`, not `src/`
- `loadConfig()` requires at least one entry in `repos` OR `templates` (not both)
- Template bootstrap skips `pnpm install` by design (packageManager = "none")
- The `branchSanitizer` config is global-only — cannot be overridden per-repo

## Issue Tracking (Beads)

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
```

## Session Completion — MANDATORY

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

1. **File issues** for remaining work (`bd create`)
2. **Run quality gates** if code changed: `cd orchestration && pnpm build`
3. **Close finished issues**: `bd close <id1> <id2> ...`
4. **Push to remote** — this is MANDATORY:
   ```bash
   git pull --rebase && bd sync && git push
   git status  # MUST show "up to date with origin"
   ```
5. **Verify** — all changes committed AND pushed

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing — that leaves work stranded locally
- NEVER say "ready to push when you are" — YOU must push
- If push fails, resolve and retry until it succeeds

## Compact Instructions

When compacting context, preserve: list of modified files, build/test output, current issue IDs being worked on, and any error messages being debugged.
