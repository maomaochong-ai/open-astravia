/**
 * Shared helpers for quality-gate scripts.
 * Keep these dependency-free (Node/Bun built-ins only).
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = process.cwd();

function workspaceKey(directory) {
	const parts = directory.replaceAll("\\", "/").split("/");
	if (parts[0] === "packages" && parts[1] === "plugins") {
		if ((parts[2] === "presets" || parts[2] === "externals") && parts[3]) {
			return `${parts[2]}/${parts[3]}`;
		}
		return parts[2];
	}
	if (parts[0] === "packages" && parts[1] === "themes" && parts[2] === "builtin" && parts[3]) {
		return `themes/${parts[3]}`;
	}
	return parts.length > 2 ? parts.slice(1).join("/") : parts[1];
}

function expandWorkspacePattern(pattern, root = repoRoot) {
	const normalized = pattern.replaceAll("\\", "/");
	if (!normalized.includes("*")) return [normalized];
	const segments = normalized.split("/");
	let directories = [""];
	for (const segment of segments) {
		if (segment !== "*") {
			directories = directories.map((directory) => (directory ? `${directory}/${segment}` : segment));
			continue;
		}
		directories = directories.flatMap((directory) => {
			const absolute = join(root, directory);
			if (!existsSync(absolute)) return [];
			return readdirSync(absolute, { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.map((entry) => `${directory}/${entry.name}`)
				.sort();
		});
	}
	return directories;
}

/** Workspace manifests are the single source of truth for package discovery and dependency propagation. */
export function discoverWorkspacePackages(root = repoRoot) {
	const rootManifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	const packages = [];
	const keys = new Set();
	for (const pattern of rootManifest.workspaces ?? []) {
		for (const dir of expandWorkspacePattern(pattern, root)) {
			const packagePath = join(root, dir, "package.json");
			if (!existsSync(packagePath)) continue;
			const manifest = JSON.parse(readFileSync(packagePath, "utf8"));
			const key = workspaceKey(dir);
			if (!key || keys.has(key)) throw new Error(`duplicate or invalid workspace key for ${dir}: ${key ?? ""}`);
			keys.add(key);
			packages.push({
				key,
				dir,
				name: manifest.name,
				scripts: manifest.scripts ?? {},
				dependencies: {
					...manifest.dependencies,
					...manifest.devDependencies,
					...manifest.optionalDependencies,
					...manifest.peerDependencies,
				},
			});
		}
	}
	return packages;
}

export const WORKSPACE_PACKAGES = discoverWorkspacePackages();

/** Every workspace that declares a `test` script, derived rather than manually registered. */
export const TESTABLE_PACKAGES = Object.fromEntries(
	WORKSPACE_PACKAGES.filter((pkg) => Boolean(pkg.scripts.test)).map((pkg) => [pkg.key, pkg.dir]),
);

/** Short name → directory for common workspace packages. */
export const PACKAGE_DIRS = {
	...Object.fromEntries(WORKSPACE_PACKAGES.map((pkg) => [pkg.key, pkg.dir])),
	"im-gateway": "apps/im-gateway",
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
	const workspacesBySpecificity = [...WORKSPACE_PACKAGES].sort((left, right) => right.dir.length - left.dir.length);
	for (const file of paths) {
		const norm = file.replaceAll("\\", "/");
		if (!norm.startsWith("packages/") && !norm.startsWith("apps/")) continue;
		const workspace = workspacesBySpecificity.find(({ dir }) => norm === dir || norm.startsWith(`${dir}/`));
		if (workspace) found.add(workspace.key);
	}
	return [...found].sort();
}

/** Include testable packages that transitively depend on any selected workspace package. */
export function expandTestablePackages(names) {
	const metadata = Object.fromEntries(WORKSPACE_PACKAGES.map((pkg) => [pkg.key, pkg]));
	const selected = new Set(names.filter((name) => name in metadata));

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

/** Buildable workspace dependencies whose package exports may be consumed by the selected tests. */
export function buildableTestDependencies(names, packages = WORKSPACE_PACKAGES) {
	const byKey = new Map(packages.map((pkg) => [pkg.key, pkg]));
	const byPackageName = new Map(packages.map((pkg) => [pkg.name, pkg]));
	const queue = names.map((name) => byKey.get(name)).filter(Boolean);
	const traversed = new Set(queue.map((pkg) => pkg.key));
	const required = new Set();

	for (let index = 0; index < queue.length; index += 1) {
		const pkg = queue[index];
		for (const dependencyName of Object.keys(pkg.dependencies)) {
			const dependency = byPackageName.get(dependencyName);
			if (!dependency) continue;
			required.add(dependency.key);
			if (traversed.has(dependency.key)) continue;
			traversed.add(dependency.key);
			queue.push(dependency);
		}
	}

	return packages.filter((pkg) => required.has(pkg.key) && Boolean(pkg.scripts.build)).map((pkg) => pkg.name);
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
