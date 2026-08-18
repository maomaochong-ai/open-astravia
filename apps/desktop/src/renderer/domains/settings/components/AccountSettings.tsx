import { AccountSettingsView } from "./AccountSettingsView";
import { useAccountSettingsModel } from "./useAccountSettingsModel";

export function AccountSettings(): JSX.Element {
	return <AccountSettingsView model={useAccountSettingsModel()} />;
}
