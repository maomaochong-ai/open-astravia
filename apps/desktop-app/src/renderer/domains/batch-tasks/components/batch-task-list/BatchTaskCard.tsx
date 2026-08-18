import type { BatchTask } from "@shared/store/atoms";
import { BatchTaskCardView } from "@vetta/theme-ui/batch-tasks";
import { memo } from "react";
import { useBatchTaskCardModel } from "../../hooks/useBatchTaskCardModel";
import type { TaskCallbacks } from "./types";

export const BatchTaskCard = memo(function BatchTaskCard({
	callbacks,
	isQueued,
	task,
}: {
	callbacks: TaskCallbacks;
	isQueued: boolean;
	task: BatchTask;
}): JSX.Element {
	const model = useBatchTaskCardModel(task, isQueued);

	return (
		<BatchTaskCardView
			callbacks={{
				delete: () => callbacks.delete(task),
				goToSession: () => callbacks.goToSession(task),
				resume: () => callbacks.resume(task.id),
				retry: () => callbacks.retry(task),
				run: () => callbacks.run(task.id),
				stop: () => callbacks.stop(task.id),
			}}
			labels={model.labels}
			task={model.task}
		/>
	);
});
