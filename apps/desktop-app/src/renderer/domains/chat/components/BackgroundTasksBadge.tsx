import { BackgroundTasksBadgeView } from "@vetta/theme-ui/chat";
import { useBackgroundTasksBadgeModel } from "../hooks/useBackgroundTasksBadgeModel";

/**
 * 右上角后台任务 badge：显示当前 session 运行中的后台任务数。
 * 点击打开活动面板并切换到「后台任务」tab。
 */
export function BackgroundTasksBadge(): JSX.Element | null {
	const model = useBackgroundTasksBadgeModel();
	if (model.runningCount === null) return null;

	return (
		<BackgroundTasksBadgeView
			runningCount={model.runningCount}
			title={model.title}
			onClick={model.onClick}
		/>
	);
}
