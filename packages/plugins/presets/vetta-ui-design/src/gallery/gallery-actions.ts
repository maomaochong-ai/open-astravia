/**
 * 画廊里会改动磁盘/宿主状态的几个动作：建、导入、导出、归档。
 *
 * 都是薄封装：真正的活儿在既有模块里（scaffoldDesign / importPackagedVetd /
 * exportDesign / official.projects），这里只负责把「项目」这一层拼上去。
 */
import { exportDesign } from "../export/export-design";
import { importPackagedVetd, parsePackagedVetd } from "../export/import-design";
import { SHARE_PREVIEW_EXTENSIONS } from "../export/share-format";
import { getPluginCtx } from "../plugin-context";
import { DesignSession } from "../vetd/design-session";
import { sanitizeDesignName, scaffoldDesign } from "../vetd/scaffold";

export interface CreatedDesign {
	cwd: string;
	vetdPath: string;
}

/** 项目名不能带路径分隔符（宿主 ProjectService 会拒），复用设计名的清洗规则。 */
export function toProjectName(raw: string): string {
	return sanitizeDesignName(raw);
}

/**
 * 新建：在 workspace 下建一个项目目录，并在其中铺一份空设计。
 *
 * 落点固定在 workspace，不问用户选目录——「我想画点东西」这件事不该先经过一个
 * 文件夹选择器。目录已存在时宿主的 create 是幂等的，scaffold 也会自动避让重名。
 */
export async function createDesignProject(rawName: string): Promise<CreatedDesign> {
	const ctx = getPluginCtx();
	const name = toProjectName(rawName);
	const entry = await ctx.official.projects.create(name);
	const result = await scaffoldDesign(ctx.fs, entry.path, name);
	return { cwd: entry.path, vetdPath: result.vetdPath };
}

/** 这个文件名看起来是不是一个分享包。 */
export function isSharePackageName(fileName: string): boolean {
	const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
	return (SHARE_PREVIEW_EXTENSIONS as readonly string[]).includes(extension);
}

/** 分享包文件名 → 项目名：去掉扩展名与导出时加的 `-share` 后缀。 */
export function projectNameFromShareFile(fileName: string): string {
	return toProjectName(fileName.replace(/\.(?:vetdz|vetd)$/i, "").replace(/-share$/i, ""));
}

/**
 * 导入一个分享包：建一个同名项目，把包解到里面。
 *
 * 先解包再建项目：包坏掉时不该在磁盘上留下一个空项目。
 */
export async function importDesignPackage(fileName: string, bytes: Uint8Array): Promise<CreatedDesign> {
	const ctx = getPluginCtx();
	const packaged = parsePackagedVetd(bytes);
	const entry = await ctx.official.projects.create(projectNameFromShareFile(fileName));
	const vetdPath = await importPackagedVetd(ctx, packaged, entry.path, fileName);
	return { cwd: entry.path, vetdPath };
}

/**
 * 导出一份设计为 `.vetdz`。
 *
 * 要一个打开状态的 DesignSession（manifest 是打包内容的一部分），所以这里临时开一个
 * 再关掉；导出本身要跑一次引擎构建，是个「点了要等」的动作，调用方负责给进度提示。
 */
export async function exportDesignByPath(vetdPath: string): Promise<string> {
	const ctx = getPluginCtx();
	const session = new DesignSession(ctx, vetdPath);
	try {
		await session.open();
		return await exportDesign(ctx, session);
	} finally {
		session.dispose();
	}
}

/** 在系统文件管理器里显示项目目录。 */
export async function revealProject(cwd: string): Promise<void> {
	await getPluginCtx().official.shell.showItemInFolder(cwd);
}

/** 归档项目：只从侧边栏和画廊里拿走，磁盘上的目录一动不动。 */
export async function archiveProject(cwd: string): Promise<void> {
	await getPluginCtx().official.projects.archive(cwd);
}
