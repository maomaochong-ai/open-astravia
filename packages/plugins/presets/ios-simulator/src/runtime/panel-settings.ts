/**
 * 插件自己的配置。存在插件私有存储里，工作区配置页读写，活动 Tab 的显隐逻辑
 * 也要读它，所以放在 React 之外并提供订阅。
 */

export interface PanelSettings {
	/**
	 * 忽略「当前目录看起来是 iOS 工程」的判定，任何 macOS 会话都显示模拟器标签。
	 * 给工程不在仓库顶层（monorepo、子目录、只有 SPM 包）的用户兜底。
	 */
	readonly alwaysShowTab: boolean;
	/** 打开面板时自动拉起 baguette serve；关掉后改为手动点按钮启动。 */
	readonly autoStartServer: boolean;
	/**
	 * 面板默认进入的设备 udid。为 null 时自动挑选（已启动的优先，其次 iPhone 17 Pro）。
	 * 见 device-registry 的 selectPreferredDevice。
	 */
	readonly defaultDeviceUdid: string | null;
}

export const DEFAULT_PANEL_SETTINGS: PanelSettings = {
	alwaysShowTab: false,
	autoStartServer: true,
	defaultDeviceUdid: null,
};

/** 存储里的值是不可信输入：逐字段收窄，任何缺失或类型不符都回落到默认值。 */
export function normalizePanelSettings(value: unknown): PanelSettings {
	if (typeof value !== "object" || value === null) return DEFAULT_PANEL_SETTINGS;
	const record = value as Record<string, unknown>;
	return {
		alwaysShowTab:
			typeof record.alwaysShowTab === "boolean" ? record.alwaysShowTab : DEFAULT_PANEL_SETTINGS.alwaysShowTab,
		autoStartServer:
			typeof record.autoStartServer === "boolean"
				? record.autoStartServer
				: DEFAULT_PANEL_SETTINGS.autoStartServer,
		defaultDeviceUdid:
			typeof record.defaultDeviceUdid === "string" && record.defaultDeviceUdid.length > 0
				? record.defaultDeviceUdid
				: DEFAULT_PANEL_SETTINGS.defaultDeviceUdid,
	};
}

export interface PanelSettingsPorts {
	readJson(key: string): Promise<unknown>;
	writeJson(key: string, value: unknown): Promise<void>;
}

const STORAGE_KEY = "panel-settings";

/** 读写 + 订阅。读失败按默认值处理，不让存储故障挡住面板。 */
export class PanelSettingsStore {
	private settings: PanelSettings = DEFAULT_PANEL_SETTINGS;
	private loaded = false;
	private loading: Promise<PanelSettings> | null = null;
	private readonly listeners = new Set<(settings: PanelSettings) => void>();

	constructor(private readonly ports: PanelSettingsPorts) {}

	current(): PanelSettings {
		return this.settings;
	}

	subscribe(listener: (settings: PanelSettings) => void): () => void {
		this.listeners.add(listener);
		listener(this.settings);
		return () => this.listeners.delete(listener);
	}

	async load(): Promise<PanelSettings> {
		if (this.loaded) return this.settings;
		if (this.loading) return this.loading;
		this.loading = this.ports
			.readJson(STORAGE_KEY)
			.catch(() => null)
			.then((raw) => {
				this.loaded = true;
				this.apply(normalizePanelSettings(raw));
				return this.settings;
			})
			.finally(() => {
				this.loading = null;
			});
		return this.loading;
	}

	async update(patch: Partial<PanelSettings>): Promise<PanelSettings> {
		this.apply({ ...this.settings, ...patch });
		this.loaded = true;
		await this.ports.writeJson(STORAGE_KEY, this.settings);
		return this.settings;
	}

	private apply(next: PanelSettings): void {
		this.settings = next;
		for (const listener of this.listeners) listener(next);
	}
}
