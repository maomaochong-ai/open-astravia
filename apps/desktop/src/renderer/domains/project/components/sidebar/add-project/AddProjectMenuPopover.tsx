import { AddProjectMenuPopoverView } from "@vetta/theme-ui/sidebar";
import { useTranslation } from "react-i18next";
import type { AddProjectMenuItemModel, AddProjectMenuProps } from "./types";

interface AddProjectMenuPopoverProps {
	items: AddProjectMenuItemModel[];
	open: boolean;
	variant: NonNullable<AddProjectMenuProps["variant"]>;
}

export function AddProjectMenuPopover({
	items,
	open,
	variant,
}: AddProjectMenuPopoverProps): JSX.Element {
	const { t } = useTranslation("project");
	return (
		<AddProjectMenuPopoverView
			items={items.map((item) => ({
				action: item.action,
				icon: item.icon,
				label: t(item.labelKey),
				onSelect: item.onSelect,
			}))}
			open={open}
			variant={variant}
		/>
	);
}
