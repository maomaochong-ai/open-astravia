/** A canvas frame's pixel size. */
export interface FrameSize {
	width: number;
	height: number;
}

/** Frame meta declared in the tsx (`export const frame = {...}`). */
export interface FrameMeta {
	width: number;
	height: number;
	title: string;
}

/**
 * One canvas frame in the manifest. `meta` is the last frame-meta snapshot the
 * plugin synced from the tsx: current width/height follow the manifest (user
 * drags win) until the tsx meta CHANGES again (last writer wins, ADR-0053).
 */
export interface VetdFrameEntry {
	id: string;
	/** Path relative to the bundle dir, e.g. `frames/login.tsx`. */
	file: string;
	x: number;
	y: number;
	width: number;
	height: number;
	title: string;
	meta: FrameMeta;
}

export interface VetdCanvasViewport {
	x: number;
	y: number;
	zoom: number;
}

/** Working-form `x.vetd` manifest (plugin is the single writer). */
export interface VetdManifest {
	version: 1;
	type: "vetta-design";
	canvas: VetdCanvasViewport;
	frames: VetdFrameEntry[];
	/**
	 * 这份设计是什么品类的，用创建时声明的一对 px 表示。只在**画框自己漏了声明、
	 * 且整份设计还没有多数派尺寸**时兜底（见 frame-size.ts）。
	 *
	 * 为什么要存：漏声明的兜底原本是写死的桌面 1440x900，而「用户要的是什么品类」
	 * 这个信息在 vetd_create 那一刻最清晰、之后再也没有地方记着（实测现场：用户第
	 * 一句就是 "Mobile APP"，五个 frame 全漏声明，整份设计落成桌面尺寸）。
	 *
	 * 老文档没有这个字段，所以是可选的——读不到就继续用全局兜底。
	 */
	defaultFrameSize?: FrameSize;
}

export function emptyManifest(): VetdManifest {
	return {
		version: 1,
		type: "vetta-design",
		canvas: { x: 0, y: 0, zoom: 1 },
		frames: [],
	};
}

/**
 * 一份设计 = 一个 `x.vetd/` 目录（bundle）。manifest 是它里面的一个文件，不再是
 * 目录旁边的兄弟节点：从前 `x.vetd` + `x.vetd.d/` 是两个条目，移动、复制、删除、
 * `git mv` 都要成对操作，漏一个就剩下半份设计。
 *
 * 目录而不是单文件容器：引擎（vite dev server）要的是磁盘上的真实文件树，agent
 * 也要能用普通读写工具改 tsx —— 见 ADR-0053、ADR-0066。
 */
export const MANIFEST_FILE = "design.json";

/** `x.vetd/` → 其中的 manifest 文件。 */
export function manifestPathOf(designPath: string): string {
	return `${designPath}/${MANIFEST_FILE}`;
}

/** 旧格式（v1 工作态）的旁挂目录，只有迁移用得到。 */
export function legacySidecarDirOf(vetdPath: string): string {
	return `${vetdPath}.d`;
}

/**
 * 一个叫 `.vetd` 的**文件**是哪种旧形态：v1 工作态 manifest 以 `{` 开头，打包
 * 分享文件是 zip（`PK`）。v2 设计包是目录，走不到这里。
 */
export function sniffVetdKind(head: string): "working" | "packaged" | "unknown" {
	const trimmed = head.trimStart();
	if (trimmed.startsWith("{")) return "working";
	if (head.startsWith("PK")) return "packaged";
	return "unknown";
}

export function designNameOf(designPath: string): string {
	const base = designPath.split("/").pop() ?? designPath;
	return base.replace(/\.vetd$/, "");
}
