/**
 * 画廊的数据模型：把「侧边栏里的项目」变成「设计稿卡片」。
 *
 * 一张卡 = 一个项目。收集条件是项目根目录下直接躺着 `x.vetd/` 包——只看一层，不做
 * 递归列举：画廊要对**所有**项目扫一遍，递归一个大仓库的代价会让这个页面打不开，
 * 而 scaffoldDesign 与导入本来就只往项目根写（`${cwd}/${name}.vetd`）。
 * 代价是用户手动挪进子目录的设计收不到，这是明确取舍。
 */
import type { PluginFsApi, PluginOfficialSessionSummary } from "@vetta-org/plugin-sdk";
import { designNameOf, MANIFEST_FILE } from "../vetd/manifest-types";
import { migrateLegacyDesign } from "../vetd/migrate";

/** 项目里的一份设计。 */
export interface GalleryDesign {
	/** `x.vetd/` 目录的绝对路径。 */
	vetdPath: string;
	/** 去掉 `.vetd` 后缀的名字。 */
	name: string;
	/** design.json 的 mtime；读不到时退回目录自身的 mtime。 */
	modifiedAt: number;
}

/** 画廊里的一张卡。 */
export interface GalleryProject {
	cwd: string;
	name: string;
	/** 按最近改动倒序。 */
	designs: GalleryDesign[];
	/** 卡面代表的那一份（= designs[0]）。 */
	cover: GalleryDesign;
	/** 卡片排序与 info 区用的时间：最近改动的那份设计的时间。 */
	modifiedAt: number;
}

/** 目录名去掉尾部分隔符后的最后一段，作为项目名的兜底。 */
export function basenameOf(path: string): string {
	const normalized = path.replace(/[\\/]+$/, "");
	const parts = normalized.split(/[\\/]/);
	return parts[parts.length - 1] || path;
}

/** v1 遗留的旁挂目录后缀（`x.vetd` 文件 + `x.vetd.d/` 目录，见 ADR-0066）。 */
const LEGACY_SIDECAR_SUFFIX = ".vetd.d";

/**
 * 扫一个项目根，返回其中的设计（最近改动在前），顺手把遇到的 v1 遗留形态就地迁移。
 *
 * 迁移放在扫描里而不是「点进去才升级」：画廊是设计的注册中心，旧格式不迁就根本不
 * 会出现在这里，用户看不到自然也点不进去，那份设计等于消失了。
 * {@link migrateLegacyDesign} 幂等且分步崩溃安全，重复扫描不会造成二次伤害。
 *
 * 目录读不了（项目被删/被移走/权限没授）一律当作「没有设计」：画廊是个总览页，
 * 一个坏掉的项目不该让整页报错。
 */
export async function scanProjectDesigns(fs: PluginFsApi, cwd: string): Promise<GalleryDesign[]> {
	let entries: Awaited<ReturnType<PluginFsApi["readDir"]>>;
	try {
		entries = await fs.readDir(cwd);
	} catch {
		return [];
	}
	const bundleNames = new Set(entries.filter((entry) => entry.isDirectory).map((entry) => entry.name));
	const designs: GalleryDesign[] = [];
	for (const entry of entries) {
		const legacyPath = legacyDesignPathOf(entry, bundleNames);
		if (legacyPath) {
			// 打包分享文件（zip）也叫 `.vetd`，migrate 靠内容嗅探放过它并返回 false。
			const migrated = await migrateLegacyDesign(fs, legacyPath).catch(() => false);
			if (!migrated) continue;
			designs.push(await describeDesign(fs, legacyPath, entry.modifiedAt));
			continue;
		}
		if (!entry.isDirectory || !entry.name.endsWith(".vetd")) continue;
		designs.push(await describeDesign(fs, entry.path, entry.modifiedAt));
	}
	return designs.sort((left, right) => right.modifiedAt - left.modifiedAt);
}

/**
 * 这个条目是不是一份等待迁移的 v1 遗留设计，是则给出迁移入口路径（`x.vetd`）。
 *
 * 两种形态：
 * - `x.vetd` **文件**：完整的 v1 工作态（或一个分享包，交给 migrate 去甄别）。
 * - 落单的 `x.vetd.d/` **目录**：上一次迁移停在「旧 manifest 已删、旁挂目录还没改名」
 *   之间。此时磁盘上没有任何叫 `.vetd` 的条目，只按文件名找设计的扫描器会彻底看不见
 *   它——这是唯一能把这份设计捞回来的地方，所以这里认它。
 */
