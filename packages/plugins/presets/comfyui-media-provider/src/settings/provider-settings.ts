/**
 * 插件自己的配置。存在插件私有存储里，工作区配置页读写，Provider 也要同步读它，
 * 所以放在 React 之外并提供订阅（ADR-0105）。
 */

export interface ProviderSettings {
	/** ComfyUI HTTP API 根地址。 */
	readonly baseUrl: string;
	/** 首尾帧模板任务 id；留空表示用历史里最近一个兼容的成功任务。 */
	readonly templatePromptId: string;
	/** 全能参考模板任务 id；留空规则同上。 */
	readonly referenceTemplatePromptId: string;
}

export const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = {
	baseUrl: "http://127.0.0.1:8188",
	templatePromptId: "",
	referenceTemplatePromptId: "",
};

/** 宿主迁移旧 `contributes.settings` 值时约定的落点。 */
export const SETTINGS_STORAGE_KEY = "settings";

function readString(value: unknown, fallback: string): string {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

/** 存储里的值是不可信输入：逐字段收窄，缺失或类型不符一律回落默认值。 */
export function normalizeProviderSettings(value: unknown): ProviderSettings {
	if (typeof value !== "object" || value === null) return DEFAULT_PROVIDER_SETTINGS;
	const record = value as Record<string, unknown>;
	return {
		baseUrl: readString(record.baseUrl, DEFAULT_PROVIDER_SETTINGS.baseUrl),
		templatePromptId: readString(record.templatePromptId, DEFAULT_PROVIDER_SETTINGS.templatePromptId),
		referenceTemplatePromptId: readString(
			record.referenceTemplatePromptId,
			DEFAULT_PROVIDER_SETTINGS.referenceTemplatePromptId,
		),
	};
}

export interface ProviderSettingsPorts {
	readJson(key: string): Promise<unknown>;
	writeJson(key: string, value: unknown): Promise<void>;
}

/** 读写 + 订阅。读失败按默认值处理，不让存储故障挡住生成流程。 */
export class ProviderSettingsStore {
	private settings: ProviderSettings = DEFAULT_PROVIDER_SETTINGS;
	private loaded = false;
	private loading: Promise<ProviderSettings> | null = null;
	private readonly listeners = new Set<(settings: ProviderSettings) => void>();

	constructor(private readonly ports: ProviderSettingsPorts) {}

	current(): ProviderSettings {
		return this.settings;
	}

	subscribe(listener: (settings: ProviderSettings) => void): () => void {
		this.listeners.add(listener);
		listener(this.settings);
		return () => this.listeners.delete(listener);
	}

	async load(): Promise<ProviderSettings> {
		if (this.loaded) return this.settings;
		if (this.loading) return this.loading;
		this.loading = this.ports
			.readJson(SETTINGS_STORAGE_KEY)
			.catch(() => null)
			.then((raw) => {
				this.loaded = true;
				this.apply(normalizeProviderSettings(raw));
				return this.settings;
			})
			.finally(() => {
				this.loading = null;
			});
		return this.loading;
	}

	async update(patch: Partial<ProviderSettings>): Promise<ProviderSettings> {
		this.apply(normalizeProviderSettings({ ...this.settings, ...patch }));
		this.loaded = true;
		await this.ports.writeJson(SETTINGS_STORAGE_KEY, this.settings);
		return this.settings;
	}

	private apply(next: ProviderSettings): void {
		this.settings = next;
		for (const listener of this.listeners) listener(next);
	}
}
