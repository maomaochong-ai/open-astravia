/**
 * 版本缩略图（ADR-0069）：提交那一刻画布上已经有刚刷新的位图，顺手存一份，历史面板
 * 就能靠图认版本，不必为了预览去重建一次旧版本。
 *
 * 存在 `.history/thumbs/<sha>/` 而不是 git 对象库里：缩略图是可丢弃的展示资源，
 * 进历史只会让每个版本都新增一批二进制 blob。
 */
import type { PluginFsApi } from "@vetta-org/plugin-sdk";
import { loadRasters } from "../canvas/raster-cache";
import { classifySource } from "../vetd/bundle-paths";
import { thumbsDirOf } from "./history-paths";

/** 一个版本最多存几张。够认出版本即可，再多只是占地方。 */
const MAX_THUMBS = 3;

/**
 * 这次变更该给哪些 frame 存图。
 *
 * 只改了共享件（theme.css、components/、_layout.tsx）时没有「变更的帧」可言，
 * 但那种改动恰恰是最需要看图确认的——退回到画布当前的帧顺序取前几张。
 */
export function thumbFrameIds(changedFiles: readonly string[], canvasFrameIds: readonly string[]): string[] {
	const direct: string[] = [];
	let shared = false;
	for (const file of changedFiles) {
		const impact = classifySource(file);
		if (impact.kind === "frame") direct.push(impact.frameId);
		else if (impact.kind === "shared") shared = true;
	}
	const picked = direct.length > 0 ? direct : shared ? [...canvasFrameIds] : [];
	return [...new Set(picked)].slice(0, MAX_THUMBS);
}

/**
 * 把画布位图落成这个版本的缩略图。位图还没刷新出来就少存几张——历史条目退化成
 * 纯文字，比为了等图拖住回合结束好。
 */
export async function captureThumbnails(
	fs: PluginFsApi,
	designDir: string,
	sha: string,
	frameIds: readonly string[],
): Promise<number> {
	if (frameIds.length === 0) return 0;
	const rasters = await loadRasters(designDir, frameIds).catch(() => new Map<string, string>());
	let written = 0;
	for (const frameId of frameIds) {
		const dataUrl = rasters.get(frameId);
		// 画布位图是 jpeg（见 canvas/frame-raster.ts）。
		const base64 = dataUrl?.split(",")[1];
		if (!base64) continue;
		try {
			await fs.writeFile(`${thumbsDirOf(designDir, sha)}/${frameId}.jpg`, base64, "base64");
			written++;
		} catch {
			// 缩略图存不下不影响版本本身，静默跳过。
		}
	}
	return written;
}
