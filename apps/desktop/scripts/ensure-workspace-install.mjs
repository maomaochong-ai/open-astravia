import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

// 拉下大批改动后依赖清单常常变了，dev 只编译不装包会直接起不来。
// 这里按依赖清单指纹判断是否需要 bun install，无变化时跳过，避免每次启动多等数秒。
const defaultRepoRoot = join(import.meta.dirname, "..", "..", "..");
const stampName = ".vetta-install-stamp";

async function expandWorkspace(repoRoot, pattern) {
	if (!pattern.endsWith("/*")) return [pattern];
	const parent = pattern.slice(0, -2);
	const entries = await readdir(join(repoRoot, parent), { withFileTypes: true }).catch(() => []);
	return entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => `${parent}/${entry.name}`)
		.sort();
}

export async function resolveInstallManifests(repoRoot = defaultRepoRoot) {
	const rootManifest = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
	const manifests = [join(repoRoot, "bun.lock"), join(repoRoot, "package.json")];
	for (const pattern of rootManifest.workspaces ?? []) {
		for (const workspace of await expandWorkspace(repoRoot, pattern)) {
			const manifest = join(repoRoot, workspace, "package.json");
			if (existsSync(manifest)) manifests.push(manifest);
		}
	}
	return manifests;
}

export async function computeInstallFingerprint(repoRoot = defaultRepoRoot) {
	const hash = createHash("sha256");
	for (const path of await resolveInstallManifests(repoRoot)) {
		hash.update(relative(repoRoot, path).replaceAll("\\", "/"));
		hash.update(existsSync(path) ? await readFile(path) : "missing");
	}
	return hash.digest("hex");
}

// 指纹存进 node_modules，删掉 node_modules 时自然失效。
export function resolveStampPath(repoRoot = defaultRepoRoot) {
	return join(repoRoot, "node_modules", stampName);
}

export async function isInstallFresh(repoRoot = defaultRepoRoot) {
	try {
		const stamp = await readFile(resolveStampPath(repoRoot), "utf8");
		return stamp.trim() === (await computeInstallFingerprint(repoRoot));
	} catch {
		return false;
	}
}

function runInstall(repoRoot) {
	return new Promise((resolve, reject) => {
		const child = spawn("bun", ["install"], { cwd: repoRoot, stdio: "inherit" });
		child.once("error", reject);
		child.once("exit", (code) =>
			code === 0 ? resolve() : reject(new Error(`bun install 失败（code=${code}）`)),
		);
	});
}

async function main() {
	const repoRoot = defaultRepoRoot;
	if (!process.argv.includes("--force") && (await isInstallFresh(repoRoot))) {
		console.log("[ensure-workspace-install] 依赖清单无变化，跳过 bun install");
		return;
	}
	console.log("[ensure-workspace-install] 依赖清单有变化，执行 bun install …");
	await runInstall(repoRoot);
	// bun install 可能改写 bun.lock，指纹要在安装之后再算。
	const stampPath = resolveStampPath(repoRoot);
	await mkdir(dirname(stampPath), { recursive: true });
	await writeFile(stampPath, `${await computeInstallFingerprint(repoRoot)}\n`, "utf8");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	main().catch((error) => {
		console.error(`[ensure-workspace-install] ${error instanceof Error ? error.message : error}`);
		process.exit(1);
	});
}
