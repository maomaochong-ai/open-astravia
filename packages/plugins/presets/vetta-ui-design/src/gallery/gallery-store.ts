/**
 * 画廊的数据装载与进程内缓存。
 *
 * 缓存的意义只有一个：再次进入画廊时先画上一次的结果，不要白屏一秒再跳出内容。
 * 它不是事实源——每次进入都会重扫一遍并覆盖。
 */
import { getPluginCtx } from "../plugin-context";
import { loadCover } from "../canvas/raster-cache";
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
				loadCover(card.cover.vetdPath),
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
