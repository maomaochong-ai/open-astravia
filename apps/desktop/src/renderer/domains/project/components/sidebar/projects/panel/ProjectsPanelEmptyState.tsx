import { ProjectsPanelEmptyState as ThemeProjectsPanelEmptyState } from "@vetta/theme-ui/sidebar";
import { useTranslation } from "react-i18next";

/** Desktop adapter: injects i18n into props-driven empty state. */
export function ProjectsPanelEmptyState(): JSX.Element {
	const { t } = useTranslation("project");
	return (
		<ThemeProjectsPanelEmptyState
			labels={{
				title: t("sidebar.empty.title"),
				description: t("sidebar.empty.description"),
			}}
		/>
	);
}
