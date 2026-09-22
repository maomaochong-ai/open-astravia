import type { JSX, MouseEvent } from "react";
import { motion } from "motion/react";

export interface TaskListItemView {
	readonly enabled: boolean;
	readonly id: string;
	readonly isRunning: boolean;
	readonly isSelected: boolean;
	readonly lastRunLabel: string;
	readonly lastRunStatus: "success" | "failed" | null;
	readonly name: string;
	readonly prompt: string;
	readonly scheduleLabel: string;
	/** 自定义计划下展示原始 cron，其余为 null。 */
	readonly scheduleDetail: string | null;
	readonly statusLabel: string;
	/** 运行会话策略与所属项目，如「每次新建会话 · 对话」。 */
	readonly targetLabel: string;
	/** 目标失效导致暂停时的提示；正常为 null。 */
	readonly suspendedLabel: string | null;
}

export interface TaskListViewLabels {
	readonly delete: string;
	readonly edit: string;
	readonly enable: string;
	readonly failed: string;
	readonly pause: string;
	readonly runNow: string;
	readonly success: string;
}

export interface TaskListViewProps {
	readonly items: readonly TaskListItemView[];
	readonly labels: TaskListViewLabels;
	readonly onDeleteTask: (taskId: string) => void;
	readonly onEditTask: (taskId: string) => void;
	readonly onRunTask: (taskId: string) => void;
	readonly onSelectTask: (id: string) => void;
	readonly onToggleTask: (taskId: string) => void;
}

export function TaskListView({
	items,
	labels,
	onDeleteTask,
	onEditTask,
	onRunTask,
	onSelectTask,
	onToggleTask,
}: TaskListViewProps): JSX.Element {
	return (
		<motion.div
			className="grid grid-cols-3 gap-4"
			initial="hidden"
			animate="show"
			variants={{
				hidden: {},
				show: { transition: { staggerChildren: 0.05 } },
			}}
		>
			{items.map((item) => (
				<motion.div
					key={item.id}
					layout
					variants={{
						hidden: { opacity: 0, y: 14, scale: 0.96 },
						show: { opacity: 1, y: 0, scale: 1 },
					}}
					transition={{ type: "spring", stiffness: 320, damping: 26 }}
					whileHover={{ y: -2 }}
					onClick={() => onSelectTask(item.id)}
					className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl p-5 transition-colors duration-300 ${
						item.isSelected ? "bg-primary/10 ring-1 ring-inset ring-primary/30" : "bg-card hover:bg-accent"
					}`}
				>
					<div className="relative flex items-start gap-2.5">
						<div className="mt-1 flex h-2 w-2 shrink-0">
							<span className="relative inline-flex h-2 w-2">
								{item.isRunning && (
									<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
								)}
								<span
									className={`relative inline-flex h-2 w-2 rounded-full ${
										item.isRunning ? "bg-emerald-500" : item.enabled ? "bg-primary" : "bg-muted-foreground/40"
									}`}
								/>
							</span>
						</div>
						<div className="min-w-0 flex-1">
							<h3 className="truncate text-[14px] font-semibold tracking-tight text-foreground">{item.name}</h3>
							<p className="mt-0.5 truncate text-[11px] text-muted-foreground/50">
								{item.statusLabel}
							</p>
						</div>

						<div
							className={`flex items-center gap-0.5 transition-opacity duration-200 ${
								item.isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
							}`}
						>
							<ActionButton
								icon="icon-[mdi--play]"
								title={labels.runNow}
								onClick={(event) => {
									event.stopPropagation();
									onRunTask(item.id);
								}}
							/>
							<ActionButton
								icon={item.enabled ? "icon-[mdi--pause]" : "icon-[mdi--play-outline]"}
								title={item.enabled ? labels.pause : labels.enable}
								onClick={(event) => {
									event.stopPropagation();
									onToggleTask(item.id);
								}}
							/>
							<ActionButton
								icon="icon-[mdi--pencil-outline]"
								title={labels.edit}
								onClick={(event) => {
									event.stopPropagation();
									onEditTask(item.id);
								}}
							/>
							<ActionButton
								icon="icon-[mdi--delete-outline]"
								title={labels.delete}
								variant="danger"
								onClick={(event) => {
									event.stopPropagation();
									onDeleteTask(item.id);
								}}
							/>
						</div>
					</div>

					<div className="relative mt-4 flex items-center gap-2 rounded-xl border border-border/30 bg-background/40 px-3 py-2.5">
						<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-inset ring-primary/15">
							<span className="icon-[mdi--clock-time-eight-outline] h-3.5 w-3.5 text-primary" />
						</div>
						<div className="min-w-0 flex-1">
							<p className="truncate text-[12px] font-medium text-foreground">{item.scheduleLabel}</p>
							{item.scheduleDetail && (
								<p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/50">
									{item.scheduleDetail}
								</p>
							)}
						</div>
					</div>

					{item.suspendedLabel && (
						<p className="relative mt-3 flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-500">
							<span className="icon-[mdi--alert-outline] h-3.5 w-3.5 shrink-0" />
							<span className="truncate">{item.suspendedLabel}</span>
						</p>
					)}

					<div className="relative mt-3 flex-1">
						<p className="line-clamp-2 text-[12px] leading-relaxed text-muted-foreground/70">{item.prompt}</p>
					</div>

					<div className="relative mt-4 flex flex-wrap items-center gap-1.5 border-t border-border/30 pt-3 text-[11px]">
						<MetaPill icon="icon-[mdi--message-text-clock-outline]" text={item.targetLabel} />
						<div className="ml-auto flex items-center gap-1.5">
							{item.lastRunStatus && (
								<span
									className={`flex h-5 items-center gap-1 rounded-full px-2 text-[10px] font-medium ${
										item.lastRunStatus === "success"
											? "bg-emerald-500/10 text-emerald-400"
											: "bg-destructive/10 text-destructive"
									}`}
								>
									<span
										className={`h-3 w-3 ${
											item.lastRunStatus === "success" ? "icon-[mdi--check-circle]" : "icon-[mdi--alert-circle]"
										}`}
									/>
									{item.lastRunStatus === "success" ? labels.success : labels.failed}
								</span>
							)}
							<span className="flex items-center gap-1 text-muted-foreground/50">
								<span className="icon-[mdi--history] h-3 w-3" />
								{item.lastRunLabel}
							</span>
						</div>
					</div>
				</motion.div>
			))}
		</motion.div>
	);
}

function MetaPill({ icon, text }: { readonly icon: string; readonly text: string }): JSX.Element {
	return (
		<span className="flex h-5 items-center gap-1 rounded-full bg-accent/40 px-2 text-[10px] text-muted-foreground/70">
			<span className={`${icon} h-3 w-3 opacity-70`} />
			<span className="max-w-[180px] truncate">{text}</span>
		</span>
	);
}

function ActionButton({
	icon,
	title,
	variant,
	onClick,
}: {
	readonly icon: string;
	readonly title: string;
	readonly variant?: "danger";
	readonly onClick: (event: MouseEvent) => void;
}): JSX.Element {
	return (
		<motion.button
			type="button"
			title={title}
			onClick={onClick}
			whileHover={{ scale: 1.04 }}
			whileTap={{ scale: 0.94 }}
			transition={{ type: "spring", stiffness: 400, damping: 22 }}
			className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors duration-150 ${
				variant === "danger"
					? "text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
					: "text-muted-foreground/60 hover:bg-primary/10 hover:text-primary"
			}`}
		>
			<span className={`${icon} text-[14px]`} />
		</motion.button>
	);
}
