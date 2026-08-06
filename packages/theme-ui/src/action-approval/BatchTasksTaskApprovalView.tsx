import type { ComponentType, JSX, ReactNode } from "react";
import { BatchTasksApprovalFrameView, type BatchTasksApprovalFrameViewProps } from "./BatchTasksApprovalFrameView";

export interface BatchTasksTaskApprovalViewProps {
	readonly frame: Omit<BatchTasksApprovalFrameViewProps, "children">;
	/** Host may inject themed frame via useThemeComponent("root.approval.batchTasksFrameView"). */
	readonly Frame?: ComponentType<BatchTasksApprovalFrameViewProps>;
	readonly hasInput: boolean;
	readonly taskName: string;
	readonly projectName: string;
	readonly statusLabel?: string;
	readonly sourceFolderLabel: string;
	readonly sourcePath: string;
	readonly taskIdLabel: string;
	readonly taskId: string;
	readonly relatedSessionLabel: string;
	readonly relatedSessionValue: string;
	readonly icon: string;
	readonly afterActionTitle: string;
	readonly description: string;
	readonly showResumeText: boolean;
	readonly resumeTextLabel: string;
	readonly approvalId: string;
	readonly resumeText: string;
	readonly onResumeTextChange: (value: string) => void;
	readonly lastError?: string | null;
	readonly lastErrorLabel: string;
	readonly warning?: string | null;
	readonly rawInput: unknown;
	/** Optional host override for resume field (defaults to native textarea). */
	readonly resumeField?: ReactNode;
}

export function BatchTasksTaskApprovalView({
	frame,
	Frame = BatchTasksApprovalFrameView,
	hasInput,
	taskName,
	projectName,
	statusLabel,
	sourceFolderLabel,
	sourcePath,
	taskIdLabel,
	taskId,
	relatedSessionLabel,
	relatedSessionValue,
	icon,
	afterActionTitle,
	description,
	showResumeText,
	resumeTextLabel,
	approvalId,
	resumeText,
	onResumeTextChange,
	lastError,
	lastErrorLabel,
	warning,
	rawInput,
	resumeField,
}: BatchTasksTaskApprovalViewProps): JSX.Element {
	return (
		<Frame {...frame}>
			{hasInput && (
				<>
					<div className="rounded-lg border border-border/50 bg-background/50 p-3">
						<div className="flex items-start gap-3">
							<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
								<span className="icon-[mdi--folder-outline] h-4 w-4 text-muted-foreground" />
							</div>
							<div className="min-w-0 flex-1">
								<div className="truncate text-[12px] font-semibold text-foreground">{taskName}</div>
								<div className="mt-0.5 truncate text-[10px] text-muted-foreground">{projectName}</div>
							</div>
							{statusLabel && (
								<span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">
									{statusLabel}
								</span>
							)}
						</div>
						<div className="mt-3 space-y-2 border-t border-border/40 pt-3 text-[11px]">
							<div className="flex items-start justify-between gap-4">
								<span className="shrink-0 text-muted-foreground">{sourceFolderLabel}</span>
								<span className="min-w-0 break-all text-right text-foreground">{sourcePath}</span>
							</div>
							<div className="flex items-start justify-between gap-4">
								<span className="shrink-0 text-muted-foreground">{taskIdLabel}</span>
								<span className="min-w-0 break-all text-right font-mono text-[10px] text-foreground">
									{taskId}
								</span>
							</div>
							<div className="flex items-center justify-between gap-4">
								<span className="text-muted-foreground">{relatedSessionLabel}</span>
								<span className="text-foreground">{relatedSessionValue}</span>
							</div>
						</div>
					</div>

					<div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
						<div className="flex gap-2">
							<span className={`${icon} mt-0.5 h-4 w-4 shrink-0 text-primary`} />
							<div>
								<div className="text-[11px] font-semibold text-foreground">{afterActionTitle}</div>
								<p className="mt-1 text-[11px] leading-5 text-muted-foreground">{description}</p>
							</div>
						</div>
					</div>

					{showResumeText &&
						(resumeField ?? (
							<div className="rounded-lg border border-border/50 bg-background/50 p-3">
								<label
									className="mb-1.5 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
									htmlFor="batch-task-resume-text"
								>
									{resumeTextLabel}
								</label>
								<textarea
									key={approvalId}
									id="batch-task-resume-text"
									value={resumeText}
									onChange={(event) => onResumeTextChange(event.target.value)}
									className="flex field-sizing-content min-h-16 w-full min-h-28 resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring md:text-sm dark:bg-input/30"
								/>
							</div>
						))}

					{lastError && (
						<div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
							<div className="mb-1 text-[10px] font-medium text-destructive">{lastErrorLabel}</div>
							<p className="max-h-24 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-muted-foreground">
								{lastError}
							</p>
						</div>
					)}

					{warning && (
						<div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-destructive">
							<span className="icon-[mdi--alert-outline] mt-0.5 h-4 w-4 shrink-0" />
							<p className="text-[11px] leading-5">{warning}</p>
						</div>
					)}
				</>
			)}

			{!hasInput && (
				<pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/50 bg-background/50 p-3 font-mono text-[10px] leading-4 text-foreground">
					{JSON.stringify(rawInput, null, 2)}
				</pre>
			)}
		</Frame>
	);
}
