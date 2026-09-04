import type { PluginContext } from "@vetta-org/plugin-sdk";

/**
 * 插件自己的开关。存插件私有存储，面板读写，Agent handler 同步读（ADR-0105）——
 * 宿主不再提供设置页配置槽，插件自绘界面就是唯一入口。
 */

export interface DemoSettings {
	readonly fictionStyle: string;
	readonly promptAddEnabled: boolean;
	readonly promptReplaceEnabled: boolean;
	readonly promptUpdateEnabled: boolean;
	readonly promptDisableEnabled: boolean;
	readonly promptRemoveEnabled: boolean;
	readonly disableWriteChapterTool: boolean;
	readonly continuationDemoEnabled: boolean;
}

export const DEFAULT_DEMO_SETTINGS: DemoSettings = {
	fictionStyle: "Follow the user's requested genre and tone.",
	promptAddEnabled: true,
	promptReplaceEnabled: false,
	promptUpdateEnabled: false,
	promptDisableEnabled: false,
	promptRemoveEnabled: false,
	disableWriteChapterTool: false,
	continuationDemoEnabled: false,
};

/** 宿主迁移旧 `contributes.settings` 值时约定的落点。 */
const STORAGE_KEY = "settings";

export type DemoToggleKey = Exclude<keyof DemoSettings, "fictionStyle">;

export const DEMO_TOGGLE_KEYS: readonly DemoToggleKey[] = [
	"promptAddEnabled",
	"promptReplaceEnabled",
	"promptUpdateEnabled",
	"promptDisableEnabled",
	"promptRemoveEnabled",
	"disableWriteChapterTool",
	"continuationDemoEnabled",
];

/** 存储里的值是不可信输入：逐字段收窄，缺失或类型不符一律回落默认值。 */
export function normalizeDemoSettings(value: unknown): DemoSettings {
	const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
	const style = record.fictionStyle;
	return {
		...DEFAULT_DEMO_SETTINGS,
		fictionStyle:
			typeof style === "string" && style.trim() ? style.trim() : DEFAULT_DEMO_SETTINGS.fictionStyle,
		...Object.fromEntries(
			DEMO_TOGGLE_KEYS.map((key) => [key, typeof record[key] === "boolean" ? record[key] : DEFAULT_DEMO_SETTINGS[key]]),
		),
	};
}

class DemoSettingsStore {
	private settings: DemoSettings = DEFAULT_DEMO_SETTINGS;
	private readonly listeners = new Set<() => void>();

	constructor(private readonly ctx: PluginContext) {}

	current(): DemoSettings {
		return this.settings;
	}

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	async load(): Promise<void> {
		const raw = await this.ctx.storage.readJson<unknown>(STORAGE_KEY).catch(() => null);
		this.apply(normalizeDemoSettings(raw));
	}

	async update(patch: Partial<DemoSettings>): Promise<void> {
		this.apply(normalizeDemoSettings({ ...this.settings, ...patch }));
		await this.ctx.storage.writeJson(STORAGE_KEY, this.settings);
	}

	private apply(next: DemoSettings): void {
		this.settings = next;
		for (const listener of this.listeners) listener();
	}
}

let store: DemoSettingsStore | null = null;

export function initDemoSettings(ctx: PluginContext): DemoSettingsStore {
	store = new DemoSettingsStore(ctx);
	return store;
}

export function getDemoSettingsStore(): DemoSettingsStore {
	if (!store) throw new Error("global-slot-demo: settings store is not ready");
	return store;
}
