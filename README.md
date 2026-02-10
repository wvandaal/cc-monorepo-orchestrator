# CC Monorepo

A multi-repo workspace manager using git worktrees, designed for Claude Code.

## Architecture

This repository uses a **meta-repo + multi-repo** architecture:

```
cc-monorepo/
├── .git/                           # Meta-repo: tracks orchestration layer
├── orchestration/                  # Tooling (TypeScript)
│   └── src/
│       ├── lib/                    # Shared modules (config, git, deps, templates)
│       ├── bootstrap.ts            # Bootstrap repos and templates
│       ├── create-worktree.ts      # Create worktree for a repo + branch
│       └── repo.ts                 # Add/create/remove/rename/list repos
├── repos/                          # All managed repositories
│   └── my-app/
│       ├── .bare/                  # Bare git repo
│       └── worktrees/
│           └── main/               # Default branch worktree
├── templates/                      # Template repositories
│   └── cc-monorepo/
│       ├── .bare/
│       └── worktrees/
│           └── main/
├── project.config.json             # Multi-repo configuration
└── package.json                    # Root convenience scripts
```

Each managed repository gets its own `repos/<name>/` directory containing a bare clone (`.bare/`) and worktree checkouts (`worktrees/`). Templates follow the same layout under `templates/`.

## Getting Started

### Initial Setup

1. Install orchestration dependencies and build:
   ```bash
   cd orchestration
   pnpm install
   pnpm build
   ```

2. Bootstrap all configured repos and templates:
   ```bash
   pnpm bootstrap
   ```

3. Create a new repo from a template:
   ```bash
   pnpm repo create my-app --template cc-monorepo --remote git@github.com:org/my-app.git
   ```

Bootstrap is idempotent — it skips `pnpm install` if `node_modules` exists. Use `--force-install` to reinstall. Templates defined in `config.templates` are also bootstrapped.

## CLI Commands

### Bootstrap

```bash
pnpm bootstrap                        # Bootstrap all repos and templates
pnpm bootstrap my-app                 # Bootstrap a specific repo or template by name
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

# Create a new repo from a named template
pnpm repo create my-app --template cc-monorepo --remote git@github.com:org/my-app.git
pnpm repo create my-app --template cc-monorepo              # auto-creates GitHub repo via gh
pnpm repo create my-app --template cc-monorepo --public      # create as public GitHub repo

# Create a new repo from an ad-hoc remote URL
pnpm repo create my-app --template git@github.com:org/template.git --remote git@github.com:org/my-app.git

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
    "my-app": {
      "remote": "git@github.com:org/my-app.git",
      "defaultBranch": "develop",
      "packageManager": "npm"
    }
  },
  "templates": {
    "cc-monorepo": {
      "remote": "git@github.com:wvandaal/cc-monorepo.git"
    }
  }
}
```

The map key is the directory name under `repos/` or `templates/`. Each repo inherits from `defaults` and can override `defaultBranch` and `packageManager`. The `branchSanitizer` setting is global-only and cannot be overridden per-repo.

Supported values for `packageManager`: `pnpm`, `npm`, `yarn`, `none` (skips dependency installation).

## Templates

Templates are independently managed repos stored in `templates/<name>/` using the same bare+worktree layout as regular repos. They are defined in `config.templates` with a `remote` and optional `ref` field, and are bootstrapped automatically via `pnpm bootstrap`. Templates skip dependency installation during bootstrap since they serve only as file sources.

The optional `ref` field controls which branch is checked out during bootstrap (defaults to the workspace `defaultBranch`, typically `"main"`). The worktree directory name matches the ref, e.g. a template with `"ref": "develop"` bootstraps to `templates/<name>/worktrees/develop/`.

Use templates with `repo create`:
- **Named template**: `pnpm repo create my-app --template cc-monorepo` — reads files from the template's bootstrapped worktree
- **Ad-hoc remote URL**: `pnpm repo create my-app --template git@github.com:org/tpl.git` — shallow-clones the remote, copies files, cleans up

## Tech Stack

- **Package Manager**: pnpm with workspaces
- **Build**: TypeScript (`tsc --build` with project references)
- **Linting/Formatting**: BiomeJS
- **Node Version**: 22.x (LTS)
