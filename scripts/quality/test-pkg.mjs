/**
 * Run tests for one or more packages by short name.
 *
 * Usage:
 *   bun run test:pkg ai
 *   bun run test:pkg coding-agent ecosystem-adapter
 *   bun run test:pkg --list
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	buildableTestDependencies,
	fail,
	ok,
	PACKAGE_DIRS,
	packageHasTestScript,
	repoRoot,
	runBun,
	TESTABLE_PACKAGES,
} from "./lib.mjs";

const args = process.argv.slice(2).filter((a) => a !== "--");
const runAll = args.includes("--all");

if (args.includes("--list") || args.includes("-l") || (args.length === 0 && !runAll)) {
	console.log("Testable packages:");
	for (const [name, dir] of Object.entries(TESTABLE_PACKAGES)) {
		console.log(`  ${name.padEnd(22)} ${dir}`);
	}
	console.log("\nUsage: bun run test:pkg <name> [name...]");
	if (args.length === 0) process.exit(args.includes("--list") || args.includes("-l") ? 0 : 1);
	process.exit(0);
}

const names = runAll ? Object.keys(TESTABLE_PACKAGES) : args.filter((a) => !a.startsWith("-"));
let failed = 0;

const buildDependencies = buildableTestDependencies(names);
if (buildDependencies.length > 0) {
	ok(`[test:pkg] building workspace dependencies: ${buildDependencies.join(", ")}`);
	const buildCode = runBun([
		"x",
		"turbo",
		"run",
		"build",
		"--summarize",
		...buildDependencies.map((packageName) => `--filter=${packageName}`),
	]);
	if (buildCode !== 0) process.exit(buildCode);
}

for (const name of names) {
	const dir = TESTABLE_PACKAGES[name] || PACKAGE_DIRS[name];
	if (!dir) {
		fail(`[test:pkg] unknown package "${name}". Use --list.`);
		failed = 1;
		continue;
	}
	const abs = join(repoRoot, dir);
	if (!existsSync(abs)) {
		fail(`[test:pkg] missing directory ${dir}`);
		failed = 1;
		continue;
	}
	if (!packageHasTestScript(dir)) {
		fail(`[test:pkg] ${name} (${dir}) has no "test" script`);
		failed = 1;
		continue;
	}
	ok(`[test:pkg] ${name} → ${dir}`);
	const code = runBun(["run", "test"], { cwd: abs });
	if (code !== 0) failed = code;
}

process.exit(failed);
