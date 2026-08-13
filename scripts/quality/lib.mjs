/**
 * Shared helpers for quality-gate scripts.
 * Keep these dependency-free (Node/Bun built-ins only).
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = process.cwd();

/** Packages that currently ship a `test` script (vitest). */
export const TESTABLE_PACKAGES = {
	ai: "packages/ai",
	agent: "packages/agent",
	"runtime-core": "packages/runtime-core",
	"runtime-mcp": "packages/runtime-mcp",
	"coding-agent": "packages/coding-agent",
	"ecosystem-adapter": "packages/ecosystem-adapter",
	"desktop-app": "packages/desktop-app",
	"plugin-cli": "packages/plugins/plugin-cli",
};

/** Short name → directory for common workspace packages. */
export const PACKAGE_DIRS = {
	...TESTABLE_PACKAGES,
	"capability-sdk": "packages/capability-sdk",
	"capability-runtime": "packages/capability-runtime",
	"desktop-app": "packages/desktop-app",
	"cli-app": "packages/cli-app",
	"plugin-sdk": "packages/plugins/plugin-sdk",
	"plugin-vite": "packages/plugins/plugin-vite",
	"theme-sdk": "packages/theme-sdk",
	"theme-ui": "packages/theme-ui",
	"runtime-core": "packages/runtime-core",
	"runtime-knowledge": "packages/runtime-knowledge",
	"runtime-tools": "packages/runtime-tools",
	"runtime-storage": "packages/runtime-storage",
	"runtime-telemetry": "packages/runtime-telemetry",
	"action-rpc": "packages/action-rpc",
	toolkit: "packages/toolkit",
	markdown: "packages/markdown",
	ui: "packages/ui",
	admin: "packages/admin",
	site: "packages/site",
	api: "packages/api",
	"im-gateway": "packages/im-gateway",
};

export function fail(message) {
	console.error(message);
	process.exitCode = 1;
}

export function ok(message) {
	console.log(message);
}

export function git(args, { allowFail = false } = {}) {
	const result = spawnSync("git", args, {
		cwd: repoRoot,
		encoding: "utf8",
		shell: false,
	});
	if (result.status !== 0 && !allowFail) {
		const err = (result.stderr || result.stdout || "").trim();
		throw new Error(`git ${args.join(" ")} failed: ${err || `exit ${result.status}`}`);
	}
	return (result.stdout || "").trim();
}

export function stagedFiles(gitImpl = git) {
	const out = gitImpl(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], { allowFail: true });
	if (!out) return [];
	return out.split("\0").filter(Boolean);
}

export function changedFiles(baseRef = "origin/dev", gitImpl = git) {
	const mergeBase = gitImpl(["merge-base", "HEAD", baseRef]);
	const committed = gitImpl(["diff", "--name-only", "-z", `${mergeBase}...HEAD`]);
	const workingTree = gitImpl(["diff", "--name-only", "-z", "HEAD"]);
	const untracked = gitImpl(["ls-files", "--others", "--exclude-standard", "-z"]);

	return [committed, workingTree, untracked]
		.flatMap((output) => output.split("\0"))
		.filter(Boolean)
		.filter((file, index, files) => files.indexOf(file) === index)
		.sort();
}

export function parseBaseArgs(args, defaultBase = "origin/dev") {
	let base = defaultBase;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--base") {
			const value = args[i + 1];
			if (!value || value.startsWith("--")) throw new Error("--base requires a git ref");
			base = value;
			i += 1;
			continue;
		}
		if (arg.startsWith("--base=")) {
			base = arg.slice("--base=".length);
			if (!base) throw new Error("--base requires a git ref");
			continue;
		}
		throw new Error(`unknown argument: ${arg}`);
	}
	return { base };
}

export function packagesFromPaths(paths) {
	const found = new Set();
	for (const file of paths) {
		const norm = file.replaceAll("\\", "/");
		if (!norm.startsWith("packages/")) continue;
		const parts = norm.split("/");
		if (parts[1] === "plugins") {
			if (parts[2] === "plugin-sdk") found.add("plugin-sdk");
			else if (parts[2] === "plugin-vite") found.add("plugin-vite");
			else if (parts[2] === "plugin-cli") found.add("plugin-cli");
			else if (parts[2] === "presets" && parts[3]) found.add(`presets/${parts[3]}`);
			else if (parts[2] === "externals" && parts[3]) found.add(`externals/${parts[3]}`);
			continue;
		}
		if (parts[1] === "themes" && parts[2] === "builtin" && parts[3]) {
			found.add(`themes/${parts[3]}`);
			continue;
		}
		if (parts[1]) found.add(parts[1]);
	}
	return [...found].sort();
}

