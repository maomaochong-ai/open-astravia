import { useExecutionHistoryModel } from "../hooks/useExecutionHistoryModel";
import { ExecutionHistoryView } from "./ExecutionHistoryView";

interface ExecutionHistoryProps {
	taskId: string;
	/**
	 * 嵌入抽屉时去掉自带外框/标题，body 自适应填满父容器高度；
	 * 独立使用（旧布局）时保留卡片外观。
	 */
	embedded?: boolean;
}

export function ExecutionHistory({ taskId, embedded = false }: ExecutionHistoryProps): JSX.Element {
	return <ExecutionHistoryView {...useExecutionHistoryModel(taskId)} embedded={embedded} />;
}
