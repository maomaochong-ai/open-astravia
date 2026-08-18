import type { BatchProject } from "@shared/store/atoms";
import { BatchQueueStatusView } from "@vetta/theme-ui/project";
import { useBatchQueueStatusModel } from "../hooks/useBatchQueueStatusModel";

interface BatchQueueStatusProps {
	project: BatchProject;
}

export function BatchQueueStatus({ project }: BatchQueueStatusProps): JSX.Element {
	const model = useBatchQueueStatusModel(project);
	return <BatchQueueStatusView {...model} />;
}
