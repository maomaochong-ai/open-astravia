import { Button } from "@vetta-org/ui";
import type { InputBarPlanModeStatusModel } from "./types";

/** 输入卡片下沿的计划模式状态条：说明当前约束的后果，并就地给出退出入口。 */
export function InputBarPlanModeStatus({ status }: { status: InputBarPlanModeStatusModel }): JSX.Element {
	return (
		<div role="status" className="mt-1.5 flex items-center gap-1.5 px-2 text-[12px] text-muted-foreground">
			<span className="icon-[solar--clipboard-list-linear] h-3.5 w-3.5 shrink-0 text-primary" />
			<span className="min-w-0 flex-1 truncate">{status.text}</span>
			<Button variant="ghost" size="xs" onClick={status.onExit}>
				{status.exitLabel}
			</Button>
		</div>
	);
}
