import { UpdateCheckerAction, UpdateCheckerDetail, UpdateCheckerView } from "@vetta/theme-ui/overlays";
import { useUpdateCheckerModel } from "../hooks/useUpdateCheckerModel";

/** Standalone compose (settings 页请用 Action + Detail + SettingRow，见 GeneralSettingsView)。 */
export function UpdateChecker(): JSX.Element {
	return <UpdateCheckerView {...useUpdateCheckerModel()} />;
}

export { UpdateCheckerAction, UpdateCheckerDetail };
