// 主进程 i18next 实例：用于原生菜单（tray / pet 右键）与系统通知文案。
// 与 renderer 共享同一套 catalog（src/shared/i18n），但这里不接 react，defaultNS=main。
// 语言偏好真相源是 ~/.vetta/desktop-config.json 的 language 字段（见 ADR-0031），
// 取值 system | zh | en；initAppLanguage() 在 app.whenReady 内、建任何菜单之前同步调用。

import { app } from "electron";
import i18next from "i18next";
import {
	type AppLanguage,
	DEFAULT_LANGUAGE,
	DEFAULT_LANGUAGE_PREFERENCE,
	FALLBACK_LANGUAGE,
	isLanguagePreference,
	type LanguagePreference,
	type LanguageState,
	NAMESPACES,
	resolveAppLanguage,
	resources,
} from "../../shared/i18n/resources.js";
import { readConfigSync } from "../config/desktop-config-store.js";

const mainI18n = i18next.createInstance();
let currentPreference: LanguagePreference = DEFAULT_LANGUAGE_PREFERENCE;
let currentLanguage: AppLanguage = DEFAULT_LANGUAGE;

/** 读 OS 系统 locale（优先 getSystemLocale，回退 getLocale）。 */
export function readSystemLocale(): string {
	try {
		const system = typeof app.getSystemLocale === "function" ? app.getSystemLocale() : "";
		if (system) return system;
	} catch {
		// ignore
	}
	try {
		return app.getLocale() || "";
	} catch {
		return "";
	}
}

function readStoredPreference(): LanguagePreference {
	const stored = readConfigSync().language;
	return isLanguagePreference(stored) ? stored : DEFAULT_LANGUAGE_PREFERENCE;
}

/**
 * 同步初始化主进程语言：
 * - desktop-config.language = system | 缺省 → 跟随系统 locale
 * - zh / en → 固定语言
 */
export function initAppLanguage(): void {
	currentPreference = readStoredPreference();
	currentLanguage = resolveAppLanguage(currentPreference, readSystemLocale());
	// initAsync:false 强制同步初始化（i18next 默认把资源装载推到 setTimeout，
	// 那样 init 返回后 isInitialized 仍为 false、t() 暂吐 key）。资源已静态内联，
	// 同步装载无 IO 成本，保证 init 返回即可用——后续 mainT() 立刻拿到译文。
	void mainI18n.init({
		resources,
		lng: currentLanguage,
		fallbackLng: FALLBACK_LANGUAGE,
		ns: NAMESPACES,
		defaultNS: "main",
		initAsync: false,
		interpolation: { escapeValue: false },
	});
}

export function getLanguagePreference(): LanguagePreference {
	return currentPreference;
}

export function getAppLanguage(): AppLanguage {
	return currentLanguage;
}

export function getLanguageState(): LanguageState {
	return { preference: currentPreference, language: currentLanguage };
}

/**
 * 应用语言偏好：更新 preference + 解析后的 AppLanguage，并切换 main i18n。
 * 持久化与广播由 ipc/i18n.ts 负责。
 */
export function applyLanguagePreference(preference: LanguagePreference): LanguageState {
	currentPreference = preference;
	currentLanguage = resolveAppLanguage(preference, readSystemLocale());
	void mainI18n.changeLanguage(currentLanguage);
	return getLanguageState();
}

/**
 * 主进程取文案。key 默认走 main ns（如 "tray.showWindow"），可 "common:..." 跨 ns。
 * 全局类型增强（CustomTypeOptions）把 t 收紧到 renderer 的字面量 key，主进程是动态取值，
 * 故在此用一处函数型断言放开——不引入 any，仅放宽签名。
 */
export function mainT(key: string, options?: Record<string, unknown>): string {
	// 必须在调用时取 mainI18n.t：init() 会重新绑定 .t，模块加载期捕获会拿到 init 前的桩。
	const t = mainI18n.t as unknown as (key: string, options?: Record<string, unknown>) => string;
	return t(key, options);
}
