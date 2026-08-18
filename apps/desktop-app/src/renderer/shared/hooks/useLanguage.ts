import { i18n } from "@shared/i18n";
import { languageAtom, languagePreferenceAtom } from "@shared/store/atoms";
import { useAtom } from "jotai";
import { useCallback, useEffect } from "react";
import { type AppLanguage, type LanguagePreference, resolveAppLanguageFromLocale } from "@/shared/i18n/config";

export function useLanguage(): {
	/** 解析后的实际界面语言（i18next）。 */
	language: AppLanguage;
	/** 用户偏好（含 system）；设置/引导页选中态用此值。 */
	languagePreference: LanguagePreference;
	setLanguage: (preference: LanguagePreference) => Promise<void>;
} {
	const [language, setLanguageAtom] = useAtom(languageAtom);
	const [languagePreference, setPreferenceAtom] = useAtom(languagePreferenceAtom);

	// 同步主进程广播（含其它窗口 / Agent Action），保持 preference 选中态一致。
	useEffect(() => {
		return window.vetta.i18n.onLanguageChanged((state) => {
			setPreferenceAtom(state.preference);
			setLanguageAtom(state.language);
		});
	}, [setLanguageAtom, setPreferenceAtom]);

	const setLanguage = useCallback(
		async (preference: LanguagePreference): Promise<void> => {
			if (preference === languagePreference) return;
			// 乐观即时切：本窗口先变，再写主进程（持久化 + 重建菜单 + 广播回环幂等）。
			// system 时用 navigator 预估；权威结果以主进程返回 / 广播为准。
			const resolved = preference === "system" ? resolveAppLanguageFromLocale(navigator.language) : preference;
			setPreferenceAtom(preference);
			setLanguageAtom(resolved);
			await i18n.changeLanguage(resolved);
			document.documentElement.lang = resolved;
			const state = await window.vetta.i18n.setLanguage(preference);
			if (state && typeof state === "object") {
				setPreferenceAtom(state.preference);
				setLanguageAtom(state.language);
				if (state.language !== resolved) {
					await i18n.changeLanguage(state.language);
					document.documentElement.lang = state.language;
				}
			}
		},
		[languagePreference, setLanguageAtom, setPreferenceAtom],
	);

	return { language, languagePreference, setLanguage };
}
