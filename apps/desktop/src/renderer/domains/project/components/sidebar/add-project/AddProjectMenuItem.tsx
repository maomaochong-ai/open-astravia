import { AddProjectMenuItem as ThemeAddProjectMenuItem } from "@vetta/theme-ui/sidebar";
import { useTranslation } from "react-i18next";
import type { AddProjectMenuItemModel } from "./types";

interface AddProjectMenuItemProps {
	item: AddProjectMenuItemModel;
}

/** Desktop adapter: resolves i18n labelKey for props-driven menu item. */
export function AddProjectMenuItem({ item }: AddProjectMenuItemProps): JSX.Element {
	const { t } = useTranslation("project");
	return (
		<ThemeAddProjectMenuItem icon={item.icon} label={t(item.labelKey)} onSelect={item.onSelect} />
	);
}
