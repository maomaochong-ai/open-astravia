import { SettingsMenuThemeSection as ThemeSettingsMenuThemeSection } from "@vetta/theme-ui/sidebar";
import { useTranslation } from "react-i18next";
import type { SettingsMenuModel } from "./types";

interface SettingsMenuThemeSectionProps {
	model: SettingsMenuModel;
}

export function SettingsMenuThemeSection({ model }: SettingsMenuThemeSectionProps): JSX.Element {
	const { t } = useTranslation("settings");
	return (
		<ThemeSettingsMenuThemeSection
			title={t("theme.title")}
			mode={model.mode}
			options={model.themeOptions}
			onSetMode={(value, event) => model.actions.setMode(value as typeof model.mode, event)}
		/>
	);
}
