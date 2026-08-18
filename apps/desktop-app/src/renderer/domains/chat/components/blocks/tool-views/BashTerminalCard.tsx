import {
	BashBackgroundTaskTailView,
	BashTerminalCard as ThemeBashTerminalCard,
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
				<span className="icon-[mdi--loading] h-3 w-3 animate-spin" />
				<span className="tool-call-shimmer-text">后台任务 {task.id} 运行中···</span>
			</>
		) : (
			<>
				<span
					className={
						task.status === "completed"
							? "icon-[mdi--check-circle-outline] h-3 w-3 text-emerald-600"
							: task.status === "killed"
								? "icon-[mdi--stop-circle-outline] h-3 w-3"
								: "icon-[mdi--close-circle-outline] h-3 w-3 text-destructive"
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
		<BashBackgroundTaskTailView taskId={task.id} status={task.status} tail={task.tail} statusLine={statusLine} />
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
	return (
		<ThemeBashTerminalCard
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
				copyCommand: t("bashTerminalCard.copyCommand"),
				metaDescription: t("bashTerminalCard.metaDescription"),
				executing: "正在执行···",
				meta: "meta",
			}}
			backgroundTaskTail={backgroundTask ? <BackgroundTaskTail task={backgroundTask} /> : undefined}
			copyButton={<CopyIconButton getText={() => command} label={t("bashTerminalCard.copyCommand")} />}
		/>
	);
}
