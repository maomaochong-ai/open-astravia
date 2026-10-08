import { Button } from "@shared/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTitle,
	PopoverTrigger,
} from "@shared/components/ui/popover";
import { cn } from "@shared/lib/utils";
import type { CodingAgentGoalStatus } from "@vetta/coding-agent/session-extensions";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { InputBarGoalModel } from "./types";

const STATUS_KEYS = {
	active: "goalMode.status.active",
	paused: "goalMode.status.paused",
	blocked: "goalMode.status.blocked",
	usage_limited: "goalMode.status.usage_limited",
	complete: "goalMode.status.complete",
} as const;

function statusClassName(status: CodingAgentGoalStatus): string {
	switch (status) {
		case "active":
			return "text-primary";
		case "blocked":
			return "text-destructive";
		case "usage_limited":
			return "text-amber-400";
		case "complete":
			return "text-emerald-400";
		case "paused":
			return "text-muted-foreground";
	}
}

/** 当前目标的紧凑摘要；点击后才展开详情与管理操作。 */
export function InputBarGoalStatus({
	goal,
	className,
}: {
	readonly goal: InputBarGoalModel;
	readonly className?: string;
}): JSX.Element {
	const { t } = useTranslation("chat");
	const [open, setOpen] = useState(false);
	const { state } = goal;
	const canResume =
		state.status === "paused" || state.status === "blocked" || state.status === "usage_limited";
	const statusLabel = t(STATUS_KEYS[state.status]);

	return (
		<div className={cn("flex min-w-0 justify-start px-1 pt-1.5", className)}>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<button
						type="button"
						aria-label={t("goalMode.summary.groupLabel")}
						title={state.objective}
						className={cn(
							"group flex min-w-0 max-w-full items-center gap-2 rounded-full px-2 py-1 text-[11px] transition-colors",
							open ? "bg-accent/60" : "hover:bg-accent/50",
						)}
					>
						<span
							aria-hidden
							className={cn(
								"icon-[solar--target-linear] h-3.5 w-3.5 shrink-0",
								statusClassName(state.status),
							)}
						/>
						<span className={cn("shrink-0 font-medium", statusClassName(state.status))}>
							{statusLabel}
						</span>
						<span className="min-w-0 flex-1 truncate text-left font-medium text-foreground">
							{state.objective}
						</span>
					</button>
				</PopoverTrigger>
				<PopoverContent
					side="top"
					align="start"
					sideOffset={8}
					className="w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border p-0"
				>
					<div className="px-3 pb-3 pt-2.5">
						<div className="flex items-center gap-2">
							<span
								aria-hidden
								className={cn(
									"icon-[solar--target-linear] h-4 w-4 shrink-0",
									statusClassName(state.status),
								)}
							/>
							<PopoverTitle className="min-w-0 flex-1 truncate text-[12px] font-medium">
								{t("goalMode.summary.groupLabel")}
							</PopoverTitle>
							<span className={cn("shrink-0 text-[11px] font-medium", statusClassName(state.status))}>
								{statusLabel}
							</span>
						</div>
						<p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-foreground">
							{state.objective}
						</p>
						{state.statusDetail ? (
							<p className="mt-1.5 whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground">
								{state.statusDetail}
							</p>
						) : null}
						<p className="mt-2 tabular-nums text-[10px] text-muted-foreground">
							{t("goalMode.summary.usage", {
								tokens: state.tokensUsed,
								seconds: state.timeUsedSeconds,
								count: state.continuationCount,
							})}
						</p>
					</div>
					<div className="flex items-center justify-end gap-1 border-t border-border px-2 py-1.5">
						{state.status === "active" ? (
							<Button
								type="button"
								variant="ghost"
								size="xs"
								disabled={goal.busy}
								onClick={() => void goal.onPause()}
							>
								<span aria-hidden className="icon-[solar--pause-circle-linear] h-3.5 w-3.5" />
								{t("goalMode.actions.pause")}
							</Button>
						) : null}
						{canResume ? (
							<Button
								type="button"
								variant="ghost"
								size="xs"
								disabled={goal.busy}
								onClick={() => void goal.onResume()}
							>
								<span aria-hidden className="icon-[solar--play-circle-linear] h-3.5 w-3.5" />
								{t("goalMode.actions.resume")}
							</Button>
						) : null}
						<Button
							type="button"
							variant="ghost"
							size="xs"
							disabled={goal.busy}
							onClick={() => void goal.onClear()}
						>
							<span aria-hidden className="icon-[solar--close-circle-linear] h-3.5 w-3.5" />
							{t("goalMode.actions.clear")}
						</Button>
					</div>
				</PopoverContent>
			</Popover>
		</div>
	);
}
