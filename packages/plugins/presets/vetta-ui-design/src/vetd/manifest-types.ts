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
	/** Path relative to the sidecar dir, e.g. `frames/login.tsx`. */
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

/** `x.vetd` → sidecar dir `x.vetd.d` (naming-convention binding). */
export function sidecarDirOf(vetdPath: string): string {
	return `${vetdPath}.d`;
}

export function designNameOf(vetdPath: string): string {
	const base = vetdPath.split("/").pop() ?? vetdPath;
	return base.replace(/\.vetd$/, "");
}
