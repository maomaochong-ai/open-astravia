/**
 * 画廊的数据装载与进程内缓存。
 *
 * 缓存让再次进入先画出上一帧，不要白屏。离开页面必须能中止扫描：封面合成走
 * canvas，切走后若继续跑会把后续页面的帧预算吃掉。TTL 内的再进入复用缓存，
 * 手动刷新仍强制重扫。
 *
 * 首访分两拍：`skipCovers` 只读已缓存 jpeg，Hero / 卡片统计先出来；随后一次
 * 不带 skip 的 load 才 compose 缺封面。skip 快照不算「封面齐了」。
 */
import { loadCover, saveCover } from "../canvas/raster-cache";
import { getPluginCtx } from "../plugin-context";
import { manifestPathOf, type VetdManifest } from "../vetd/manifest-types";
import {
	type GalleryProject,
	hasRunningSession,
	scanProjectDesigns,
	sortGalleryProjects,
	toGalleryProject,
} from "./gallery-model";
import { parseAccentColor } from "./theme-accent";

export interface GalleryCard extends GalleryProject {
	/** 封面 jpeg dataURL；没在本机开过画布就没有。 */
	coverDataUrl: string | null;
	/** 占位底色（theme.css 的 --color-primary），封面缺失时用。 */
	accent: string | null;
	running: boolean;
}

export interface GallerySnapshot {
	cards: GalleryCard[];
	/** 新建项目落在哪儿；创建对话框要显示它。 */
	workspacePath: string;
}

export interface LoadGalleryOptions {
	signal?: AbortSignal;
	/** 用户点刷新：忽略 TTL，必须重扫。 */
	force?: boolean;
	/**
	 * 只扫项目 / 读已缓存 jpeg，不 compose。首屏 Hero 用；随后一次不带此标记
	 * 的 load 会在 TTL 内补封面，且卡片列表仍新鲜时不重列项目。
	 */
	skipCovers?: boolean;
	/** 测试注入时钟；生产走 `Date.now()`。 */
	now?: number;
}

/** 短于风格库 TTL：项目列表变化比远端清单频繁，但仍要挡住切页来回带来的重扫。 */
export const GALLERY_RESCAN_TTL_MS = 30_000;

/** 封面合成占主线程；无上限的 Promise.all 会在离开后继续把后续页面打卡。 */
const GALLERY_COVER_CONCURRENCY = 2;

let cached: GallerySnapshot | null = null;
let lastLoadedAt = 0;
/** skipCovers 快照不算齐；只有走过 compose 的 load 才把这位置上。 */
let coversComplete = false;

export function getCachedSnapshot(): GallerySnapshot | null {
	return cached;
}

export function shouldRescanGallery(now: number, lastAt: number, force: boolean): boolean {
	if (force || lastAt === 0) return true;
	return now - lastAt >= GALLERY_RESCAN_TTL_MS;
}

/** Activity 切回时：缓存还在 TTL 内就不要当「第一次进页」再扫一遍。 */
export function isGalleryCacheFresh(now: number = Date.now()): boolean {
	return cached !== null && !shouldRescanGallery(now, lastLoadedAt, false);
}

/** 卡片列表可能新鲜，但 skipCovers 之后封面仍缺，调用方还应再 load 一次补齐。 */
export function isGalleryCoverCacheComplete(): boolean {
	return coversComplete;
}

export function isGalleryAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}

/** 单测隔离进程内缓存；生产路径不会调用。 */
export function resetGalleryStore(): void {
	cached = null;
	lastLoadedAt = 0;
	coversComplete = false;
}

function abortError(): Error {
	if (typeof DOMException === "function") {
		return new DOMException("The operation was aborted.", "AbortError");
	}
	const error = new Error("The operation was aborted.");
	error.name = "AbortError";
	return error;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw abortError();
}

async function mapPool<T, R>(
	items: readonly T[],
	concurrency: number,
	mapper: (item: T) => Promise<R>,
	signal?: AbortSignal,
): Promise<R[]> {
	if (items.length === 0) return [];
	const results: R[] = new Array(items.length);
	let cursor = 0;
	const worker = async (): Promise<void> => {
		while (true) {
			throwIfAborted(signal);
			const index = cursor;
			cursor += 1;
			if (index >= items.length) return;
			results[index] = await mapper(items[index] as T);
		}
	};
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
	return results;
}

async function readAccent(vetdPath: string, signal?: AbortSignal): Promise<string | null> {
	throwIfAborted(signal);
	try {
		const file = await getPluginCtx().fs.readFile(`${vetdPath}/theme.css`);
		return parseAccentColor(file.content);
	} catch (error) {
		if (isGalleryAbortError(error)) throw error;
		return null;
	}
}

