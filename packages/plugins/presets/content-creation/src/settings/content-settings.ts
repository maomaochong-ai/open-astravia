/**
 * 插件自己的生成服务配置（ADR-0105）。
 *
 * 普通字段存插件私有存储；API Key 存宿主加密凭据库（`ctx.secrets`），两者在这里合成
 * 一份同步可读的视图——各个 Provider 在构造请求时同步取值，不能等 Promise。
 */

/** 走 `ctx.secrets` 的字段：值只在内存里合成，不写进插件存储。 */
export const CONTENT_SECRET_KEYS = ["openaiApiKey", "replicateApiToken", "googleApiKey", "customApiKey"] as const;

/** 走 `ctx.storage` 的字段，及其默认值。 */
export const CONTENT_PLAIN_DEFAULTS = {
	openaiModel: "gpt-image-2",
	customBaseUrl: "",
	customModel: "",
	customVideoModel: "",
} as const;

export type ContentSecretKey = (typeof CONTENT_SECRET_KEYS)[number];
export type ContentPlainKey = keyof typeof CONTENT_PLAIN_DEFAULTS;
export type ContentSettingKey = ContentSecretKey | ContentPlainKey;

/** 宿主迁移旧 `contributes.settings` 值时约定的落点。 */
export const SETTINGS_STORAGE_KEY = "settings.json";

/** Provider 侧只需要同步读一个字符串，故与存储实现解耦。 */
export interface ContentSettingsReader {
	get(key: string): string | undefined;
}

export function isContentSecretKey(key: string): key is ContentSecretKey {
	return (CONTENT_SECRET_KEYS as readonly string[]).includes(key);
}

/** 存储里的值是不可信输入：只保留声明过的字段，非字符串一律丢弃。 */
export function normalizePlainSettings(value: unknown): Record<ContentPlainKey, string> {
	const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
	const result = { ...CONTENT_PLAIN_DEFAULTS } as Record<ContentPlainKey, string>;
	for (const key of Object.keys(CONTENT_PLAIN_DEFAULTS) as ContentPlainKey[]) {
		const field = record[key];
		if (typeof field === "string") result[key] = field.trim();
	}
	return result;
}

export interface ContentSettingsPorts {
	readJson(key: string): Promise<unknown>;
	writeJson(key: string, value: unknown): Promise<void>;
	readSecret(key: string): Promise<string | undefined>;
	writeSecret(key: string, value: string): Promise<void>;
}

export class ContentSettingsStore implements ContentSettingsReader {
	private plain: Record<ContentPlainKey, string> = { ...CONTENT_PLAIN_DEFAULTS };
	private secrets: Partial<Record<ContentSecretKey, string>> = {};
	private loading: Promise<void> | null = null;
	private loaded = false;
	private readonly listeners = new Set<() => void>();

	constructor(private readonly ports: ContentSettingsPorts) {}

	get(key: string): string | undefined {
		if (isContentSecretKey(key)) return this.secrets[key];
		return key in this.plain ? this.plain[key as ContentPlainKey] : undefined;
	}

	/** 密钥只回答「有没有」，配置页不回显已保存的值。 */
	hasSecret(key: ContentSecretKey): boolean {
		return (this.secrets[key] ?? "").length > 0;
	}

	plainValues(): Readonly<Record<ContentPlainKey, string>> {
		return this.plain;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async load(): Promise<void> {
		if (this.loaded) return;
		if (this.loading) return this.loading;
		this.loading = (async () => {
			const [raw, ...secretValues] = await Promise.all([
				this.ports.readJson(SETTINGS_STORAGE_KEY).catch(() => null),
				...CONTENT_SECRET_KEYS.map((key) => this.ports.readSecret(key).catch(() => undefined)),
			]);
			this.plain = normalizePlainSettings(raw);
			this.secrets = Object.fromEntries(
				CONTENT_SECRET_KEYS.map((key, index) => [key, secretValues[index]]).filter(([, value]) => value),
			) as Partial<Record<ContentSecretKey, string>>;
			this.loaded = true;
			this.emit();
		})().finally(() => {
			this.loading = null;
		});
		return this.loading;
	}

	async updatePlain(patch: Partial<Record<ContentPlainKey, string>>): Promise<void> {
		this.plain = normalizePlainSettings({ ...this.plain, ...patch });
		this.loaded = true;
		await this.ports.writeJson(SETTINGS_STORAGE_KEY, this.plain);
		this.emit();
	}

	/** 传入空串表示清除该密钥。 */
	async setSecret(key: ContentSecretKey, value: string): Promise<void> {
		const trimmed = value.trim();
		if (trimmed) this.secrets[key] = trimmed;
		else delete this.secrets[key];
		await this.ports.writeSecret(key, trimmed);
		this.emit();
	}

	private emit(): void {
		for (const listener of this.listeners) listener();
	}
}
