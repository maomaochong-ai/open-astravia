import { useTranslation } from "react-i18next";
import { SidebarFilterSelectView } from "@vetta/theme-ui/sidebar";
import type { DefaultConversationFilterOption, SidebarFilterOption } from "./types";

interface FilterSelectPopoverProps<TValue extends string> {
	current: SidebarFilterOption | DefaultConversationFilterOption;
	options: readonly (SidebarFilterOption | DefaultConversationFilterOption)[];
	onChange: (value: TValue) => void;
	showGridIcon?: boolean;
	value: TValue;
}

/** Thin i18n adapter over theme-ui SidebarFilterSelectView (legacy name retained). */
export function FilterSelectPopover<TValue extends string>({
	options,
	onChange,
	showGridIcon = false,
	value,
}: FilterSelectPopoverProps<TValue>): JSX.Element {
	const { t } = useTranslation("project");

	return (
		<SidebarFilterSelectView
			options={options.map((option) => ({
				value: option.value,
				label: t(option.labelKey),
			}))}
			showGridIcon={showGridIcon}
			value={value}
			onChange={(next) => onChange(next as TValue)}
		/>
	);
}
