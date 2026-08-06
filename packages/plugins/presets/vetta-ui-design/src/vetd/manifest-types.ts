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

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

/**
 * 一条 frame 记录的净化。返回 null 表示这条留不得——丢掉不会丢内容：sidecar 里的
 * tsx 才是真相，reconcile 会把它当作新帧重新建、重新排位。
 */
function normalizeFrameEntry(raw: unknown): VetdFrameEntry | null {
	if (!raw || typeof raw !== "object") return null;
	const entry = raw as Record<string, unknown>;
	const id = typeof entry.id === "string" ? entry.id : "";
	if (!id) return null;
	// 几何值一旦是 NaN/字符串/缺失，画布上的定位与命中判定会整片失效（而且是静默
	// 的），不如丢掉让它按新帧重排。
	if (!isFiniteNumber(entry.x) || !isFiniteNumber(entry.y)) return null;
	if (!isFiniteNumber(entry.width) || !isFiniteNumber(entry.height)) return null;
	const title = typeof entry.title === "string" ? entry.title : id;
	const rawMeta = entry.meta as Record<string, unknown> | undefined;
	const meta: FrameMeta =
		rawMeta && isFiniteNumber(rawMeta.width) && isFiniteNumber(rawMeta.height)
			? { width: rawMeta.width, height: rawMeta.height, title: typeof rawMeta.title === "string" ? rawMeta.title : title }
			: // meta 缺失就用当前几何兜住：它是「上次同步到的 tsx 声明」，拿现状当基线
				// 最接近事实，下一次 reconcile 只要 tsx 声明不同照样会跟着变。
				{ width: entry.width, height: entry.height, title };
	return {
		id,
		file: typeof entry.file === "string" ? entry.file : `frames/${id}.tsx`,
		x: entry.x,
		y: entry.y,
		width: entry.width,
		height: entry.height,
		title,
		meta,
	};
}

/**
 * 把磁盘上的 .vetd 净化成一份可用的 manifest；不是这个格式就返回 null。
 *
 * 「插件是 manifest 的单一写者」是约定，不是事实：skill 里写着 never edit，agent
 * 照样会直接 Write 它，写出来的条目缺 `meta`、几何值是字符串。而 reconcile 是
 * open() 的第一步，任何一条畸形记录抛出去，画布就永远停在「设计引擎启动失败」，
 * 连文件监听都还没来得及注册——此后写多少 frame 画布都不动。所以入口这里必须
 * 假定文件内容完全不可信。
 *
 * `changed` 表示净化过程真的改动了内容，调用方据此把修好的版本写回磁盘。
 */
export function normalizeManifest(raw: unknown): { manifest: VetdManifest; changed: boolean } | null {
	if (!raw || typeof raw !== "object") return null;
	const source = raw as Record<string, unknown>;
	if (source.type !== "vetta-design" || !Array.isArray(source.frames)) return null;

	const frames: VetdFrameEntry[] = [];
	let changed = false;
	const seen = new Set<string>();
	for (const rawFrame of source.frames) {
		const frame = normalizeFrameEntry(rawFrame);
		// 同一个 id 出现两次会让画布上两块画板抢同一个 tsx，后写的那次静默覆盖前一次。
		if (!frame || seen.has(frame.id)) {
			changed = true;
			continue;
		}
		seen.add(frame.id);
		if (JSON.stringify(frame) !== JSON.stringify(rawFrame)) changed = true;
		frames.push(frame);
	}

	const base = emptyManifest();
	const rawCanvas = source.canvas as Record<string, unknown> | undefined;
	const canvas: VetdCanvasViewport =
		rawCanvas &&
		isFiniteNumber(rawCanvas.x) &&
		isFiniteNumber(rawCanvas.y) &&
		isFiniteNumber(rawCanvas.zoom) &&
		rawCanvas.zoom > 0
			? { x: rawCanvas.x, y: rawCanvas.y, zoom: rawCanvas.zoom }
			: base.canvas;
	if (JSON.stringify(canvas) !== JSON.stringify(rawCanvas)) changed = true;

	return { manifest: { ...base, canvas, frames }, changed };
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
