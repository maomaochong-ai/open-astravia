import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, readlink, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

const desktopRoot = join(import.meta.dirname, "..");
const repoRoot = join(desktopRoot, "..", "..");
const cachePath = join(desktopRoot, ".desktop-dev", "dev-process-build-cache.json");
const force = process.argv.includes("--force");

const commonInputs = [
	join(repoRoot, "bun.lock"),
	join(repoRoot, "tsconfig.base.json"),
	join(desktopRoot, "package.json"),
	join(desktopRoot, "tsconfig.json"),
	join(desktopRoot, "scripts", "build-dev-processes.mjs"),
];
const envInputs = [
	join(desktopRoot, ".env"),
	join(desktopRoot, ".env.local"),
	join(desktopRoot, ".env.development"),
	join(desktopRoot, ".env.development.local"),
];

const developmentEnv = { ...process.env, VETTA_BUILD_ENV: "development" };
const tasks = [
	{
		name: "preload",
		command: ["run", "build:preload"],
		env: developmentEnv,
		inputs: [
			...commonInputs,
			...envInputs,
			join(desktopRoot, "sentry-vite.ts"),
			join(desktopRoot, "vite.preload.config.ts"),
			join(desktopRoot, "src", "preload"),
			join(desktopRoot, "src", "shared"),
		],
		outputDir: join(desktopRoot, "dist", "preload"),
	},
	{
		name: "ocr-preload",
		command: ["run", "build:ocr-preload"],
		env: process.env,
		inputs: [
			...commonInputs,
			join(desktopRoot, "vite.ocr-preload.config.ts"),
			join(desktopRoot, "src", "preload", "ocr.ts"),
		],
		outputDir: join(desktopRoot, "dist", "ocr-preload"),
	},
	{
		name: "ocr-runner",
		command: ["run", "build:ocr-runner"],
		env: process.env,
		inputs: [
			...commonInputs,
			join(desktopRoot, "vite.ocr-runner.config.ts"),
			join(desktopRoot, "src", "renderer-ocr"),
			join(desktopRoot, "resources", "ocr-models"),
		],
		outputDir: join(desktopRoot, "dist", "ocr-runner"),
	},
	{
		name: "main",
		command: ["run", "build:main"],
		env: developmentEnv,
		inputs: [
			...commonInputs,
			...envInputs,
			join(desktopRoot, "sentry-vite.ts"),
			join(desktopRoot, "vite.main.config.ts"),
			join(desktopRoot, "src", "main"),
			join(desktopRoot, "src", "shared"),
			join(repoRoot, "packages", "capability-runtime", "package.json"),
			join(repoRoot, "packages", "capability-runtime", "dist"),
			join(repoRoot, "packages", "capability-sdk", "package.json"),
			join(repoRoot, "packages", "capability-sdk", "dist"),
			join(repoRoot, "packages", "plugins", "plugin-sdk", "package.json"),
			join(repoRoot, "packages", "plugins", "plugin-sdk", "dist"),
			join(repoRoot, "packages", "toolkit", "package.json"),
			join(repoRoot, "packages", "toolkit", "src"),
		],
		outputDir: join(desktopRoot, "dist", "main"),
	},
];

async function updateHashWithPath(hash, path) {
	const marker = relative(repoRoot, path).replaceAll("\\", "/");
	hash.update(marker);
	if (!existsSync(path)) {
		hash.update("missing");
		return;
	}

	const pathStat = await stat(path);
	if (pathStat.isFile()) {
		hash.update(await readFile(path));
		return;
	}

	const entries = await readdir(path, { withFileTypes: true });
	entries.sort((left, right) => left.name.localeCompare(right.name));
	for (const entry of entries) {
		const entryPath = join(path, entry.name);
		hash.update(entry.name);
		if (entry.isDirectory()) {
			await updateHashWithPath(hash, entryPath);
		} else if (entry.isSymbolicLink()) {
			hash.update(await readlink(entryPath));
		} else if (entry.isFile()) {
			hash.update(await readFile(entryPath));
		}
	}
}

async function hashPaths(paths, env) {
	const hash = createHash("sha256");
	for (const path of paths) await updateHashWithPath(hash, path);
	for (const [key, value] of Object.entries(env).filter(([key]) => key.startsWith("VETTA_")).sort()) {
		hash.update(key);
		hash.update(value ?? "");
	}
	return hash.digest("hex");
}

async function hashOutput(path) {
	if (!existsSync(path)) return null;
	const entries = await readdir(path);
	if (entries.length === 0) return null;
	const hash = createHash("sha256");
	await updateHashWithPath(hash, path);
	return hash.digest("hex");
}

async function readCache() {
	try {
		const cache = JSON.parse(await readFile(cachePath, "utf8"));
		return cache.version === 1 ? cache : { version: 1, tasks: {} };
	} catch {
		return { version: 1, tasks: {} };
	}
}

async function writeCache(cache) {
	await mkdir(dirname(cachePath), { recursive: true });
	const tempPath = `${cachePath}.${process.pid}.tmp`;
	await writeFile(tempPath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
	await rm(cachePath, { force: true });
	await rename(tempPath, cachePath);
}

const activeChildren = new Set();
function runTask(task) {
	return new Promise((resolve, reject) => {
		console.log(`[build-dev-processes] 构建 ${task.name} …`);
		const child = spawn("bun", task.command, {
			cwd: desktopRoot,
			env: task.env,
			stdio: "inherit",
		});
		activeChildren.add(child);
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			activeChildren.delete(child);
			if (code === 0) {
				resolve();
				return;
			}
			for (const sibling of activeChildren) sibling.kill("SIGTERM");
			reject(new Error(`${task.name} 构建失败（code=${code ?? "null"}, signal=${signal ?? "null"}）`));
		});
	});
}

async function main() {
	for (const task of [
		{ command: "prepare:ocr-models", label: "OCR 模型" },
		{ command: "prepare:speech-models", label: "语音模型" },
	]) {
		await new Promise((resolve, reject) => {
			const child = spawn("bun", ["run", task.command], {
				cwd: desktopRoot,
				stdio: "inherit",
			});
			child.once("error", reject);
			child.once("exit", (code) =>
				code === 0 ? resolve() : reject(new Error(`${task.label}准备失败（code=${code}）`)),
			);
		});
	}

	const cache = await readCache();
	const nextCache = { version: 1, tasks: {} };
	const pending = [];

	for (const task of tasks) {
		const inputHash = await hashPaths(task.inputs, task.env);
		const outputHash = await hashOutput(task.outputDir);
		const cached = cache.tasks?.[task.name];
		if (!force && outputHash !== null && cached?.inputHash === inputHash && cached.outputHash === outputHash) {
			console.log(`[build-dev-processes] 跳过 ${task.name}（无变更）`);
			nextCache.tasks[task.name] = cached;
			continue;
		}
		pending.push({ ...task, inputHash });
	}

	await Promise.all(pending.map(runTask));
	for (const task of pending) {
		const outputHash = await hashOutput(task.outputDir);
		if (outputHash === null) throw new Error(`${task.name} 构建成功但没有生成产物：${task.outputDir}`);
		nextCache.tasks[task.name] = { inputHash: task.inputHash, outputHash };
	}

	await writeCache(nextCache);
	console.log(`[build-dev-processes] 完成，构建 ${pending.length}/${tasks.length} 个任务`);
}

await main();
