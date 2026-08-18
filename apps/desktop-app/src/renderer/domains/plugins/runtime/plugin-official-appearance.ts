import { i18n } from "@shared/i18n";
import type { PluginOfficialApi } from "@vetta-org/plugin-sdk";
import { getDefaultStore } from "jotai";
import { cursorStyleAtom, resolvedThemeAtom, themeModeAtom, themeNameAtom } from "../../../shared/store/ui-atoms";
import { applyTheme, MODE_STORAGE_KEY, type ResolvedMode, THEME_STORAGE_KEY } from "../../../shared/theme/apply";
import { type CursorStyle, getStoredCursorStyle, setStoredCursorStyle } from "../../../shared/theme/cursor";
import { DEFAULT_THEME_ID, resolveThemeId, THEME_MAP, THEMES } from "../../../shared/theme/themes";
import { pluginRendererCapabilityHost } from "./plugin-renderer-capability-host";

function currentLanguage(): "zh" | "en" {
	return i18n.language?.startsWith("en") ? "en" : "zh";
}

export function listOfficialThemeIds(): string[] {
	return Object.keys(THEME_MAP);
}

function getThemeSnapshot() {
	const storedMode = localStorage.getItem(MODE_STORAGE_KEY);
	const storedThemeId = localStorage.getItem(THEME_STORAGE_KEY);
	const root = document.documentElement;
	const resolvedMode = root.getAttribute("data-mode");
	return {
		mode: storedMode === "light" || storedMode === "dark" || storedMode === "auto" ? storedMode : "dark",
		themeId: resolveThemeId(storedThemeId && storedThemeId.length > 0 ? storedThemeId : DEFAULT_THEME_ID),
		resolved: resolvedMode === "light" || resolvedMode === "dark" ? resolvedMode : null,
		appliedThemeId: root.getAttribute("data-theme"),
		cursorStyle: getStoredCursorStyle(),
	};
}

async function resolveMode(mode: "light" | "dark" | "auto"): Promise<ResolvedMode> {
	if (mode === "auto") {
		try {
			const native = await window.vetta.theme.getNative();
			return native.shouldUseDarkColors ? "dark" : "light";
		} catch {
			return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
		}
	}
	return mode;
}

export async function getOfficialAppearanceHelp(): Promise<unknown> {
	const state = getThemeSnapshot();
	const native = await window.vetta.theme.getNative().catch(() => null);
	return {
		type: "help",
		description:
			"appearance.query 只读：type=help 返回本说明与主题目录，type=get 返回当前外观。变更请用 appearance.theme（type=set / set-language）。",
		state,
		themes: THEMES.map(({ id, label }) => ({ id, label })),
		language: currentLanguage(),
		native,
		guidance:
			"只读：appearance.query help|get。写操作：appearance.theme type=set（mode/themeId/cursorStyle）或 type=set-language。",
	};
}

export async function getOfficialAppearanceState(): Promise<unknown> {
	const state = getThemeSnapshot();
	const native = await window.vetta.theme.getNative().catch(() => null);
	return {
		...state,
		language: currentLanguage(),
		native,
		rendererAvailable: true,
		rendererSynced: true,
	};
}

export async function setOfficialAppearance(input: {
	mode?: "light" | "dark" | "auto";
	themeId?: string;
	cursorStyle?: CursorStyle;
}): Promise<unknown> {
	if (input.mode === undefined && input.themeId === undefined && input.cursorStyle === undefined) {
		throw new Error("Appearance set requires mode, themeId, or cursorStyle after approval.");
	}
	if (input.themeId !== undefined && !THEME_MAP[input.themeId]) {
		throw new Error(`Unknown color theme: ${input.themeId}`);
	}

	const store = getDefaultStore();
	if (input.cursorStyle !== undefined) {
		setStoredCursorStyle(input.cursorStyle);
		store.set(cursorStyleAtom, input.cursorStyle);
	}

	const nextThemeId =
		input.themeId !== undefined
			? resolveThemeId(input.themeId)
			: resolveThemeId(localStorage.getItem(THEME_STORAGE_KEY) ?? DEFAULT_THEME_ID);
	if (input.themeId !== undefined) {
		localStorage.setItem(THEME_STORAGE_KEY, nextThemeId);
		store.set(themeNameAtom, nextThemeId);
	}

	if (input.mode !== undefined) {
		localStorage.setItem(MODE_STORAGE_KEY, input.mode);
		if (input.mode === "auto") {
			await window.vetta.theme.set("system").catch(() => {});
		} else {
			await window.vetta.theme.set(input.mode).catch(() => {});
		}
		const resolved = await resolveMode(input.mode);
		store.set(themeModeAtom, input.mode);
		store.set(resolvedThemeAtom, resolved);
		applyTheme(resolved, nextThemeId);
	} else if (input.themeId !== undefined) {
		const resolved = store.get(resolvedThemeAtom);
		applyTheme(resolved, nextThemeId);
	}

	const native = await window.vetta.theme.getNative().catch(() => null);
	return {
		type: "set",
		requested: input,
		state: getThemeSnapshot(),
		native,
		rendererAvailable: true,
		rendererSynced: true,
	};
}

export async function setOfficialLanguage(language: "zh" | "en"): Promise<unknown> {
	await window.vetta.i18n.setLanguage(language);
	return { type: "set-language", language };
}

export function createOfficialAppearanceApi(capabilitySessionId: string): PluginOfficialApi["appearance"] {
	return {
		help: () => pluginRendererCapabilityHost.invokeOfficial(capabilitySessionId, () => getOfficialAppearanceHelp()),
		get: () => pluginRendererCapabilityHost.invokeOfficial(capabilitySessionId, () => getOfficialAppearanceState()),
		set: (input) =>
			pluginRendererCapabilityHost.invokeOfficial(capabilitySessionId, () => setOfficialAppearance(input)),
		setLanguage: (language) =>
			pluginRendererCapabilityHost.invokeOfficial(capabilitySessionId, () => setOfficialLanguage(language)),
		listThemeIds: () =>
			pluginRendererCapabilityHost.invokeOfficial(capabilitySessionId, () => listOfficialThemeIds()),
	};
}
