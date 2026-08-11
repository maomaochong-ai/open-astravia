import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, readlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = join(import.meta.dirname, "..");
const repoRoot = join(desktopRoot, "..", "..");
const cachePath = join(desktopRoot, ".desktop-dev", "workspace-build-cache.json");
const ignoredDirectoryNames = new Set([".git", "dist", "node_modules"]);

export const workspacePackages = {
	"capability-sdk": { dir: "packages/capability-sdk" },
	"capability-runtime": { dir: "packages/capability-runtime" },
	ai: { dir: "packages/ai" },
	"runtime-telemetry": { dir: "packages/runtime-telemetry" },
	"runtime-knowledge": { dir: "packages/runtime-knowledge" },
	"ecosystem-adapter": { dir: "packages/ecosystem-adapter" },
	"action-rpc": { dir: "packages/action-rpc" },
	"runtime-subagents": { dir: "packages/runtime-subagents" },
	toolkit: { dir: "packages/toolkit" },
	"plugin-sdk": { dir: "packages/plugins/plugin-sdk" },
	"plugin-vite": { dir: "packages/plugins/plugin-vite" },
	agent: { dir: "packages/agent" },
	"runtime-core": { dir: "packages/runtime-core" },
	"coding-agent": { dir: "packages/coding-agent" },
	"runtime-tools": { dir: "packages/runtime-tools" },
	"runtime-storage": { dir: "packages/runtime-storage" },
	"runtime-mcp": { dir: "packages/runtime-mcp" },
	"cli-app": { dir: "packages/cli-app" },
};

export const workspaceLayers = [
	[
		"capability-sdk",
		"ai",
		"runtime-telemetry",
		"runtime-knowledge",
		"ecosystem-adapter",
		"action-rpc",
		"runtime-subagents",
		"toolkit",
		"plugin-sdk",
		"plugin-vite",
	],
	["capability-runtime", "agent"],
	["runtime-core"],
	["runtime-mcp"],
	["runtime-tools", "runtime-storage"],
	["coding-agent"],
	["cli-app"],
];

async function hashPath(hash, absolutePath) {
	const entries = await readdir(absolutePath, { withFileTypes: true });
	entries.sort((left, right) => left.name.localeCompare(right.name));

	for (const entry of entries) {
		if (entry.isDirectory() && ignoredDirectoryNames.has(entry.name)) {
			continue;
		}

		const entryPath = join(absolutePath, entry.name);
		const relativePath = relative(repoRoot, entryPath).replaceAll("\\", "/");
		hash.update(relativePath);

		if (entry.isDirectory()) {
			await hashPath(hash, entryPath);
		} else if (entry.isSymbolicLink()) {
			hash.update(await readlink(entryPath));
		} else if (entry.isFile()) {
			hash.update(await readFile(entryPath));
		}
	}
}

async function hashFiles(paths) {
	const hash = createHash("sha256");
	for (const filePath of paths) {
		hash.update(filePath);
		hash.update(await readFile(join(repoRoot, filePath)));
	}
	return hash.digest("hex");
}

async function readCache() {
	try {
		return JSON.parse(await readFile(cachePath, "utf8"));
	} catch {
		return { version: 1, packages: {} };
	}
}

async function resolveWorkspacePackageGraph() {
	const entries = await Promise.all(
		Object.entries(workspacePackages).map(async ([key, config]) => {
			const manifest = JSON.parse(await readFile(join(repoRoot, config.dir, "package.json"), "utf8"));
			return [key, config, manifest];
		}),
	);
	const keysByPackageName = new Map(entries.map(([key, _config, manifest]) => [manifest.name, key]));
	return Object.fromEntries(
		entries.map(([key, config, manifest]) => {
			const productionDependencies = {
				...manifest.dependencies,
				...manifest.optionalDependencies,
			};
			const dependencies = Object.entries(productionDependencies)
				.filter(([_name, range]) => typeof range === "string" && range.startsWith("workspace:"))
				.map(([name]) => keysByPackageName.get(name))
				.filter((name) => name !== undefined);
			return [key, { ...config, dependencies }];
		}),
	);
}

function runBuild(name, packageDir, script = "build") {
	return new Promise((resolve, reject) => {
		console.log(`[workspace-prereqs] 构建 ${name} …`);
		const child = spawn("bun", ["run", script], {
			cwd: join(repoRoot, packageDir),
			stdio: "inherit",
		});
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`${name} 构建失败（code=${code ?? "null"}, signal=${signal ?? "null"}）`));
		});
	});
}

async function main() {
	const force = process.argv.includes("--force");
	const cache = await readCache();
	const nextCache = { version: 1, packages: {} };
	const globalHash = await hashFiles([
		"package.json",
		"bun.lock",
		"tsconfig.base.json",
		"packages/desktop-app/scripts/build-workspace-prereqs.mjs",
	]);
	const buildHashes = new Map();
	const packageGraph = await resolveWorkspacePackageGraph();

	for (const layer of workspaceLayers) {
		await Promise.all(
			layer.map(async (name) => {
				const config = packageGraph[name];
				const sourceHash = createHash("sha256");
				sourceHash.update(globalHash);
				sourceHash.update(config.buildScript ?? "build");
				await hashPath(sourceHash, join(repoRoot, config.dir));
				for (const dependency of config.dependencies) {
					sourceHash.update(buildHashes.get(dependency));
				}
				const buildHash = sourceHash.digest("hex");
				buildHashes.set(name, buildHash);

				const distDir = join(repoRoot, config.dir, "dist");
				const unchanged = !force && existsSync(distDir) && cache.packages?.[name] === buildHash;
				if (unchanged) {
					console.log(`[workspace-prereqs] 跳过 ${name}（无变更）`);
				} else {
					await runBuild(name, config.dir, config.buildScript);
				}
				nextCache.packages[name] = buildHash;
			}),
		);
	}

	await mkdir(dirname(cachePath), { recursive: true });
	await writeFile(cachePath, `${JSON.stringify(nextCache, null, 2)}\n`, "utf8");
	console.log("[workspace-prereqs] workspace 前置构建完成");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main();
}
