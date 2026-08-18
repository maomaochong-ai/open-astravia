import { ipcMain } from "electron";
import { parseFile } from "music-metadata";
import type { AudioMetadata } from "../../preload/api-types/media.js";
import { assertPathReadableForPreview } from "./fs.js";

const CHANNELS = {
	AUDIO_METADATA: "vetta:media:audio-metadata",
} as const;

/**
 * 音频元数据解析（黑胶播放器，见 CONTEXT.md「黑胶播放器」）：
 * 内嵌封面（ID3 APIC / FLAC picture）+ 标题/艺术家。在主进程解析，
 * 渲染进程只拿到一张小封面 DataURL 而非整个音频文件。
 */
export function registerMediaIpc(): () => void {
	ipcMain.handle(CHANNELS.AUDIO_METADATA, async (_event, filePath: unknown): Promise<AudioMetadata> => {
		if (typeof filePath !== "string" || filePath.trim().length === 0) {
			throw new Error("Invalid filePath");
		}
		assertPathReadableForPreview(filePath);
		try {
			// duration 留给 <audio> 元素自己上报，跳过可避免部分格式的全文件扫描
			const metadata = await parseFile(filePath, { duration: false });
			const picture = metadata.common.picture?.[0];
			return {
				title: metadata.common.title ?? undefined,
				artist: metadata.common.artist ?? undefined,
				coverDataUrl: picture
					? `data:${picture.format};base64,${Buffer.from(picture.data).toString("base64")}`
					: undefined,
			};
		} catch {
			// 解析失败不阻断播放：渲染端降级为纯 CSS 盘面 + 文件名
			return {};
		}
	});

	return () => {
		ipcMain.removeHandler(CHANNELS.AUDIO_METADATA);
	};
}
