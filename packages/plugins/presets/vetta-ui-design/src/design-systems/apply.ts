import type { PluginFsApi } from "@vetta-org/plugin-sdk";
import { ensureDesignIgnored } from "../vetd/design-ignore";
import { manifestPathOf, type VetdManifest } from "../vetd/manifest-types";
import { designSystemById } from "./index";
import type { DesignSystem } from "./types";

/** 条目没写出处时的默认归属：资源仓库里那批的上游。 */
const DEFAULT_SYSTEM_SOURCE = "https://github.com/VoltAgent/awesome-design-md";

/**
 * 应用前的整包备份目录（固定路径，只留最近一份——新应用直接覆盖旧备份）。
 * 放在 .snapshots/ 下：引擎与画布的文件监听都跳过点开头目录，备份里的 tsx
 * 不会被当成 frame 编译（engine/vite.config.mjs 与 GENERATED_PREFIXES）。
 */
const BACKUP_DIR = ".snapshots/design-system-backup";

/** 备份/还原覆盖的文件范围：体系应用与全量重设会动到的所有源码。 */
const BACKUP_SCOPES = ["theme.css", "DESIGN.md", "frames/", "components/"];

export interface ApplyResult {
	/** direct = 零 frame，theme.css 已直写；restyle = 已落 DESIGN.md，等 agent 全量重设。 */
	mode: "direct" | "restyle";
	frames: { id: string; file: string; title: string }[];
	vetdPath: string;
	dirPath: string;
}

/** DESIGN.md 带 frontmatter 的完整产物（`system:` 同时是「当前已应用体系」的状态源）。 */
export function designMdWithFrontmatter(system: DesignSystem): string {
	return [
		"---",
		`system: ${system.id}`,
		`name: ${system.name}`,
		// 条目自带出处与许可时以它为准，没写才回落到默认归属。
		`source: ${system.source ?? DEFAULT_SYSTEM_SOURCE}`,
		`license: ${system.license ?? "MIT"}`,
		"---",
		"",
		system.designMd,
	].join("\n");
}

/** 读 DESIGN.md frontmatter 里的 `system:`；没有该文件或没写过体系时为 null。 */
export async function readAppliedSystemId(fs: PluginFsApi, dirPath: string): Promise<string | null> {
	try {
		const raw = (await fs.readFile(`${dirPath}/DESIGN.md`)).content;
		const frontmatter = /^---\n([\s\S]*?)\n---/.exec(raw);
		if (!frontmatter) return null;
		const system = /(?:^|\n)system:\s*(\S+)/.exec(frontmatter[1]);
		return system ? system[1] : null;
	} catch {
		return null;
	}
}

export async function designMdExists(fs: PluginFsApi, dirPath: string): Promise<boolean> {
	return (await fs.stat(`${dirPath}/DESIGN.md`)) !== null;
}

function inBackupScope(relPath: string): boolean {
	return BACKUP_SCOPES.some((scope) => (scope.endsWith("/") ? relPath.startsWith(scope) : relPath === scope));
}

/** 备份范围内的现有源码文件（相对路径，正斜杠）。 */
async function listScopedFiles(fs: PluginFsApi, dirPath: string): Promise<string[]> {
	const files = await fs.listFilesRecursive(dirPath).catch(() => []);
	return files.map((file) => file.relPath.replaceAll("\\", "/")).filter(inBackupScope);
}

/**
 * 应用前整包备份 theme.css / DESIGN.md / frames / components 到固定备份目录。
 * 只留最近一份：先清掉旧备份再拷。体积是纯文本源码，逐文件 read/write 足够。
 */
export async function snapshotBeforeApply(fs: PluginFsApi, dirPath: string): Promise<void> {
	const backupRoot = `${dirPath}/${BACKUP_DIR}`;
	const stale = await fs.listFilesRecursive(backupRoot).catch(() => []);
	for (const file of stale) {
		await fs.delete(file.path).catch(() => {});
	}
	await fs.createDirectory(backupRoot);
	for (const relPath of await listScopedFiles(fs, dirPath)) {
		const { content } = await fs.readFile(`${dirPath}/${relPath}`);
		const target = `${backupRoot}/${relPath}`;
		const parent = target.slice(0, target.lastIndexOf("/"));
		await fs.createDirectory(parent);
		await fs.writeFile(target, content);
	}
	await ensureDesignIgnored(fs, dirPath);
}

export async function hasBackup(fs: PluginFsApi, dirPath: string): Promise<boolean> {
	const files = await fs.listFilesRecursive(`${dirPath}/${BACKUP_DIR}`).catch(() => []);
	return files.length > 0;
}

/**
 * 一键还原到上一次应用前：备份范围内先删后拷（应用后新增的 frame 会被删掉，
 * 被改掉的会回到备份时的内容）。manifest 不还原——frame 集变化由 reconcile
 * 自己对账，位置本来就归画布。
 */
