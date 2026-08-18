import { useTranslation } from "react-i18next";
import type { AchievementUsageStats } from "@preload/api";
import { CornerImageFrame } from "@vetta/theme-ui/appearance";
import type { Achievement } from "../achievements";

const FRAME_ACCENT_COLOR = "#e0b278";
const FRAME_FOREGROUND_COLOR = "#f4e7d6";
const FRAME_MUTED_COLOR = "#cdb79e";
const FRAME_CURRENT_BACKGROUND = "rgba(224, 178, 120, 0.16)";

interface AchievementDescriptionCardProps {
	achievement: Achievement;
	current: boolean;
	index: number;
	total: number;
	usageStats: AchievementUsageStats;
}

export function AchievementDescriptionCard({
	achievement,
	current,
	index,
	total,
	usageStats,
}: AchievementDescriptionCardProps): JSX.Element {
	const { t } = useTranslation("settings");
	const targetActiveMs = achievement.targetActiveMs;
	const progress = targetActiveMs === 0
		? 1
		: Math.min(1, usageStats.foregroundActiveMs / targetActiveMs);
	const completed = progress >= 1;
	const percentage = Math.round(progress * 100);
	const formatDuration = (durationMs: number): string => {
		const totalMinutes = Math.floor(durationMs / 60_000);
		if (totalMinutes < 60) {
			return t("achievement.durationMinutes", { count: totalMinutes });
		}
		const hours = Math.floor(totalMinutes / 60);
		const minutes = totalMinutes % 60;
		return minutes === 0
			? t("achievement.durationHours", { count: hours })
			: t("achievement.durationHoursMinutes", { hours, minutes });
	};

	return (
		<CornerImageFrame
			imageUrl={achievement.frameUrl}
			decoration={achievement.frameDecoration}
			className="rounded-xl border transition-colors duration-200"
			contentClassName="px-10 py-4"
			style={achievement.surfaceColors}
		>
			<div className="flex items-center gap-2">
				<span
					className="text-[11px] font-medium"
					style={{ color: FRAME_ACCENT_COLOR }}
				>
					{t("achievement.stage", { current: index + 1, total })}
				</span>
				{current && (
					<span
						className="rounded-full px-2 py-0.5 text-[10px] font-medium"
						style={{
							backgroundColor: FRAME_CURRENT_BACKGROUND,
							color: FRAME_ACCENT_COLOR,
						}}
					>
						{t("achievement.current")}
					</span>
				)}
			</div>
			<h2
				className="mt-2 text-[15px] font-semibold"
				style={{ color: FRAME_FOREGROUND_COLOR }}
			>
				{t(`achievement.stages.${achievement.id}.name`, {
					defaultValue: achievement.id,
				})}
			</h2>
			<p
				className="mt-1 text-[12px] leading-5"
				style={{ color: FRAME_MUTED_COLOR }}
			>
				{t(`achievement.stages.${achievement.id}.meaning`, {
					defaultValue: "",
				})}
			</p>
			<div className="mt-4">
				<div
					className="flex items-center justify-between gap-4"
				>
					<span
						className="flex items-center gap-1.5 text-[11px] font-medium"
						style={{ color: FRAME_MUTED_COLOR }}
					>
						<span className="icon-[solar--chart-2-linear] h-3.5 w-3.5" />
						{t("achievement.stageProgress")}
					</span>
					<span
						className="text-[15px] font-semibold tabular-nums"
						style={{ color: FRAME_ACCENT_COLOR }}
					>
						{percentage}%
					</span>
				</div>
				<div
					className="mt-2 h-1.5 overflow-hidden rounded-full"
					style={{ backgroundColor: FRAME_CURRENT_BACKGROUND }}
				>
					<div
						className="h-full rounded-full transition-[width] duration-300"
						style={{
							backgroundColor: FRAME_ACCENT_COLOR,
							width: `${progress * 100}%`,
						}}
					/>
				</div>
				<div
					className="mt-2 flex items-center justify-between gap-4 text-[11px]"
					style={{ color: FRAME_MUTED_COLOR }}
				>
					<span>
						{t("achievement.targetValue", {
							target: targetActiveMs === 0
								? t("achievement.startingPoint")
								: formatDuration(targetActiveMs),
						})}
					</span>
					<span
						className="flex items-center gap-1 font-medium"
						style={{ color: completed ? FRAME_ACCENT_COLOR : FRAME_FOREGROUND_COLOR }}
					>
						<span
							className={
								completed
									? "icon-[solar--check-circle-linear] h-3.5 w-3.5"
									: "icon-[solar--hourglass-line-linear] h-3.5 w-3.5"
							}
						/>
						{completed ? t("achievement.completed") : t("achievement.inProgress")}
					</span>
				</div>
				<div className="mt-3 flex flex-wrap gap-2">
					{[
						{
							icon: "icon-[solar--clock-circle-linear]",
							label: t("achievement.metrics.activeTime"),
							value: formatDuration(usageStats.foregroundActiveMs),
						},
						{
							icon: "icon-[solar--calendar-mark-linear]",
							label: t("achievement.metrics.activeStreak"),
							value: t("achievement.days", { count: usageStats.activeDayStreak }),
						},
						{
							icon: "icon-[solar--sun-2-linear]",
							label: t("achievement.metrics.todayActiveTime"),
							value: formatDuration(usageStats.todayActiveMs),
						},
						{
							icon: "icon-[solar--letter-unread-linear]",
							label: t("achievement.metrics.todayMessages"),
							value: usageStats.todayMessages.toLocaleString(),
						},
						{
							icon: "icon-[solar--chat-round-line-linear]",
							label: t("achievement.metrics.sessions"),
							value: usageStats.interactiveSessions.toLocaleString(),
						},
						{
							icon: "icon-[solar--dialog-2-linear]",
							label: t("achievement.metrics.turns"),
							value: usageStats.turns.toLocaleString(),
						},
						{
							icon: "icon-[solar--letter-linear]",
							label: t("achievement.metrics.messages"),
							value: usageStats.messages.toLocaleString(),
						},
						{
							icon: "icon-[solar--cup-star-linear]",
							label: t("achievement.metrics.longestConversation"),
							value: t("achievement.longestConversationValue", {
								messages: usageStats.longestConversationMessages,
								turns: usageStats.longestConversationTurns,
							}),
						},
						{
							icon: "icon-[solar--programming-linear]",
							label: t("achievement.metrics.tools"),
							value: usageStats.toolsCompleted.toLocaleString(),
						},
						{
							icon: "icon-[solar--bolt-linear]",
							label: t("achievement.metrics.tokens"),
							value: usageStats.totalTokens.toLocaleString(),
						},
						{
							icon: "icon-[solar--folder-with-files-linear]",
							label: t("achievement.metrics.projects"),
							value: t("achievement.projectsValue", {
								kb: usageStats.knowledgeBaseCount,
								projects: usageStats.projectsCreated,
							}),
						},
						{
							icon: "icon-[solar--file-send-linear]",
							label: t("achievement.metrics.fileOperations"),
							value: usageStats.knowledgeBaseFileOperations.toLocaleString(),
						},
						{
							icon: "icon-[solar--layers-linear]",
							label: t("achievement.metrics.batchRuns"),
							value: usageStats.batchRuns.toLocaleString(),
						},
						{
							icon: "icon-[solar--calendar-linear]",
							label: t("achievement.metrics.automationRuns"),
							value: usageStats.automationRuns.toLocaleString(),
						},
					].map((metric) => (
						<div
							key={metric.label}
							className="min-w-36 flex-1 rounded-lg px-3 py-2"
							style={{ backgroundColor: FRAME_CURRENT_BACKGROUND }}
						>
							<div
								className="flex items-center gap-1.5 text-[10px]"
								style={{ color: FRAME_MUTED_COLOR }}
							>
								<span className={`${metric.icon} h-3 w-3`} />
								{metric.label}
							</div>
							<div
								className="mt-1 text-[12px] font-medium tabular-nums"
								style={{ color: FRAME_FOREGROUND_COLOR }}
							>
								{metric.value}
							</div>
						</div>
					))}
				</div>
			</div>
		</CornerImageFrame>
	);
}