/**
 * 拿封面：库里有就用；`skipCompose` 时到此为止。否则缺封面就**自己合成一张**。
 *
 * 封面的原料（逐帧位图 + manifest 里的坐标）在画布截过图之后就一直躺在那儿了，
 * 「有没有封面」不该取决于用户离开画布的那一刻画布有没有来得及写。画廊自己能补，
 * 就不要让一张卡永远停在占位色上——这也顺带修好了历史上没写成封面的那些设计。
 *
 * 只在缺封面时才走这条路：读一次 manifest + 解码若干 jpeg，不是每张卡每次都付。
 * compose 模块按需加载，skipCovers 首屏不解析 canvas 合成。
 */
async function resolveCover(
	vetdPath: string,
	signal?: AbortSignal,
	skipCompose = false,
): Promise<string | null> {
	throwIfAborted(signal);
	const cachedCover = await loadCover(vetdPath);
	if (cachedCover || skipCompose) return cachedCover;
	throwIfAborted(signal);
	try {
		const raw = await getPluginCtx().fs.readFile(manifestPathOf(vetdPath));
		throwIfAborted(signal);
		const manifest = JSON.parse(raw.content) as VetdManifest;
		if (!Array.isArray(manifest.frames) || manifest.frames.length === 0) return null;
		const { composeCover } = await import("../canvas/cover-compose");
		const composed = await composeCover(vetdPath, manifest.frames, signal);
		if (signal?.aborted) throw abortError();
		if (composed) await saveCover(vetdPath, composed);
		return composed;
	} catch (error) {
		if (isGalleryAbortError(error) || signal?.aborted) throw abortError();
		// manifest 读不了/不是 JSON：这份设计本来也打不开，交给占位色。
		return null;
	}
}

async function fillMissingCovers(snapshot: GallerySnapshot, signal?: AbortSignal): Promise<GallerySnapshot> {
	const cards = await mapPool(
		snapshot.cards,
		GALLERY_COVER_CONCURRENCY,
		async (card) => {
			throwIfAborted(signal);
			if (card.coverDataUrl) return card;
			const coverDataUrl = await resolveCover(card.cover.vetdPath, signal, false);
			if (coverDataUrl === card.coverDataUrl) return card;
			return { ...card, coverDataUrl };
		},
		signal,
	);
	return { ...snapshot, cards };
}

/**
 * 扫一轮：项目列表 → 每个项目根一层的 `.vetd` → 封面与占位色。
 *
 * 归档项目不收：归档本来就是「从视野里拿走」，画廊再把它捞回来是自相矛盾的。
 */
export async function loadGallery(options: LoadGalleryOptions = {}): Promise<GallerySnapshot> {
	const signal = options.signal;
	const now = options.now ?? Date.now();
	const skipCovers = options.skipCovers === true;
	throwIfAborted(signal);
	const listFresh = cached !== null && !shouldRescanGallery(now, lastLoadedAt, options.force === true);
	if (listFresh && cached) {
		if (skipCovers || coversComplete) return cached;
		const filled = await fillMissingCovers(cached, signal);
		throwIfAborted(signal);
		cached = filled;
		coversComplete = true;
		return filled;
	}
	const ctx = getPluginCtx();
	const [snapshot, runningCwds] = await Promise.all([
		ctx.official.projects.list(),
		ctx.official.sessions.listRunningCwds().catch(() => [] as string[]),
	]);
	throwIfAborted(signal);
	const cards = await mapPool(
		snapshot.projects,
		GALLERY_COVER_CONCURRENCY,
		async (project) => {
			throwIfAborted(signal);
			const designs = await scanProjectDesigns(ctx.fs, project.path);
			const card = toGalleryProject(project, designs);
			if (!card) return null;
			const [coverDataUrl, accent] = await Promise.all([
				resolveCover(card.cover.vetdPath, signal, skipCovers),
				readAccent(card.cover.vetdPath, signal),
			]);
			return {
				...card,
				coverDataUrl,
				accent,
				running: hasRunningSession(card.cwd, runningCwds),
			} satisfies GalleryCard;
		},
		signal,
	);
	throwIfAborted(signal);
	const next: GallerySnapshot = {
		cards: sortGalleryProjects(cards.filter((card): card is GalleryCard => card !== null)),
		workspacePath: snapshot.workspacePath,
	};
	cached = next;
	lastLoadedAt = now;
	coversComplete = !skipCovers;
	return next;
}
