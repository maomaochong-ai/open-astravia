import { BatchProgressTabPanelView } from "@vetta/theme-ui/activity";
import { BatchQueueStatus } from "@domains/project/components/BatchQueueStatus";
import { useBatchProgressTabPanelModel } from "../hooks/useBatchProgressTabPanelModel";

interface BatchProgressTabPanelProps {
	cwd: string;
}

export function BatchProgressTabPanel({ cwd }: BatchProgressTabPanelProps): JSX.Element {
	const model = useBatchProgressTabPanelModel(cwd);

	return (
		<BatchProgressTabPanelView emptyLabel={model.emptyLabel}>
			{model.project ? <BatchQueueStatus project={model.project} /> : null}
		</BatchProgressTabPanelView>
	);
}
