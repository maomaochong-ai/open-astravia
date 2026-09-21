import {
	DEFAULT_FILE_EXPLORER_PREFERENCES,
	type FileExplorerPreferences,
} from "@shared/lib/file-explorer-preferences";
import { fileExplorerPreferencesAtom, pluginFileIconThemesAtom } from "@shared/store/atoms";
import { FileExplorerSettingsView } from "@vetta-org/theme-ui/file-explorer";
import { useAtom, useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePluginTextResolver } from "../../plugins/runtime/plugin-i18n";

export function FileExplorerSettings(): JSX.Element {
	const { t } = useTranslation("chat");
	const [preferences, setPreferences] = useAtom(fileExplorerPreferencesAtom);
	const themes = useAtomValue(pluginFileIconThemesAtom);
	const resolveText = usePluginTextResolver();
	const [exclude, setExclude] = useState(preferences.exclude.join("\n"));
	const [error, setError] = useState<string | null>(null);
	useEffect(() => setExclude(preferences.exclude.join("\n")), [preferences.exclude]);
	const save = (next: FileExplorerPreferences) => {
		try {
			setPreferences(next);
			setError(null);
		} catch {
			setError(t("fileExplorer.display.saveFailed"));
		}
	};
	const options = [
		{ id: "builtin", label: t("fileExplorer.display.builtin") },
		...themes.map((theme) => ({ id: theme.id, label: resolveText(theme.pluginId, theme.label) })),
	];
	if (!options.some((option) => option.id === preferences.iconTheme)) {
		options.push({ id: preferences.iconTheme, label: t("fileExplorer.display.unavailable") });
	}
	return (
		<FileExplorerSettingsView
			showHidden={preferences.showHidden}
			exclude={exclude}
			iconTheme={preferences.iconTheme}
			themes={options}
			error={error}
			labels={{
				title: t("fileExplorer.display.title"),
				showHidden: t("fileExplorer.display.showHidden"),
				exclude: t("fileExplorer.display.exclude"),
				excludeHint: t("fileExplorer.display.excludeHint"),
				iconTheme: t("fileExplorer.display.iconTheme"),
				save: t("fileExplorer.display.apply"),
				reset: t("fileExplorer.display.reset"),
			}}
			onShowHiddenChange={(showHidden) => save({ ...preferences, showHidden })}
			onExcludeChange={setExclude}
			onSaveExclude={() => {
				const patterns = exclude
					.split("\n")
					.map((line) => line.trim())
					.filter(Boolean);
				if (patterns.length > 100 || patterns.some((pattern) => pattern.length > 1024)) {
					setError(t("fileExplorer.display.invalidPatterns"));
					return;
				}
				save({ ...preferences, exclude: patterns });
			}}
			onIconThemeChange={(iconTheme) => save({ ...preferences, iconTheme })}
			onReset={() => save({ ...DEFAULT_FILE_EXPLORER_PREFERENCES })}
		/>
	);
}
