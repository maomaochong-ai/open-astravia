import type { DefaultConversationFilter, SidebarFilter } from "@shared/store/atoms";
import {
	useDefaultConversationFilterSelectModel,
	useSidebarFilterSelectModel,
} from "../../../hooks/useSidebarFilterSelectModel";
import { SidebarFilterSelectView } from "./SidebarFilterSelectView";

export function SidebarFilterSelect(): JSX.Element {
	const model = useSidebarFilterSelectModel();
	return (
		<SidebarFilterSelectView
			options={model.options}
			showGridIcon={model.showGridIcon}
			value={model.value}
			onChange={(value) => model.onChange(value as SidebarFilter)}
		/>
	);
}

export function DefaultConversationFilterSelect(): JSX.Element {
	const model = useDefaultConversationFilterSelectModel();
	return (
		<SidebarFilterSelectView
			options={model.options}
			showGridIcon={model.showGridIcon}
			value={model.value}
			onChange={(value) => model.onChange(value as DefaultConversationFilter)}
		/>
	);
}
