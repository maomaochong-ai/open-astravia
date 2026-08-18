import { SettingsMenuQuotaSection as ThemeSettingsMenuQuotaSection } from "@vetta/theme-ui/sidebar";
import { useTranslation } from "react-i18next";
import { getResetCountdown } from "@shared/lib/subscription-format";
import type { SettingsMenuModel } from "./types";

interface SettingsMenuQuotaSectionProps {
	model: SettingsMenuModel;
}

export function SettingsMenuQuotaSection({
	model,
}: SettingsMenuQuotaSectionProps): JSX.Element | null {
	const { t } = useTranslation("settings");
	if (!model.fiveHourResetAt) return null;

	const countdown = getResetCountdown(model.fiveHourResetAt, Date.now());

	return (
		<ThemeSettingsMenuQuotaSection
			fiveHourRemainingPercent={model.fiveHourRemainingPercent}
			resetCountdown={countdown ? t(countdown.key, countdown.params) : ""}
			quotaLabel={t("sidebar.fiveHourQuota")}
		/>
	);
}
