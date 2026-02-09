# CC Monorepo

A multi-repo workspace manager using git worktrees, designed for Claude Code.

## Architecture

This repository uses a **meta-repo + multi-repo** architecture:

```
cc-monorepo/
├── .git/                           # Meta-repo: tracks orchestration layer
├── orchestration/                  # Tooling (TypeScript)
│   └── src/
│       ├── lib/                    # Shared modules (config, git, deps)
│       ├── bootstrap.ts            # Bootstrap one or all repos
│       ├── create-worktree.ts      # Create worktree for a repo + branch
│       └── repo.ts                 # Add/create/remove/rename/list repos
├── repos/                          # All managed repositories
│   ├── cc-monorepo/
│   │   ├── .bare/                  # Bare git repo
│   │   └── worktrees/
│   │       └── main/               # Default branch worktree
│   └── another-repo/
│       ├── .bare/
│       └── worktrees/
│           └── main/
├── project.config.json             # Multi-repo configuration
└── package.json                    # Root convenience scripts
```

Each managed repository gets its own `repos/<name>/` directory containing a bare clone (`.bare/`) and worktree checkouts (`worktrees/`).

## Getting Started

### Initial Setup

1. Install orchestration dependencies and build:
   ```bash
   cd orchestration
   pnpm install
   pnpm build
   ```

2. Bootstrap all configured repos:
   ```bash
   pnpm bootstrap
   ```

3. Start working in a worktree:
   ```bash
   cd repos/cc-monorepo/worktrees/main
   ```

Bootstrap is idempotent — it skips `pnpm install` if `node_modules` exists. Use `--force-install` to reinstall.

## CLI Commands

### Bootstrap

```bash
pnpm bootstrap                        # Bootstrap all repos
pnpm bootstrap cc-monorepo            # Bootstrap a specific repo
pnpm bootstrap --force-install        # Reinstall dependencies even if node_modules exists
```

### Create Worktree

```bash
pnpm wt cc-monorepo feature/my-feature
```

This will:
1. Fetch latest from remote
2. Create the branch (if it doesn't exist)
3. Create worktree at `repos/cc-monorepo/worktrees/feature__my-feature/`
4. Install dependencies

### Manage Repos

```bash
# Add an existing repo
pnpm repo add other-repo git@github.com:org/other-repo.git
pnpm repo add other-repo git@github.com:org/other-repo.git --default-branch develop --package-manager npm

# Create a new repo from a template
pnpm repo create my-app --template cc-monorepo --remote git@github.com:org/my-app.git
pnpm repo create my-app --template cc-monorepo              # auto-creates GitHub repo via gh
pnpm repo create my-app --template cc-monorepo --public      # create as public GitHub repo
pnpm repo create my-app --template cc-monorepo --default-branch develop --package-manager npm

# Rename a repo
pnpm repo rename old-name new-name

# List all repos and their status
pnpm repo list

# Remove a repo from config
pnpm repo remove other-repo
pnpm repo remove other-repo --clean         # also delete files
pnpm repo remove other-repo --clean --force  # skip confirmation prompt
```

### Removing a Worktree

```bash
git --git-dir repos/cc-monorepo/.bare worktree remove --force repos/cc-monorepo/worktrees/feature__my-feature
```

## Configuration

### project.config.json

```json
{
  "defaults": {
    "defaultBranch": "main",
    "packageManager": "pnpm",
    "branchSanitizer": "replace-slash"
  },
  "repos": {
    "cc-monorepo": {
      "remote": "git@github.com:wvandaal/cc-monorepo.git"
    },
    "other-repo": {
      "remote": "git@github.com:org/other-repo.git",
      "defaultBranch": "develop",
      "packageManager": "npm"
    }
  }
}
```

The map key is the directory name under `repos/`. Each repo inherits from `defaults` and can override `defaultBranch` and `packageManager`.

Supported values for `packageManager`: `pnpm`, `npm`, `yarn`, `none` (skips dependency installation).

## Tech Stack

- **Package Manager**: pnpm with workspaces
- **Build**: TypeScript (`tsc --build` with project references)
- **Linting/Formatting**: BiomeJS
- **Node Version**: 22.x (LTS)
