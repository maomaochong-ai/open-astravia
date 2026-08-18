import { ShowMoreSessionsButton as ThemeShowMoreSessionsButton } from "@vetta/theme-ui/sidebar";
import { useTranslation } from "react-i18next";

interface ShowMoreSessionsButtonProps {
	hiddenCount: number;
	onClick: () => void;
	showAll: boolean;
}

/** Desktop adapter: resolves i18n, then renders props-driven theme-ui view. */
export function ShowMoreSessionsButton({
	hiddenCount,
	onClick,
	showAll,
}: ShowMoreSessionsButtonProps): JSX.Element {
	const { t } = useTranslation("project");

	return (
		<ThemeShowMoreSessionsButton
			labels={{
				collapse: t("sidebar.projects.collapseSessions"),
				expand: t("sidebar.projects.expandMore", { count: hiddenCount }),
			}}
			onClick={onClick}
			showAll={showAll}
		/>
	);
}
