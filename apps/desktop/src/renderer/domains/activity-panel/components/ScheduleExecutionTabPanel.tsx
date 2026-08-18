import { ScheduleExecutionTabPanelView } from "@vetta/theme-ui/activity";
import { useScheduleExecutionTabPanelModel } from "../hooks/useScheduleExecutionTabPanelModel";

interface ScheduleExecutionTabPanelProps {
	cwd: string;
}

export function ScheduleExecutionTabPanel({ cwd }: ScheduleExecutionTabPanelProps): JSX.Element {
	const model = useScheduleExecutionTabPanelModel(cwd);
	return (
		<ScheduleExecutionTabPanelView
			labels={model.labels}
			empty={model.empty}
			summaries={model.summaries}
			refreshButton={model.refreshButton}
			tasks={model.tasks}
			records={model.records}
		/>
	);
}
