import { SettingsAiAssistButtonView } from "@vetta/theme-ui/settings";
import { useTranslation } from "react-i18next";

export interface SettingsAiAssistButtonProps {
	className?: string;
	onClick: () => void;
}

export function SettingsAiAssistButton({ className, onClick }: SettingsAiAssistButtonProps): JSX.Element {
	const { t } = useTranslation("settings");
	return <SettingsAiAssistButtonView label={t("aiAssist.cta")} className={className} onClick={onClick} />;
}