function readPackageMetadata(pkgDir) {
	const packagePath = join(repoRoot, pkgDir, "package.json");
	const json = JSON.parse(readFileSync(packagePath, "utf8"));
	const dependencies = {
		...json.dependencies,
		...json.devDependencies,
		...json.optionalDependencies,
		...json.peerDependencies,
	};
	return { name: json.name, dependencies };
}

/** Include testable packages that depend on any selected testable package. */
export function expandTestablePackages(names) {
	const selected = new Set(names.filter((name) => name in TESTABLE_PACKAGES));
	const metadata = Object.fromEntries(
		Object.entries(TESTABLE_PACKAGES).map(([name, dir]) => [name, readPackageMetadata(dir)]),
	);

	let changed = true;
	while (changed) {
		changed = false;
		const selectedPackageNames = new Set([...selected].map((name) => metadata[name].name));
		for (const [name, pkg] of Object.entries(metadata)) {
			if (selected.has(name)) continue;
			if (Object.keys(pkg.dependencies).some((dependency) => selectedPackageNames.has(dependency))) {
				selected.add(name);
				changed = true;
			}
		}
	}

	return Object.keys(TESTABLE_PACKAGES).filter((name) => selected.has(name));
}

export function walkFiles(dir, { extensions = [".ts", ".tsx", ".js", ".mjs", ".cjs"] } = {}) {
	const results = [];
	if (!existsSync(dir)) return results;

	const stack = [dir];
	while (stack.length > 0) {
		const current = stack.pop();
		let entries;
		try {
			entries = readdirSync(current, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const full = join(current, entry.name);
			if (entry.isDirectory()) {
				// generated / vendor trees — never scan for quality guards
				if (
					entry.name === "node_modules" ||
					entry.name === "dist" ||
					entry.name === ".git" ||
					entry.name === ".next" ||
					entry.name === "coverage" ||
					entry.name === "out" ||
					entry.name === "build" ||
					entry.name === ".turbo" ||
					entry.name === ".cache" ||
					entry.name === "release" ||
					entry.name === "releases"
				) {
					continue;
				}
				stack.push(full);
				continue;
			}
			if (extensions.some((ext) => entry.name.endsWith(ext))) {
				results.push(full);
			}
		}
	}
	return results;
}

export function readText(filePath) {
	return readFileSync(filePath, "utf8");
}

export function toPosix(p) {
	return p.split(sep).join("/");
}

export function rel(filePath) {
	return toPosix(relative(repoRoot, filePath));
}

export function runCommand(command, args, { cwd = repoRoot, env } = {}) {
	const result = spawnSync(command, args, {
		cwd,
		env: env ? { ...process.env, ...env } : process.env,
		stdio: "inherit",
		shell: false,
	});
	return result.status ?? 1;
}

export function runBun(args, options) {
	return runCommand("bun", args, options);
}

export function packageHasTestScript(pkgDir) {
	const pj = join(repoRoot, pkgDir, "package.json");
	if (!existsSync(pj)) return false;
	try {
		const json = JSON.parse(readFileSync(pj, "utf8"));
		return Boolean(json.scripts?.test);
	} catch {
		return false;
	}
}

export function fileSize(filePath) {
	try {
		return statSync(filePath).size;
	} catch {
		return 0;
	}
}

export function isBinaryLike(filePath) {
	const lower = filePath.toLowerCase();
	return (
		lower.endsWith(".png") ||
		lower.endsWith(".jpg") ||
		lower.endsWith(".jpeg") ||
		lower.endsWith(".gif") ||
		lower.endsWith(".webp") ||
		lower.endsWith(".ico") ||
		lower.endsWith(".woff") ||
		lower.endsWith(".woff2") ||
		lower.endsWith(".ttf") ||
		lower.endsWith(".eot") ||
		lower.endsWith(".zip") ||
		lower.endsWith(".gz") ||
		lower.endsWith(".7z") ||
		lower.endsWith(".exe") ||
		lower.endsWith(".dll") ||
		lower.endsWith(".node") ||
		lower.endsWith(".wasm") ||
		lower.endsWith(".mp4") ||
		lower.endsWith(".mp3") ||
		lower.endsWith(".pdf")
	);
}

export function isDirectRun(moduleUrl, argv = process.argv) {
	if (!argv[1]) return false;
	return resolve(argv[1]) === fileURLToPath(moduleUrl);
}
