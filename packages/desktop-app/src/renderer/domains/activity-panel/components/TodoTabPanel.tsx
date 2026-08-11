import { TodoTabPanelView } from "@vetta/theme-ui/activity";
import { useTodoTabPanelModel } from "../hooks/useTodoTabPanelModel";

export function TodoTabPanel(): JSX.Element {
	const model = useTodoTabPanelModel();
	return <TodoTabPanelView items={model.items} emptyLabel={model.emptyLabel} labels={model.labels} />;
}
