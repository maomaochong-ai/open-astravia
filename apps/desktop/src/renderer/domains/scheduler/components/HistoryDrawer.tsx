import type { ScheduledTask } from "@shared/store/atoms";
import { useHistoryDrawerModel } from "../hooks/useHistoryDrawerModel";
import { HistoryDrawerView } from "./HistoryDrawerView";

interface HistoryDrawerProps {
	/** null = 抽屉关闭 */
	task: ScheduledTask | null;
	onClose: () => void;
	onEdit: (task: ScheduledTask) => void;
}

export function HistoryDrawer({ task, onClose, onEdit }: HistoryDrawerProps): JSX.Element {
	return (
		<HistoryDrawerView
			{...useHistoryDrawerModel({ task, onClose })}
			onClose={onClose}
			onEdit={() => {
				if (task) onEdit(task);
			}}
		/>
	);
}
