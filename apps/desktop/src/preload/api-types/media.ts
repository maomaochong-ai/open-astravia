import type { MediaProviderDescriptor } from "@vetta-org/capability-sdk";

export interface AudioMetadata {
	/** 内嵌标签标题，无则渲染端回退文件名 */
	title?: string;
	artist?: string;
	/** 内嵌封面（ID3 APIC / FLAC picture）的 DataURL，无封面为 undefined */
	coverDataUrl?: string;
}

export interface DesktopMediaApi {
	/** 列出当前已注册的媒体 Provider，供 Agent 设置页展示能力与选择。 */
	listProviders(): Promise<MediaProviderDescriptor[]>;
	/** 解析本地音频文件的内嵌元数据（主进程 music-metadata），解析失败返回空对象 */
	getAudioMetadata(filePath: string): Promise<AudioMetadata>;
}
