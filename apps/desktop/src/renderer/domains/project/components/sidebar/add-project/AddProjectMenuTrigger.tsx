import { AddProjectMenuTriggerView } from "@vetta/theme-ui/sidebar";
import { useTranslation } from "react-i18next";
import type { AddProjectMenuProps } from "./types";

interface AddProjectMenuTriggerProps {
	onClick: () => void;
	open: boolean;
	variant: NonNullable<AddProjectMenuProps["variant"]>;
}

export function AddProjectMenuTrigger({
	onClick,
	open,
	variant,
}: AddProjectMenuTriggerProps): JSX.Element {
	const { t } = useTranslation("project");
	return (
		<AddProjectMenuTriggerView
			label={t("actions.newProject")}
			onClick={onClick}
			open={open}
			variant={variant}
		/>
	);
}
