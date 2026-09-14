import { ScheduleStatusView } from "@vetta-org/theme-ui/project";
import { useScheduleStatusModel } from "../hooks/useScheduleStatusModel";

export function ScheduleStatus({ cwd }: { cwd: string }): JSX.Element | null {
	const model = useScheduleStatusModel(cwd);
	if (!model) return null;
	return <ScheduleStatusView {...model} />;
}
