import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, readlink, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

const desktopRoot = join(import.meta.dirname, "..");
const repoRoot = join(desktopRoot, "..", "..");
const cachePath = join(desktopRoot, ".desktop-dev", "dev-process-build-cache.json");
const force = process.argv.includes("--force");

// 版本号只影响窗口标题与「关于」页，不打进任何构建产物；但 bun.lock 和
// apps/desktop/package.json 是四个任务共同的输入，整份内容参与哈希，于是每升一次
// 版本号（每个 release 都升）启动开发壳就会全量重建四个任务，main 一个人要十几分钟。
// 这里只抹掉这两份文件里 workspace 自身的 version，依赖版本逐个照常参与。
const versionAgnosticInputs = new Map([
	[
		join(repoRoot, "bun.lock"),
		(text) => text.replace(/("name": "@astravia\/desktop",\s*"version": ")[^"]+(")/, "$1$2"),
	],
	[join(desktopRoot, "package.json"), (text) => JSON.stringify({ ...JSON.parse(text), version: undefined })],
]);

// dev 壳经常和正式壳一起开。四个 vite build 并发时会把整机的响应性吃满，
// 所以构建子进程降一级调度优先级：产物不变，只是不再和前台抢 CPU。
const nicedSpawn = process.platform === "win32";
function spawnBun(args, options) {
	return nicedSpawn ? spawn("bun", args, options) : spawn("nice", ["-n", "10", "bun", ...args], options);
}

// 同时最多两个构建任务。串行会明显变慢，四个并发会明显变卡，两个是两者的折中；
// 需要抢时间时用 ASTRAVIA_DEV_BUILD_CONCURRENCY 调高。
const buildConcurrency = Math.max(1, Number(process.env.ASTRAVIA_DEV_BUILD_CONCURRENCY) || 2);

async function runWithConcurrency(items, limit, worker) {
	let cursor = 0;
	const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (cursor < items.length) {
			const index = cursor;
			cursor += 1;
			await worker(items[index]);
		}
	});
	await Promise.all(runners);
}

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

const developmentEnv = { ...process.env, ASTRAVIA_BUILD_ENV: "development" };

// 与 vite.main.config.ts 的 developmentWorkspacePackages 保持一致：这些包在 dev 下是 external，
// 运行时直接读各自 dist，改动无需重打主进程；其余 workspace 包都会被打进主进程 bundle。
const mainExternalWorkspacePackages = new Set(["action-rpc", "ai", "coding-agent", "remote-control", "runtime-core"]);

// 主进程 bundle 的 workspace 依赖逐个手写登记容易漏（曾漏掉 runtime-storage，改了 Schema 重启仍跑旧代码），
// 因此按 packages/* 目录全量登记被打包的包。
const mainBundledWorkspaceInputs = (await readdir(join(repoRoot, "packages"), { withFileTypes: true }))
	.filter((entry) => entry.isDirectory() && !mainExternalWorkspacePackages.has(entry.name))
	.sort((left, right) => left.name.localeCompare(right.name))
	.flatMap((entry) => [
		join(repoRoot, "packages", entry.name, "package.json"),
		join(repoRoot, "packages", entry.name, "dist"),
	]);
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
			...mainBundledWorkspaceInputs,
			join(repoRoot, "packages", "plugins", "plugin-sdk", "package.json"),
			join(repoRoot, "packages", "plugins", "plugin-sdk", "dist"),
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
		const normalizer = versionAgnosticInputs.get(path);
		hash.update(normalizer ? normalizer(await readFile(path, "utf8")) : await readFile(path));
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
	for (const [key, value] of Object.entries(env).filter(([key]) => key.startsWith("ASTRAVIA_")).sort()) {
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
		const child = spawnBun(task.command, {
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

	await runWithConcurrency(pending, buildConcurrency, runTask);
	console.log(`[build-dev-processes] 并发上限 ${buildConcurrency}`);
	for (const task of pending) {
		const outputHash = await hashOutput(task.outputDir);
		if (outputHash === null) throw new Error(`${task.name} 构建成功但没有生成产物：${task.outputDir}`);
		nextCache.tasks[task.name] = { inputHash: task.inputHash, outputHash };
	}

	await writeCache(nextCache);
	console.log(`[build-dev-processes] 完成，构建 ${pending.length}/${tasks.length} 个任务`);
}

await main();
