import { ShortcutsSettingsView } from "./ShortcutsSettingsView";
import { useShortcutsSettingsModel } from "./useShortcutsSettingsModel";

export function ShortcutsSettings(): JSX.Element {
	const model = useShortcutsSettingsModel();
	return <ShortcutsSettingsView model={model} />;
}
