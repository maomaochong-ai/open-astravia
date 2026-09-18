/**
 * 画廊的数据装载与进程内缓存。
 *
 * 缓存的意义只有一个：再次进入画廊时先画上一次的结果，不要白屏一秒再跳出内容。
 * 它不是事实源——每次进入都会重扫一遍并覆盖。
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

let cached: GallerySnapshot | null = null;
const GALLERY_COVER_CONCURRENCY = 2;

export function isGalleryAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new DOMException("Gallery load aborted", "AbortError");
}

async function mapPool<T, R>(
	items: readonly T[],
	mapper: (item: T) => Promise<R>,
	signal?: AbortSignal,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let cursor = 0;
	const worker = async (): Promise<void> => {
		while (cursor < items.length) {
			throwIfAborted(signal);
			const index = cursor++;
			results[index] = await mapper(items[index] as T);
		}
	};
	await Promise.all(Array.from({ length: Math.min(GALLERY_COVER_CONCURRENCY, items.length) }, worker));
	throwIfAborted(signal);
	return results;
}

export function getCachedSnapshot(): GallerySnapshot | null {
	return cached;
}

async function readAccent(vetdPath: string, signal?: AbortSignal): Promise<string | null> {
	throwIfAborted(signal);
	try {
		const file = await getPluginCtx().fs.readFile(`${vetdPath}/theme.css`);
		throwIfAborted(signal);
		return parseAccentColor(file.content);
	} catch (error) {
		if (isGalleryAbortError(error)) throw error;
		return null;
	}
}

/**
 * 拿封面：库里有就用，没有就**自己合成一张**。
 *
 * 封面的原料（逐帧位图 + manifest 里的坐标）在画布截过图之后就一直躺在那儿了，
 * 「有没有封面」不该取决于用户离开画布的那一刻画布有没有来得及写。画廊自己能补，
 * 就不要让一张卡永远停在占位色上——这也顺带修好了历史上没写成封面的那些设计。
 *
 * 只在缺封面时才走这条路：读一次 manifest + 解码若干 jpeg，不是每张卡每次都付。
 */
async function resolveCover(vetdPath: string, signal?: AbortSignal): Promise<string | null> {
	throwIfAborted(signal);
	const cachedCover = await loadCover(vetdPath);
	throwIfAborted(signal);
	if (cachedCover) return cachedCover;
	try {
		const raw = await getPluginCtx().fs.readFile(manifestPathOf(vetdPath));
		throwIfAborted(signal);
		const manifest = JSON.parse(raw.content) as VetdManifest;
		if (!Array.isArray(manifest.frames) || manifest.frames.length === 0) return null;
		const { composeCover } = await import("../canvas/cover-compose");
		throwIfAborted(signal);
		const composed = await composeCover(vetdPath, manifest.frames, signal);
		throwIfAborted(signal);
		if (composed) await saveCover(vetdPath, composed);
		return composed;
	} catch (error) {
		if (isGalleryAbortError(error) || signal?.aborted) {
			throwIfAborted(signal);
			throw error;
		}
		// manifest 读不了/不是 JSON：这份设计本来也打不开，交给占位色。
		return null;
	}
}

/**
 * 扫一轮：项目列表 → 每个项目根一层的 `.vetd` → 封面与占位色。
 *
 * 归档项目不收：归档本来就是「从视野里拿走」，画廊再把它捞回来是自相矛盾的。
 */
export async function loadGallery(signal?: AbortSignal): Promise<GallerySnapshot> {
	throwIfAborted(signal);
	const ctx = getPluginCtx();
	const [snapshot, runningCwds] = await Promise.all([
		ctx.official.projects.list(),
		ctx.official.sessions.listRunningCwds().catch(() => [] as string[]),
	]);
	throwIfAborted(signal);
	const scanned = await Promise.all(
		snapshot.projects.map(async (project) => {
			throwIfAborted(signal);
			const designs = await scanProjectDesigns(ctx.fs, project.path);
			throwIfAborted(signal);
			return toGalleryProject(project, designs);
		}),
	);
	throwIfAborted(signal);
	const cards = await mapPool(
		scanned.filter((card): card is GalleryProject => card !== null),
		async (card) => {
			const [coverDataUrl, accent] = await Promise.all([
				resolveCover(card.cover.vetdPath, signal),
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
		cards: sortGalleryProjects(cards),
		workspacePath: snapshot.workspacePath,
	};
	cached = next;
	return next;
}
