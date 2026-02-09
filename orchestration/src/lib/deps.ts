import { existsSync } from "node:fs";
import { join } from "node:path";
import { run } from "./git.js";

export function enableCorepack(): void {
  console.log("Enabling corepack...");
  try {
    run("corepack enable");
    console.log("Corepack enabled.");
  } catch (error) {
    console.warn(
      "Warning: Failed to enable corepack. You may need to run 'corepack enable' manually.",
    );
    console.warn((error as Error).message);
  }
}

const KNOWN_PACKAGE_MANAGERS = new Set(["pnpm", "npm", "yarn", "none"]);

export function installDependencies(
  worktreePath: string,
  packageManager: string,
  forceInstall?: boolean,
): void {
  if (packageManager === "none") {
    console.log("Package manager set to 'none', skipping dependency install.");
    return;
  }

  if (!KNOWN_PACKAGE_MANAGERS.has(packageManager)) {
    console.error(
      `Error: Unknown package manager '${packageManager}'. Must be one of: ${[...KNOWN_PACKAGE_MANAGERS].join(", ")}`,
    );
    process.exit(1);
  }

  const nodeModulesPath = join(worktreePath, "node_modules");

  if (existsSync(nodeModulesPath) && !forceInstall) {
    console.log(
      "Dependencies already installed (node_modules exists). Use --force-install to reinstall.",
    );
    return;
  }

  // Only attempt install if there's a package.json
  const packageJsonPath = join(worktreePath, "package.json");
  if (!existsSync(packageJsonPath)) {
    console.log("No package.json found, skipping dependency install.");
    return;
  }

  console.log(`Installing dependencies with ${packageManager}...`);
  try {
    run(`${packageManager} install`, { cwd: worktreePath });
    console.log("Dependencies installed successfully.");
  } catch (error) {
    console.error("Error: Failed to install dependencies.");
    console.error((error as Error).message);
    process.exit(1);
  }
}
