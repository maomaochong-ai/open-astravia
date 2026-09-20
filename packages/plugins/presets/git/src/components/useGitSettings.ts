import { useEffect, useState } from "react";
import { DEFAULT_SETTINGS, type GitSettings, loadSettings, onSettingsChanged } from "../git/settings";

/**
 * Current plugin settings, refreshed when the settings page saves.
 *
 * Starts from the defaults so callers never deal with a null: a not-yet-loaded
 * settings file behaves exactly like an unconfigured one.
 */
export function useGitSettings(): GitSettings {
	const [settings, setSettings] = useState<GitSettings>(DEFAULT_SETTINGS);

	useEffect(() => {
		let alive = true;
		void loadSettings().then((value) => {
			if (alive) setSettings(value);
		});
		const off = onSettingsChanged(setSettings);
		return () => {
			alive = false;
			off();
		};
	}, []);

	return settings;
}
