/**
 * 画廊的数据装载与进程内缓存。
 *
 * 缓存的意义只有一个：再次进入画廊时先画上一次的结果，不要白屏一秒再跳出内容。
 * 它不是事实源——每次进入都会重扫一遍并覆盖。
 */
import { composeCover } from "../canvas/cover-compose";
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

export function getCachedSnapshot(): GallerySnapshot | null {
	return cached;
}

async function readAccent(vetdPath: string): Promise<string | null> {
	try {
		const file = await getPluginCtx().fs.readFile(`${vetdPath}/theme.css`);
		return parseAccentColor(file.content);
	} catch {
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
async function resolveCover(vetdPath: string): Promise<string | null> {
	const cached = await loadCover(vetdPath);
	if (cached) return cached;
	try {
		const raw = await getPluginCtx().fs.readFile(manifestPathOf(vetdPath));
		const manifest = JSON.parse(raw.content) as VetdManifest;
		if (!Array.isArray(manifest.frames) || manifest.frames.length === 0) return null;
		const composed = await composeCover(vetdPath, manifest.frames);
		if (composed) await saveCover(vetdPath, composed);
		return composed;
	} catch {
		// manifest 读不了/不是 JSON：这份设计本来也打不开，交给占位色。
		return null;
	}
}

/**
 * 扫一轮：项目列表 → 每个项目根一层的 `.vetd` → 封面与占位色。
 *
 * 归档项目不收：归档本来就是「从视野里拿走」，画廊再把它捞回来是自相矛盾的。
 */
export async function loadGallery(): Promise<GallerySnapshot> {
	const ctx = getPluginCtx();
	const [snapshot, runningCwds] = await Promise.all([
		ctx.official.projects.list(),
		ctx.official.sessions.listRunningCwds().catch(() => [] as string[]),
	]);
	const cards = await Promise.all(
		snapshot.projects.map(async (project) => {
			const designs = await scanProjectDesigns(ctx.fs, project.path);
			const card = toGalleryProject(project, designs);
			if (!card) return null;
			const [coverDataUrl, accent] = await Promise.all([
				resolveCover(card.cover.vetdPath),
				readAccent(card.cover.vetdPath),
			]);
			return {
				...card,
				coverDataUrl,
				accent,
				running: hasRunningSession(card.cwd, runningCwds),
			} satisfies GalleryCard;
		}),
	);
	const next: GallerySnapshot = {
		cards: sortGalleryProjects(cards.filter((card): card is GalleryCard => card !== null)),
		workspacePath: snapshot.workspacePath,
	};
	cached = next;
	return next;
}