export async function restoreBackup(fs: PluginFsApi, dirPath: string): Promise<void> {
	const backupRoot = `${dirPath}/${BACKUP_DIR}`;
	const backup = await fs.listFilesRecursive(backupRoot).catch(() => []);
	if (backup.length === 0) throw new Error("no design-system backup to restore");
	for (const relPath of await listScopedFiles(fs, dirPath)) {
		await fs.delete(`${dirPath}/${relPath}`).catch(() => {});
	}
	for (const file of backup) {
		const relPath = file.relPath.replaceAll("\\", "/");
		const { content } = await fs.readFile(file.path);
		const target = `${dirPath}/${relPath}`;
		const parent = target.slice(0, target.lastIndexOf("/"));
		await fs.createDirectory(parent);
		await fs.writeFile(target, content);
	}
}

/**
 * 应用一个设计体系（唯一实现，画布的体系抽屉与侧边栏风格库共用）：
 *
 * 1. 整包备份（快照兜底，不可逆操作前的安全网）；
 * 2. 写 DESIGN.md（永远插件直写——没有东西「引用」它，覆盖无损；frontmatter
 *    即状态）；
 * 3. 分支只看 frames.length：零 frame 时 theme.css 也直写（手工调好的色值
 *    不经模型转写，保真）；有 frame 时 theme.css 与页面交给 agent 按 DESIGN.md
 *    全量重设（调用方负责发指令）。
 */
export async function applyDesignSystem(fs: PluginFsApi, vetdPath: string, systemId: string): Promise<ApplyResult> {
	const system = designSystemById(systemId);
	if (!system) throw new Error(`unknown design system "${systemId}"`);
	const dirPath = vetdPath;
	const manifest = JSON.parse((await fs.readFile(manifestPathOf(vetdPath))).content) as VetdManifest;
	const frames = (manifest.frames ?? []).map((frame) => ({
		id: frame.id,
		file: frame.file,
		title: frame.title || frame.id,
	}));

	await snapshotBeforeApply(fs, dirPath);
	await fs.writeFile(`${dirPath}/DESIGN.md`, designMdWithFrontmatter(system));
	if (frames.length === 0) {
		await fs.writeFile(`${dirPath}/theme.css`, system.themeCss);
		return { mode: "direct", frames, vetdPath, dirPath };
	}
	return { mode: "restyle", frames, vetdPath, dirPath };
}

/**
 * 有 frame 时发给 agent 的全量重设指令（画布的体系抽屉用 sendPrompt 发出）。
 * 体系全文不进 prompt——DESIGN.md 已落盘，
 * agent 自己 Read，这正是 SKILL.md 里 DESIGN.md 优先级约定的用法。
 * 语言跟宿主 locale（与 ask-vetta 同一取舍：协议串不进 locales catalog）。
 */
export function buildRestylePrompt(system: DesignSystem, result: ApplyResult, locale: string): string {
	const frameList = result.frames.map((frame) => `${frame.id}（${frame.title}）`).join("、");
	if (locale.toLowerCase().startsWith("zh")) {
		return [
			`请把这份设计稿整体重设为「${system.name}」设计体系。设计规范已写入 ${result.dirPath}/DESIGN.md（先 Read 它），参考色板在规范的 Color roles 一节。`,
			"",
			"要求：",
			`1. 重写 ${result.dirPath}/theme.css：以 DESIGN.md 对应的体系色板为准。基础 token 只换值、不改名、不删除（primary / primary-foreground / surface / surface-foreground / muted / accent / danger），体系特有的 token 只增不减。`,
			`2. 按 DESIGN.md 全量重设以下 ${result.frames.length} 个 frame（允许调整布局、间距、圆角、阴影、字重等一切视觉层，但保留每个页面的信息与功能结构）：${frameList}。`,
			"3. 每改完一个 frame 用 vetd_screenshot 截图核对，全部完成后逐帧确认无溢出、无对不齐、无对比度问题。",
			"",
			"（应用前的完整备份已存好，用户可随时从画布还原，放手改。）",
		].join("\n");
	}
	const frameListEn = result.frames.map((frame) => `${frame.id} (${frame.title})`).join(", ");
	return [
		`Please restyle this design document to the "${system.name}" design system. The spec is written to ${result.dirPath}/DESIGN.md (Read it first); the reference palette is in its Color roles section.`,
		"",
		"Requirements:",
		`1. Rewrite ${result.dirPath}/theme.css to that system's palette. Base tokens keep their NAMES and only change values (primary / primary-foreground / surface / surface-foreground / muted / accent / danger); system-specific tokens may be added but never removed.`,
		`2. Fully restyle these ${result.frames.length} frames per DESIGN.md (layout, spacing, radius, shadows, weights — everything visual — while preserving each page's information and functional structure): ${frameListEn}.`,
		"3. After each frame, verify with vetd_screenshot; before reporting back, re-check every touched frame for overflow, misalignment and contrast issues.",
		"",
		"(A full pre-apply backup exists and the user can restore from the canvas — restyle boldly.)",
	].join("\n");
}
