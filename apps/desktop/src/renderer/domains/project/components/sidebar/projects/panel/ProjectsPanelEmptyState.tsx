import { ProjectsPanelEmptyState as ThemeProjectsPanelEmptyState } from "@astravia-org/theme-ui/sidebar/ProjectsPanelEmptyState";
import { useTranslation } from "react-i18next";
import { AddProjectMenu } from "../../add-project/AddProjectMenu";

interface ProjectsPanelEmptyStateProps {
	onNewConversation: () => void;
}

/** Desktop adapter: injects i18n into props-driven empty state. */
export function ProjectsPanelEmptyState({
	onNewConversation,
}: ProjectsPanelEmptyStateProps): JSX.Element {
	const { t } = useTranslation("project");
	return (
		<ThemeProjectsPanelEmptyState
			labels={{
				title: t("sidebar.empty.title"),
				description: t("sidebar.empty.description"),
				newConversation: t("sidebar.defaultConversation.emptyAction"),
			}}
			onNewConversation={onNewConversation}
			projectAction={<AddProjectMenu variant="secondary" />}
		/>
	);
}