function legacyDesignPathOf(
	entry: { name: string; path: string; isDirectory: boolean },
	bundleNames: ReadonlySet<string>,
): string | null {
	if (!entry.isDirectory && entry.name.endsWith(".vetd")) return entry.path;
	if (entry.isDirectory && entry.name.endsWith(LEGACY_SIDECAR_SUFFIX)) {
		const base = entry.name.slice(0, -".d".length);
		// 同名 `.vetd` 目录已经在了，说明迁移早就完成、这个旁挂目录是别的东西的残留，
		// 不要去动它（rename 会撞上已存在的目标）。
		if (bundleNames.has(base)) return null;
		return entry.path.slice(0, -".d".length);
	}
	return null;
}

async function describeDesign(fs: PluginFsApi, vetdPath: string, fallbackModifiedAt: number): Promise<GalleryDesign> {
	// 取 design.json 的 mtime 而不是目录的：目录 mtime 只在增删文件时变，而拖画框、
	// 平移视口这些「画布上刚干过的事」写的正是 manifest。
	const manifestStat = await fs.stat(`${vetdPath}/${MANIFEST_FILE}`).catch(() => null);
	return {
		vetdPath,
		name: designNameOf(vetdPath),
		modifiedAt: manifestStat?.modifiedAt ?? fallbackModifiedAt,
	};
}

/** 把一个项目的扫描结果整理成卡片；没有设计的项目不进画廊。 */
export function toGalleryProject(
	project: { path: string; name?: string },
	designs: readonly GalleryDesign[],
): GalleryProject | null {
	const cover = designs[0];
	if (!cover) return null;
	return {
		cwd: project.path,
		name: project.name?.trim() || basenameOf(project.path),
		designs: [...designs],
		cover,
		modifiedAt: cover.modifiedAt,
	};
}

/** 卡片排序：最近改动在前；同时间按名字稳定排，避免每次扫描顺序抖动。 */
export function sortGalleryProjects<T extends GalleryProject>(projects: readonly T[]): T[] {
	return [...projects].sort(
		(left, right) => right.modifiedAt - left.modifiedAt || left.name.localeCompare(right.name),
	);
}

/** 搜索框：按项目名与设计名匹配，大小写不敏感。空关键词返回全部。 */
export function filterGalleryProjects<T extends GalleryProject>(projects: readonly T[], keyword: string): T[] {
	const needle = keyword.trim().toLowerCase();
	if (!needle) return [...projects];
	return projects.filter(
		(project) =>
			project.name.toLowerCase().includes(needle) ||
			project.designs.some((design) => design.name.toLowerCase().includes(needle)),
	);
}

/**
 * 点开一张卡时该去哪：最近一个**能续聊**的会话。
 *
 * 只读（`readHistory` 但不能 `interactiveResume`）和完全不可用的会话都跳过，而不是
 * 打开只读查看器：从画廊进来的意图是「继续做这份设计」，塞给用户一个改不了的历史
 * 页面既没用又难解释。一个都没有就返回 null，由调用方落到新建会话页。
 */
export function pickResumableSession(
	sessions: readonly PluginOfficialSessionSummary[],
): PluginOfficialSessionSummary | null {
	// 宿主已按 modifiedAt 倒序返回，这里仍显式排一次：这个选择是跳转的唯一依据，
	// 不值得赌上游实现不变。
	const ordered = [...sessions].sort((left, right) => (right.modifiedAt ?? 0) - (left.modifiedAt ?? 0));
	return ordered.find((session) => session.access?.interactiveResume === true) ?? null;
}

/** 「N 份设计」角标：只有真的不止一份才显示，否则每张卡都挂个「1 份设计」是噪声。 */
export function designCountBadge(project: GalleryProject): number | null {
	return project.designs.length > 1 ? project.designs.length : null;
}

/** 路径比较用的归一形式：统一分隔符、去掉尾部分隔符。大小写按原样保留。 */
function normalizePath(path: string): string {
	return path.replaceAll("\\", "/").replace(/\/+$/, "");
}

/**
 * 项目里是否有会话在跑。
 *
 * 入参是宿主给的**项目 cwd** 列表（`official.sessions.listRunningCwds`），不是会话文件
 * 路径：会话文件默认落在按 cwd 编码的分片目录下，那个编码不可逆，拿路径反推项目会张冠李戴。
 */
export function hasRunningSession(cwd: string, runningCwds: readonly string[]): boolean {
	const target = normalizePath(cwd);
	return runningCwds.some((candidate) => normalizePath(candidate) === target);
}
