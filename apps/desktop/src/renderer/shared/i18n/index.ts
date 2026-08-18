// Renderer i18next 实例。资源静态内联（见 ADR-0031），故 init 同步生效、首帧不闪。
// 初值来自主进程同步暴露的 window.vetta.i18n.initialState（preference + language）。

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import {
	DEFAULT_LANGUAGE,
	FALLBACK_LANGUAGE,
	isSupportedLanguage,
	NAMESPACES,
	resources,
} from "@/shared/i18n/resources";

function readInitialLanguage(): string {
	const state = window.vetta?.i18n?.initialState;
	if (state && isSupportedLanguage(state.language)) return state.language;
	const fromMain = window.vetta?.i18n?.initialLanguage;
	if (fromMain && isSupportedLanguage(fromMain)) return fromMain;
	// 极端兜底：preload 尚未就绪时默认英文（正常路径不会走到）。
	return DEFAULT_LANGUAGE;
}

let subscribed = false;

/** 在 React 挂载前同步调用（与 applyInitialTheme 并列）。幂等。 */
export function initI18n(): void {
	if (!i18n.isInitialized) {
		const lng = readInitialLanguage();
		// initAsync:false 强制同步初始化：i18next 默认把资源装载推到 setTimeout，
		// 那样 init() 返回后 isInitialized 仍为 false，createRoot 首帧的 useTranslation
		// 会拿到 key 或触发 Suspense。资源已静态内联、同步装载无 IO，故 init 返回即就绪。
		// useSuspense:false 再兜一层：即便未就绪也不抛 Suspense（无边界会崩），优雅降级。
		void i18n.use(initReactI18next).init({
			resources,
			lng,
			fallbackLng: FALLBACK_LANGUAGE,
			ns: NAMESPACES,
			defaultNS: "common",
			initAsync: false,
			interpolation: { escapeValue: false },
			returnNull: false,
			react: { useSuspense: false },
		});
		document.documentElement.lang = lng;
	}

	// 订阅主进程语言广播（含本窗口自身 setLanguage 的回环，changeLanguage 幂等）。
	if (!subscribed && window.vetta?.i18n) {
		subscribed = true;
		window.vetta.i18n.onLanguageChanged((state) => {
			void i18n.changeLanguage(state.language);
			document.documentElement.lang = state.language;
		});
	}
}

export { i18n };
