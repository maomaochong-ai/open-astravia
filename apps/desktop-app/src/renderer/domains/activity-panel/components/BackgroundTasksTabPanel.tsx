import { BackgroundTasksTabPanelView } from "@vetta/theme-ui/activity";
import { useBackgroundTasksTabPanelModel } from "../hooks/useBackgroundTasksTabPanelModel";

export function BackgroundTasksTabPanel(): JSX.Element {
	const model = useBackgroundTasksTabPanelModel();

	return (
		<BackgroundTasksTabPanelView
			items={model.items}
			emptyLabel={model.emptyLabel}
			clearFinishedLabel={model.clearFinishedLabel}
			onClearFinished={model.onClearFinished}
			stopLabel={model.stopLabel}
			onStop={model.onStop}
		/>
	);
}
