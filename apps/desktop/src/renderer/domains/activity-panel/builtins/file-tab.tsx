import { useTranslation } from "react-i18next";
import { FileTabContent } from "../components/file-tab/FileTabContent";
import { useActivityPanelCwd } from "../registry/context";
import type { ActivityTabDefinition } from "../registry/types";

function FileActivityTab(): JSX.Element {
	const cwd = useActivityPanelCwd();
	return <FileTabContent cwd={cwd} />;
}

export const fileTabDefinition: ActivityTabDefinition = {
	id: "file",
	order: 0,
	removable: false,
	source: "builtin",
	useMeta: () => {
		const { t } = useTranslation("chat");
		return {
			label: t("activityPanel.tabs.file"),
			icon: "icon-[mdi--file-document-outline]",
		};
	},
	component: FileActivityTab,
};
