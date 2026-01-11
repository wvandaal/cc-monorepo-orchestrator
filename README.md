# CC Monorepo

A TypeScript monorepo template using pnpm workspaces, designed for Claude Code and git worktrees.

## Architecture

This repository uses a **two-repo architecture**:

```
cc-monorepo/
├── .git/           # META-REPO: Tracks orchestration layer
├── .bare/          # CODEBASE REPO: Tracks actual code (bare repository)
├── worktrees/      # Worktree checkouts from .bare/
│   └── main/       # Main worktree (default branch)
└── orchestration/  # Meta-level tooling
```

| Component | Git Location | Purpose |
|-----------|--------------|---------|
| Meta-repo | `.git/` | Orchestration, tooling, configuration |
| Codebase | `.bare/` | Actual code, packages, builds |

**The Rule**: "Does this operate ON worktrees or WITHIN a worktree?"
- **ON worktrees** → Goes in orchestration/ (meta-repo)
- **WITHIN a worktree** → Goes in worktrees/main/ (codebase)

## Getting Started

### Initial Setup (after cloning meta-repo)

1. Install orchestration dependencies:
   ```bash
   cd orchestration
   pnpm install
   pnpm build
   ```

2. Run bootstrap to clone codebase and set up main worktree:
   ```bash
   pnpm bootstrap
   ```

3. Start working in the main worktree:
   ```bash
   cd worktrees/main
   ```

Bootstrap is idempotent—it skips `pnpm install` if `node_modules` exists. Use `--force-install` to reinstall.

### Creating a New Worktree

Each feature branch should have its own worktree to avoid context bleed:

```bash
pnpm wt feature/my-feature
```

This will:
1. Fetch latest from remote
2. Create the branch (if it doesn't exist)
3. Create worktree at `worktrees/feature__my-feature/`
4. Install dependencies

### Removing a Worktree

```bash
git --git-dir .bare worktree remove --force worktrees/feature__my-feature
```

## Package Management

Packages are organized by domain: `packages/{domain}/{package}/`

### Creating a New Package

From within a worktree:

```bash
cd worktrees/main
pnpm run create-package utils datetime
```

This creates `@utils/datetime` at `packages/utils/datetime/`.

### Adding Dependencies

```bash
# Add external dependency
pnpm add lodash --filter @utils/datetime

# Add workspace dependency (another package in the monorepo)
pnpm add @utils/datetime --filter @services/api --workspace
```

### Syncing TypeScript References

After adding workspace dependencies, sync the TypeScript project references:

```bash
pnpm run sync-refs
```

## Development Workflow

### Build

```bash
pnpm build              # Build all packages
pnpm build --filter @utils/datetime  # Build specific package
```

### Lint & Format

```bash
pnpm lint               # Check for issues
pnpm lint:fix           # Fix issues
pnpm format             # Format code
```

### Clean

```bash
pnpm clean              # Remove build artifacts
```

## Configuration

### project.config.json

Located at the meta-repo root, contains:

```json
{
  "codebase": {
    "remote": "git@github.com:your-org/your-codebase.git",
    "defaultBranch": "main"
  },
  "worktrees": {
    "root": "worktrees",
    "branchSanitizer": "replace-slash"
  }
}
```

Update `codebase.remote` to point to your actual codebase repository.

## CI/CD Notes

| Environment | Command | Purpose |
|-------------|---------|---------|
| Local | `pnpm install` | Updates lockfile if needed |
| CI | `pnpm install --frozen-lockfile` | Fails if lockfile out of sync |

### Lockfile Conflicts

When merging branches with conflicting `pnpm-lock.yaml`:
1. Resolve conflicts in `package.json` files first
2. Delete the conflicted `pnpm-lock.yaml`
3. Run `pnpm install` to regenerate
4. Commit the new lockfile

## Tech Stack

- **Package Manager**: pnpm with workspaces
- **Build**: TypeScript (`tsc --build` with project references)
- **Linting/Formatting**: BiomeJS
- **Node Version**: 22.x (LTS)
