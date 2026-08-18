import type { IpcRenderer } from "electron";
import {
	DEFAULT_LANGUAGE,
	DEFAULT_LANGUAGE_PREFERENCE,
	isLanguagePreference,
	isSupportedLanguage,
	type LanguageState,
} from "../../shared/i18n/config.js";
import type { DesktopApi } from "../api.js";
import { onIpcEvent } from "./helper.js";

const GET_INITIAL_CHANNEL = "vetta:i18n:get-initial-language";
const SET_LANGUAGE_CHANNEL = "vetta:i18n:set-language";
const LANGUAGE_CHANGED_CHANNEL = "vetta:i18n:language-changed";

function normalizeLanguageState(raw: unknown): LanguageState {
	if (raw && typeof raw === "object" && !Array.isArray(raw)) {
		const r = raw as Record<string, unknown>;
		const preference = isLanguagePreference(r.preference) ? r.preference : DEFAULT_LANGUAGE_PREFERENCE;
		const language = isSupportedLanguage(r.language)
			? r.language
			: preference === "system"
				? DEFAULT_LANGUAGE
				: preference;
		return { preference, language };
	}
	// 旧版 sendSync 曾返回纯语言字符串；防御性兼容。
	if (isSupportedLanguage(raw)) {
		return { preference: raw, language: raw };
	}
	if (isLanguagePreference(raw)) {
		return {
			preference: raw,
			language: raw === "system" ? DEFAULT_LANGUAGE : raw,
		};
	}
	return { preference: DEFAULT_LANGUAGE_PREFERENCE, language: DEFAULT_LANGUAGE };
}

export function createI18nApi(ipc: IpcRenderer): Pick<DesktopApi, "i18n"> {
	// sendSync 在 preload 求值期同步取主进程当前语言状态，供 renderer 首帧前读取。
	const initialState = normalizeLanguageState(ipc.sendSync(GET_INITIAL_CHANNEL));
	return {
		i18n: {
			initialState,
			initialLanguage: initialState.language,
			initialLanguagePreference: initialState.preference,
			setLanguage: (preference: string) =>
				ipc.invoke(SET_LANGUAGE_CHANNEL, preference) as Promise<LanguageState | undefined>,
			onLanguageChanged: (handler) =>
				onIpcEvent(ipc, LANGUAGE_CHANGED_CHANNEL, (data: unknown) => {
					handler(normalizeLanguageState(data));
				}),
		},
	};
}
