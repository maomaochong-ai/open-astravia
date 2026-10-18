import { TodoTabPanelView } from "@astravia-org/theme-ui/activity/TodoTabPanelView";
import { useTodoTabPanelModel } from "../hooks/useTodoTabPanelModel";

export function TodoTabPanel(): JSX.Element {
	const model = useTodoTabPanelModel();
	return (
		<TodoTabPanelView
			items={model.items}
			emptyLabel={model.emptyLabel}
			labels={model.labels}
			onClear={() => void model.clearTodos()}
		/>
	);
}
