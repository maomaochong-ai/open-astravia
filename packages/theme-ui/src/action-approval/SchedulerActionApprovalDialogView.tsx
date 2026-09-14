import type { JSX } from "react";
import { Button, Dialog, DialogContent, cn } from "@vetta-org/ui";
import { ThemeSurface } from "../appearance/ThemeSurface";

export interface SchedulerActionApprovalDialogViewLabels {
	readonly reject: string;
	readonly confirm: string;
	readonly responding: string;
	readonly permission: string;
	readonly fallbackAction: string;
	readonly targetTask: string;
	readonly rawInput: string;
}

export interface SchedulerActionApprovalDialogViewDetail {
	readonly label: string;
	readonly icon: string;
	readonly description: string;
	readonly descriptionTitle: string;
	readonly warning?: string;
	readonly destructive?: boolean;
}

export interface SchedulerActionApprovalDialogViewProps {
	readonly title: string;
	readonly summary: string;
	readonly taskId?: string;
	readonly rawInput?: unknown;
	readonly detail?: SchedulerActionApprovalDialogViewDetail;
	readonly error?: string | null;
	readonly responding: boolean;
	readonly countdown: string;
	readonly labels: SchedulerActionApprovalDialogViewLabels;
	readonly onReject: () => void;
	readonly onApprove: () => void;
	readonly className?: string;
	readonly classNames?: {
		readonly content?: string;
		readonly header?: string;
		readonly body?: string;
		readonly footer?: string;
	};
}

export function SchedulerActionApprovalDialogView({
	title,
	summary,
	taskId,
	rawInput,
	detail,
	error,
	responding,
	countdown,
	labels,
	onReject,
	onApprove,
	className,
	classNames,
}: SchedulerActionApprovalDialogViewProps): JSX.Element {
	const isDestructive = Boolean(detail?.destructive);
	const iconClassName = detail?.icon ?? "icon-[mdi--cog-play-outline]";

	return (
		<Dialog open>
			<DialogContent
				className={cn("overflow-visible p-0 sm:max-w-[480px]", className, classNames?.content)}
				showCloseButton={false}
				onInteractOutside={(event) => event.preventDefault()}
			>
				<ThemeSurface slot="root.approval.schedulerAction.panel" />
				<div className="relative z-10 max-h-[90vh] overflow-y-auto rounded-[inherit]">
					<div className={cn("border-b border-border/60 p-5", classNames?.header)}>
						<div className="flex items-start gap-3">
							<div
								className={cn(
									"flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
									isDestructive ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
								)}
							>
								<span className={`${iconClassName} h-5 w-5`} />
							</div>
							<div className="min-w-0 flex-1">
								<div className="flex flex-wrap items-center gap-2">
									<h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
									{detail && (
										<span
											className={cn(
												"rounded-full px-2 py-0.5 text-[10px] font-semibold",
												isDestructive
													? "bg-destructive/10 text-destructive"
													: "bg-primary/10 text-primary",
											)}
										>
											{detail.label}
										</span>
									)}
								</div>
								<p className="mt-1 text-[12px] leading-5 text-muted-foreground">{summary}</p>
							</div>
						</div>
					</div>

					<div className={cn("space-y-3 p-5", classNames?.body)}>
						{taskId && detail && (
							<>
								<div className="rounded-lg border border-border/50 bg-background/50 p-3">
									<div className="flex items-start gap-3">
										<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
											<span className="icon-[mdi--clipboard-text-clock-outline] h-4 w-4 text-muted-foreground" />
										</div>
										<div className="min-w-0 flex-1">
											<div className="truncate text-[12px] font-semibold text-foreground">
												{labels.targetTask}
											</div>
											<div className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground">
												{taskId}
											</div>
										</div>
									</div>
								</div>

								<div
									className={cn(
										"rounded-lg border p-3",
										isDestructive
											? "border-destructive/30 bg-destructive/10"
											: "border-primary/20 bg-primary/5",
									)}
								>
									<div className="flex gap-2">
										<span
											className={`${detail.icon} mt-0.5 h-4 w-4 shrink-0 ${
												isDestructive ? "text-destructive" : "text-primary"
											}`}
										/>
										<div>
											<div className="text-[11px] font-semibold text-foreground">
												{detail.descriptionTitle}
											</div>
											<p className="mt-1 text-[11px] leading-5 text-muted-foreground">
												{detail.description}
											</p>
										</div>
									</div>
								</div>

								{detail.warning && (
									<div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-destructive">
										<span className="icon-[mdi--alert-outline] mt-0.5 h-4 w-4 shrink-0" />
										<p className="text-[11px] leading-5">{detail.warning}</p>
									</div>
								)}
							</>
						)}

						{(!taskId || !detail) && (
							<div>
								<div className="mb-2 text-[11px] font-semibold text-muted-foreground">
									{labels.rawInput}
								</div>
								<pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/50 bg-background/50 p-3 font-mono text-[10px] leading-4 text-foreground">
									{JSON.stringify(rawInput, null, 2)}
								</pre>
							</div>
						)}
					</div>

					<div className={cn("border-t border-border/60 px-5 py-4", classNames?.footer)}>
						<div className="mb-3 flex items-center justify-between text-[10px] text-muted-foreground">
							<span>{labels.permission}</span>
						</div>
						{error && <div className="mb-3 text-[11px] text-destructive">{error}</div>}
						<div className="flex justify-end gap-2">
							<Button variant="outline" size="sm" disabled={responding} onClick={onReject}>
								{labels.reject} ({countdown})
							</Button>
							<Button
								size="sm"
								variant={isDestructive ? "destructive" : "default"}
								disabled={responding}
								onClick={onApprove}
							>
								{responding ? labels.responding : labels.confirm}
							</Button>
						</div>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
