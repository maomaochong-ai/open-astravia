import {
	BashTerminal,
} from "@vetta/theme-ui/chat";
import { useTranslation } from "react-i18next";
import { formatPhases, formatStartedAt, formatDurationPrecise } from "./shared/format";
import { bashHeaderLabel } from "./shared/parse-tool";
import { CopyIconButton } from "./shared/CopyIconButton";

/** Local shapes — avoid @shared/store so inventory is not dataHeavy. */
type ToolStatus = "pending" | "success" | "error";
interface PhaseInfo {
	label: string;
	atMs: number;
}
interface BgTask {
	id: string;
	status: string;
	tail?: string;
	exitCode?: number;
}

function BackgroundTaskTail({ task }: { task: BgTask }): JSX.Element {
	const statusLine =
		task.status === "running" ? (
			<>
				<span className="icon-[solar--refresh-linear] h-3 w-3 animate-spin" />
				<span className="tool-call-shimmer-text">后台任务 {task.id} 运行中···</span>
			</>
		) : (
			<>
				<span
					className={
						task.status === "completed"
							? "icon-[solar--check-circle-linear] h-3 w-3 text-muted-foreground/70"
							: task.status === "killed"
								? "icon-[solar--stop-circle-linear] h-3 w-3"
								: "icon-[solar--close-circle-linear] h-3 w-3 text-destructive"
					}
				/>
				<span>
					后台任务 {task.id}{" "}
					{task.status === "completed" ? "已完成" : task.status === "killed" ? "已终止" : "失败"}
					{task.exitCode !== undefined ? ` (exit ${task.exitCode})` : ""}
				</span>
			</>
		);
	return (
		<BashTerminal.BackgroundTaskTail taskId={task.id} status={task.status} tail={task.tail}>
			{statusLine}
		</BashTerminal.BackgroundTaskTail>
	);
}

export function BashTerminalCard({
	command,
	result,
	status,
	isError,
	startedAt,
	durationMs,
	phases,
	backgroundTask,
}: {
	command: string;
	result: string | undefined;
	status: ToolStatus;
	isError: boolean | undefined;
	startedAt: number | undefined;
	durationMs: number | undefined;
	phases: PhaseInfo[] | undefined;
	backgroundTask?: BgTask;
}): JSX.Element {
	const { t } = useTranslation("chat");
	const pending = status === "pending";
	return (
		<BashTerminal.Root
			command={command}
			result={result}
			status={status}
			isError={isError}
			startedAt={startedAt}
			durationMs={durationMs}
			startedAtLabel={startedAt !== undefined ? formatStartedAt(startedAt) : undefined}
			durationLabel={durationMs !== undefined ? formatDurationPrecise(durationMs) : undefined}
			phasesLabel={
				phases && phases.length > 0 && durationMs !== undefined ? formatPhases(phases, durationMs) : undefined
			}
			headerLabel={bashHeaderLabel(status, command)}
			labels={{
				metaDescription: t("bashTerminalCard.metaDescription"),
				executing: "正在执行···",
				meta: "meta",
			}}
		>
			<BashTerminal.Card>
				<BashTerminal.Header>
					<BashTerminal.StatusDot />
					<BashTerminal.HeaderLabel />
					<BashTerminal.CopyAction>
						<CopyIconButton getText={() => command} label={t("bashTerminalCard.copyCommand")} />
					</BashTerminal.CopyAction>
				</BashTerminal.Header>
				<BashTerminal.Command />
				<BashTerminal.Result />
				{!pending && backgroundTask ? <BackgroundTaskTail task={backgroundTask} /> : null}
				<BashTerminal.PendingStatus />
				<BashTerminal.Meta />
			</BashTerminal.Card>
		</BashTerminal.Root>
	);
}
