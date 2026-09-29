import type { PackageManager, RunnableScript, ScriptProject } from "./model";
import {
	LOCKFILE_MANAGERS,
	MAKEFILE_NAMES,
	makeTargetCommand,
	type PackageJsonInfo,
	packageScriptCommand,
	parseMakefileTargets,
	parsePackageJson,
} from "./parse";

/** 只用到插件 `ctx.fs` 的这两个方法，测试里给一个假的即可。 */
export interface ScriptsFs {
	listFilesRecursive(
		rootPath: string,
		options?: { names?: readonly string[]; ignoredDirectories?: readonly string[] },
	): Promise<readonly { name: string; path: string; relPath: string }[]>;
	readFile(filePath: string): Promise<{ content: string; encoding: "utf8" | "base64" }>;
}

const MANIFEST_NAMES = ["package.json", ...MAKEFILE_NAMES];

/**
 * 宿主默认已经跳过 `node_modules`、`.git`、`dist`、`build` 等；这里再补几个依赖目录，
 * 它们里面的 package.json / Makefile 是第三方的，不是用户要跑的脚本。
 */
const EXTRA_IGNORED_DIRECTORIES = ["vendor", "bower_components", "Pods"];

/** 同时读太多文件会把远程项目的 SSH 通道塞满；清单文件都很小，8 路并发足够。 */
const READ_CONCURRENCY = 8;

interface FoundFile {
	readonly name: string;
	readonly path: string;
	/** 所在目录相对扫描根，`/` 分隔，根目录为空串。 */
	readonly relDir: string;
	readonly dir: string;
}

function splitParent(value: string): string {
	const index = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
	return index < 0 ? "" : value.slice(0, index);
}

function toFoundFile(file: { name: string; path: string; relPath: string }): FoundFile {
	return {
		name: file.name,
		path: file.path,
		relDir: splitParent(file.relPath).replace(/\\/g, "/"),
		dir: splitParent(file.path),
	};
}

function parentRelDir(relDir: string): string | null {
	if (relDir === "") return null;
	const index = relDir.lastIndexOf("/");
	return index < 0 ? "" : relDir.slice(0, index);
}

async function mapLimited<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			const index = next++;
			results[index] = await run(items[index] as T);
		}
	});
	await Promise.all(workers);
	return results;
}

async function readText(fs: ScriptsFs, path: string): Promise<string | null> {
	try {
		const file = await fs.readFile(path);
		return file.encoding === "utf8" ? file.content : null;
	} catch {
		return null;
	}
}

/**
 * 从脚本所在目录往上找包管理器：先看 package.json 的 `packageManager`，再看锁文件；
 * monorepo 里子包通常两样都没有，要用根目录那份。都没有就按 npm。
 */
function resolvePackageManager(
	relDir: string,
	packages: ReadonlyMap<string, PackageJsonInfo>,
	lockfiles: ReadonlyMap<string, PackageManager>,
): PackageManager {
	let current: string | null = relDir;
	while (current !== null) {
		const declared = packages.get(current)?.packageManager;
		if (declared) return declared;
		const locked = lockfiles.get(current);
		if (locked) return locked;
		current = parentRelDir(current);
	}
	return "npm";
}

/**
 * 递归扫出 `root` 下所有带 package.json 或 Makefile 的目录，以及它们能跑的脚本。
 * 没有任何脚本的目录不出现在结果里。
 */
export async function discoverScripts(fs: ScriptsFs, root: string): Promise<ScriptProject[]> {
	const lockfileNames = Object.keys(LOCKFILE_MANAGERS);
	const wanted = new Set([...MANIFEST_NAMES, ...lockfileNames]);
	const listed = await fs.listFilesRecursive(root, {
		names: [...wanted],
		ignoredDirectories: EXTRA_IGNORED_DIRECTORIES,
	});
	// 旧宿主不认识 names，会把所有文件都列出来；这里再筛一次。
	const files = listed.filter((file) => wanted.has(file.name)).map(toFoundFile);

	// 同目录多份锁文件时取表里靠前的那种（按表的顺序遍历），与列举顺序无关。
	const lockfiles = new Map<string, PackageManager>();
	for (const [name, manager] of Object.entries(LOCKFILE_MANAGERS)) {
		for (const file of files) {
			if (file.name === name && !lockfiles.has(file.relDir)) lockfiles.set(file.relDir, manager);
		}
	}

	const manifests = files.filter((file) => MANIFEST_NAMES.includes(file.name));
	const contents = await mapLimited(manifests, READ_CONCURRENCY, (file) => readText(fs, file.path));

	const packages = new Map<string, PackageJsonInfo>();
	const makefiles = new Map<string, { fileName: string; text: string }>();
	manifests.forEach((file, index) => {
		const text = contents[index];
		if (text == null) return;
		if (file.name === "package.json") {
			const info = parsePackageJson(text);
			if (info) packages.set(file.relDir, info);
			return;
		}
		// 同目录有多份 Makefile 时按 make 自己的查找顺序只认第一份。
		const existing = makefiles.get(file.relDir);
		const rank = (name: string) => ["GNUmakefile", "makefile", "Makefile"].indexOf(name);
		if (!existing || rank(file.name) < rank(existing.fileName)) makefiles.set(file.relDir, { fileName: file.name, text });
	});

	const dirs = new Map<string, string>();
	for (const file of manifests) dirs.set(file.relDir, file.dir);

	const projects: ScriptProject[] = [];
	for (const [relDir, dir] of dirs) {
		const info = packages.get(relDir);
		const scripts: RunnableScript[] = [];
		let packageManager: PackageManager | undefined;
		if (info && info.scripts.length > 0) {
			packageManager = resolvePackageManager(relDir, packages, lockfiles);
			for (const script of info.scripts) {
				scripts.push({
					key: `${relDir}\u0000package.json\u0000${script.name}`,
					name: script.name,
					source: "package.json",
					detail: script.body,
					command: packageScriptCommand(packageManager, script.name),
					dir,
				});
			}
		}
		const makefile = makefiles.get(relDir);
		if (makefile) {
			for (const target of parseMakefileTargets(makefile.text)) {
				scripts.push({
					key: `${relDir}\u0000makefile\u0000${target.name}`,
					name: target.name,
					source: "makefile",
					detail: target.description,
					command: makeTargetCommand(makefile.fileName, target.name),
					dir,
				});
			}
		}
		if (scripts.length === 0) continue;
		projects.push({ dir, relDir, packageName: info?.name, packageManager, scripts });
	}
	// 根目录排最前，其余按路径排，同一个 monorepo 分组里的包挨在一起。
	return projects.sort((left, right) => {
		if (left.relDir === "") return -1;
		if (right.relDir === "") return 1;
		return left.relDir.localeCompare(right.relDir);
	});
}
