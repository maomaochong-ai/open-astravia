import { SettingsMenuAccountSection as ThemeSettingsMenuAccountSection } from "@vetta/theme-ui/sidebar";
import { useTranslation } from "react-i18next";
import type { SettingsMenuModel } from "./types";

interface SettingsMenuAccountSectionProps {
	model: SettingsMenuModel;
}

export function SettingsMenuAccountSection({ model }: SettingsMenuAccountSectionProps): JSX.Element {
	const { t } = useTranslation("settings");
	return (
		<ThemeSettingsMenuAccountSection
			loggedIn={Boolean(model.user)}
			loginLabel={t("sidebar.login")}
			logoutLabel={t("sidebar.logout")}
			onLogin={model.actions.login}
			onLogout={model.actions.logout}
		/>
	);
}
