import type { MediaProviderDescriptor } from "@astravia-org/capability-sdk";
import { ipcMain } from "electron";
import { parseFile } from "music-metadata";
import type {
	AudioMetadata,
	CustomImageProviderInput,
	CustomImageProviderSummary,
} from "../../preload/api-types/media.js";
import { getDesktopMediaRuntime } from "../capabilities/media-providers.js";
import { assertPathReadableForPreview } from "./fs.js";

const CHANNELS = {
	LIST_PROVIDERS: "astravia:media:list-providers",
	AUDIO_METADATA: "astravia:media:audio-metadata",
	CUSTOM_PROVIDERS_LIST: "astravia:media:custom-image-providers:list",
	CUSTOM_PROVIDERS_SAVE: "astravia:media:custom-image-providers:save",
	CUSTOM_PROVIDERS_REMOVE: "astravia:media:custom-image-providers:remove",
} as const;

/** 跨进程入参校验：渲染层传来的只是 unknown，字段不全就不进领域层。 */
function parseCustomImageProviderInput(value: unknown): CustomImageProviderInput {
	if (typeof value !== "object" || value === null) throw new Error("Invalid custom image provider");
	const raw = value as Record<string, unknown>;
	if (typeof raw.name !== "string" || typeof raw.baseUrl !== "string" || typeof raw.model !== "string") {
		throw new Error("Invalid custom image provider");
	}
	return {
		...(typeof raw.id === "string" ? { id: raw.id } : {}),
		name: raw.name,
		baseUrl: raw.baseUrl,
		model: raw.model,
		supportsTextToImage: raw.supportsTextToImage === true,
		supportsImageToImage: raw.supportsImageToImage === true,
		...(typeof raw.apiKey === "string" ? { apiKey: raw.apiKey } : {}),
	};
}

/**
 * 音频元数据解析（黑胶播放器，见 CONTEXT.md「黑胶播放器」）：
 * 内嵌封面（ID3 APIC / FLAC picture）+ 标题/艺术家。在主进程解析，
 * 渲染进程只拿到一张小封面 DataURL 而非整个音频文件。
 */
export function registerMediaIpc(): () => void {
	ipcMain.handle(CHANNELS.LIST_PROVIDERS, (): MediaProviderDescriptor[] => {
		try {
			return getDesktopMediaRuntime().providers.listProviders();
		} catch {
			return [];
		}
	});
	ipcMain.handle(CHANNELS.CUSTOM_PROVIDERS_LIST, (): CustomImageProviderSummary[] => {
		try {
			return getDesktopMediaRuntime().customImageProviders.list();
		} catch {
			return [];
		}
	});
	ipcMain.handle(CHANNELS.CUSTOM_PROVIDERS_SAVE, (_event, input: unknown): CustomImageProviderSummary => {
		return getDesktopMediaRuntime().customImageProviders.save(parseCustomImageProviderInput(input));
	});
	ipcMain.handle(CHANNELS.CUSTOM_PROVIDERS_REMOVE, (_event, id: unknown): void => {
		if (typeof id !== "string" || id.length === 0) throw new Error("Invalid id");
		getDesktopMediaRuntime().customImageProviders.remove(id);
	});
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
		ipcMain.removeHandler(CHANNELS.LIST_PROVIDERS);
		ipcMain.removeHandler(CHANNELS.AUDIO_METADATA);
		ipcMain.removeHandler(CHANNELS.CUSTOM_PROVIDERS_LIST);
		ipcMain.removeHandler(CHANNELS.CUSTOM_PROVIDERS_SAVE);
		ipcMain.removeHandler(CHANNELS.CUSTOM_PROVIDERS_REMOVE);
	};
}
