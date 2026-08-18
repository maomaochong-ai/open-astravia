// 引导窗独立 i18next 实例（与 quickpanel 一样自带 Provider，不共用主窗口 runtime 实例）。
// 复用主窗口 "settings" ns 的 zh/en 资源（而非另起新 ns），
// 决策见 computer-use 实现规格：省掉新 ns 在 NAMESPACES/resources/i18next.d.ts 的三处注册。
// onboarding* 前缀 key 由 settings.json 承载，故这里沿用 react-i18next 标准 useTranslation("settings")，
// 全局 i18next.d.ts 的类型增强（基于 settings.json 实际内容）照常校验 key。

import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { type AppLanguage, resolveAppLanguageFromLocale, resources } from "@/shared/i18n/resources";

function detectLanguage(): AppLanguage {
	// 真相源：main 已按 config 或系统 locale 解析；缺失时用 navigator 兜底（与 main 同一套规则）。
	const fromBridge = window.vettaOnboarding?.initialLanguage;
	return resolveAppLanguageFromLocale(fromBridge ?? navigator.language);
}

export const i18n = i18next.createInstance();

/** 在 React 挂载前同步调用。资源内联、同步装载，init 返回即就绪、首帧不闪。 */
export function initOnboardingI18n(): void {
	if (i18n.isInitialized) return;
	const lng = detectLanguage();
	void i18n.use(initReactI18next).init({
		resources: {
			zh: { settings: resources.zh.settings },
			en: { settings: resources.en.settings },
		},
		lng,
		fallbackLng: "zh",
		ns: ["settings"],
		defaultNS: "settings",
		initAsync: false,
		interpolation: { escapeValue: false },
		returnNull: false,
		react: { useSuspense: false },
	});
	document.documentElement.lang = lng;
}

/** 跟随 App 语言切换实时刷新引导窗文案；返回取消订阅函数。 */
export function subscribeOnboardingLanguage(): () => void {
	const bridge = window.vettaOnboarding;
	if (!bridge?.onLanguageChanged) return () => {};
	return bridge.onLanguageChanged((lang) => {
		const next = resolveAppLanguageFromLocale(lang);
		void i18n.changeLanguage(next);
		document.documentElement.lang = next;
	});
}
