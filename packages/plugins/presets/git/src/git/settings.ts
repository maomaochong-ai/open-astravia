import { readJsonFile, writeJsonFile } from "@vetta-org/plugin-sdk";
import { getStorageApi, settingsListeners } from "./runtime";

/** Plugin-private settings file (global to the plugin, not per project). */
const SETTINGS_PATH = "settings.json";

export interface GitSettings {
	/**
	 * Free-form requirements for generated commit messages, written as a prompt
	 * ("use conventional commits", "body in Chinese", …).
	 *
	 * Global on purpose: a project's own rules belong in its AGENTS.md / CLAUDE.md,
	 * where every agent benefits and generation already gives them priority. This
	 * template is the user's personal fallback for projects that state nothing.
	 */
	messageTemplate: string;
	/** Push straight after a successful commit from the main button. */
	pushAfterCommit: boolean;
	/** Ask before discarding working-tree changes. Off is a deliberate opt-out. */
	confirmDiscard: boolean;
}

export const DEFAULT_SETTINGS: GitSettings = {
	messageTemplate: "",
	pushAfterCommit: false,
	confirmDiscard: true,
};

/** Tolerate partial or hand-edited files rather than throwing at the UI. */
function normalize(raw: Partial<GitSettings> | null): GitSettings {
	return {
		messageTemplate: typeof raw?.messageTemplate === "string" ? raw.messageTemplate : DEFAULT_SETTINGS.messageTemplate,
		pushAfterCommit: raw?.pushAfterCommit === true,
		confirmDiscard: raw?.confirmDiscard !== false,
	};
}

export async function loadSettings(): Promise<GitSettings> {
	try {
		return normalize(await readJsonFile<Partial<GitSettings>>(getStorageApi(), SETTINGS_PATH));
	} catch {
		return DEFAULT_SETTINGS;
	}
}

export async function saveSettings(settings: GitSettings): Promise<void> {
	await writeJsonFile(getStorageApi(), SETTINGS_PATH, settings);
	for (const listener of settingsListeners()) listener(settings);
}

/** Subscribe to saves so open panels pick up a settings change immediately. */
export function onSettingsChanged(listener: (settings: GitSettings) => void): () => void {
	const set = settingsListeners();
	const wrapped = (value: unknown): void => listener(value as GitSettings);
	set.add(wrapped);
	return () => set.delete(wrapped);
}
