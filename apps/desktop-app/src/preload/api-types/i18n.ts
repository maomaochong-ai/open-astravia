import type { LanguageState } from "../../shared/i18n/config.js";

export type { LanguageState };

export interface DesktopI18nApi {
	/**
	 * 主进程同步暴露的当前语言状态（preference + 解析后的 language）。
	 * preload 在桥接前经 sendSync 取得，renderer 可在首帧前据此初始化 i18next 防闪。
	 */
	readonly initialState: LanguageState;
	/**
	 * @deprecated 使用 initialState.language；保留给旧调用方兼容。
	 */
	readonly initialLanguage: string;
	/**
	 * @deprecated 使用 initialState.preference。
	 */
	readonly initialLanguagePreference: string;
	/**
	 * 切换语言偏好：`system` | `zh` | `en`。
	 * 主进程持久化 + 重建原生菜单 + 广播 onLanguageChanged。
	 */
	setLanguage(preference: string): Promise<LanguageState | undefined>;
	/** 订阅主进程下发的语言变更（含本窗口自身触发的回环）。返回取消订阅函数。 */
	onLanguageChanged(handler: (state: LanguageState) => void): () => void;
}
