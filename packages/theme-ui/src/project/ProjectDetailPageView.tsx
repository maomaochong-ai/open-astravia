import { Button, cn } from "@vetta-org/ui";
import { AnimatePresence, motion } from "motion/react";
import type { JSX, ReactNode, RefObject } from "react";

const easeOut = [0.22, 1, 0.36, 1] as const;

export type ProjectDetailSaveStatus = "idle" | "saving" | "saved" | "error";

export interface ProjectDetailPageViewLabels {
	showInFolderTitle: string;
	showInFolder: string;
	exportTitle: string;
	export: string;
	newSession: string;
	closeActivityPanel: string;
	openActivityPanel: string;
	persona: string;
	unsavedChanges: string;
	saved: string;
	saveFailed: string;
	save: string;
	editorPlaceholder: string;
	agentsMdHint: string;
	quickSave: string;
	saveShortcut: string;
}

export interface ProjectDetailPageViewProps {
	activityOpen: boolean;
	/** Host ActivityPanel. */
	activityPanel: ReactNode;
	/** Host BatchQueueStatus section body (already wrapped or raw). */
	batchSection: ReactNode | null;
	content: string;
	createdAtLabel: string | null;
	cwd: string;
	displayName: string;
	editorFocused: boolean;
	exportable: boolean;
	isDirty: boolean;
	labels: ProjectDetailPageViewLabels;
	loading: boolean;
	onContentChange: (value: string) => void;
	onEditorBlur: () => void;
	onEditorFocus: () => void;
	onExport: () => void;
	onNewSession: () => void;
	onSave: () => void;
	onShowInFolder: () => void;
	onToggleActivity: () => void;
	projectTypeLabel: string | null;
	saveStatus: ProjectDetailSaveStatus;
	sessionCountLabel: string;
	taskCountLabel: string | null;
	textareaRef: RefObject<HTMLTextAreaElement | null>;
}

export function ProjectDetailPageView({
	activityOpen,
	activityPanel,
	batchSection,
	content,
	createdAtLabel,
	cwd,
	displayName,
	editorFocused,
	exportable,
	isDirty,
	labels,
	loading,
	onContentChange,
	onEditorBlur,
	onEditorFocus,
	onExport,
	onNewSession,
	onSave,
	onShowInFolder,
	onToggleActivity,
	projectTypeLabel,
	saveStatus,
	sessionCountLabel,
	taskCountLabel,
	textareaRef,
}: ProjectDetailPageViewProps): JSX.Element {
	const metrics = [
		{ icon: "icon-[mdi--chat-outline]", value: sessionCountLabel },
		createdAtLabel ? { icon: "icon-[mdi--calendar-outline]", value: createdAtLabel } : null,
		taskCountLabel ? { icon: "icon-[mdi--layers-outline]", value: taskCountLabel } : null,
	].filter((item): item is { icon: string; value: string } => item != null);

	return (
		<div className="flex h-full w-full flex-col overflow-hidden">
			<div className="flex min-h-0 flex-1">
				{/* @container：按主栏宽度（非视口）响应，Activity 挤窄时也能正确折叠 */}
				<div className="@container flex min-w-0 flex-1 flex-col">
					{/* ── Identity header ─────────────────────────────────── */}
					<motion.header
						className="shrink-0 px-4 pb-4 pt-1 @md:px-8 @md:pb-5"
						initial={{ opacity: 0, y: -10 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ duration: 0.45, ease: easeOut }}
					>
						<div className="flex min-w-0 flex-col gap-3">
							{/* 标题行：窄宽时允许操作条整行换行，避免挤爆标题 */}
							<div className="flex min-w-0 flex-wrap items-start justify-between gap-x-2 gap-y-2">
								<div className="min-w-0 flex-1 basis-[8rem]">
									<div className="mb-1 flex min-w-0 items-center gap-2">
										<h1
											className="min-w-0 truncate text-[20px] font-bold leading-tight tracking-tight text-foreground @md:text-[26px]"
											title={displayName}
										>
											{displayName}
										</h1>
										<AnimatePresence mode="popLayout">
											{projectTypeLabel && (
												<motion.span
													key={projectTypeLabel}
													initial={{ opacity: 0, scale: 0.9 }}
													animate={{ opacity: 1, scale: 1 }}
													exit={{ opacity: 0, scale: 0.9 }}
													transition={{ type: "spring", stiffness: 400, damping: 28 }}
													className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary"
												>
													<span className="h-1 w-1 rounded-full bg-primary" />
													{projectTypeLabel}
												</motion.span>
											)}
										</AnimatePresence>
									</div>

									<button
										type="button"
										onClick={onShowInFolder}
										title={labels.showInFolderTitle}
										className="group inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md px-0.5 py-0.5 font-mono text-[11px] text-muted-foreground/55 transition-colors hover:bg-accent/60 hover:text-foreground"
									>
										<span className="icon-[solar--folder-open-linear] h-3 w-3 shrink-0 opacity-70 group-hover:opacity-100" />
										<span className="min-w-0 truncate">{cwd}</span>
									</button>
								</div>

								<div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										onClick={onShowInFolder}
										title={labels.showInFolderTitle}
										aria-label={labels.showInFolder}
									>
										<span className="icon-[solar--folder-open-linear] h-3.5 w-3.5" />
									</Button>
									{exportable && (
										<Button
											type="button"
											variant="outline"
											size="icon-sm"
											onClick={onExport}
											title={labels.exportTitle}
											aria-label={labels.export}
										>
											<span className="icon-[solar--export-linear] h-3.5 w-3.5" />
										</Button>
									)}
									<Button
										type="button"
										variant="primary"
										size="sm"
										onClick={onNewSession}
										title={labels.newSession}
										aria-label={labels.newSession}
									>
										<span className="icon-[solar--add-circle-linear] h-4 w-4" />
										<span className="hidden text-[12px] font-medium @min-[22rem]:inline">
											{labels.newSession}
										</span>
									</Button>
									<Button
										type="button"
										variant={activityOpen ? "secondary" : "ghost"}
										size="icon-sm"
										title={activityOpen ? labels.closeActivityPanel : labels.openActivityPanel}
										onClick={onToggleActivity}
										aria-pressed={activityOpen}
									>
										<span className="icon-[solar--sidebar-minimalistic-linear] -scale-x-100 text-[14px]" />
									</Button>
								</div>
							</div>

							{metrics.length > 0 && (
								<div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
									{metrics.map((item, index) => (
										<span
											key={item.value}
											className="inline-flex max-w-full items-center gap-1.5 text-[11.5px] text-muted-foreground/70"
										>
											{index > 0 && (
												<span className="mr-0.5 h-3 w-px shrink-0 bg-border/50" aria-hidden />
											)}
											<span className={cn(item.icon, "h-3.5 w-3.5 shrink-0 opacity-60")} />
											<span className="min-w-0 truncate whitespace-nowrap tabular-nums">
												{item.value}
											</span>
										</span>
									))}
								</div>
							)}
						</div>
					</motion.header>

					{/* ── Body ────────────────────────────────────────────── */}
					<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
						{batchSection}

						<motion.section
							className="flex min-h-[280px] flex-1 flex-col px-4 pb-5 @md:min-h-[360px] @md:px-8 @md:pb-6"
							initial={{ opacity: 0, y: 14 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.5, delay: 0.08, ease: easeOut }}
						>
							{/* Document shell */}
							<div
								className={cn(
									"flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-card/50 shadow-[0_1px_2px_rgba(15,23,42,0.04)] backdrop-blur-sm transition-[border-color,box-shadow] duration-300",
									editorFocused
										? "border-primary/40 shadow-[0_0_0_1px_color-mix(in_oklab,var(--primary)_18%,transparent),0_8px_24px_-12px_color-mix(in_oklab,var(--primary)_25%,transparent)]"
										: "border-border/50",
								)}
							>
								{/* Editor chrome */}
								<div className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-2 border-b border-border/40 px-3 py-2 @md:px-4 @md:py-2.5">
									<div className="flex min-w-0 flex-1 items-center gap-2">
										<h2 className="min-w-0 truncate text-[13px] font-semibold tracking-tight text-foreground">
											{labels.persona}
										</h2>
										<span className="hidden shrink-0 rounded-md border border-border/40 bg-background/60 px-1.5 py-px font-mono text-[10px] text-muted-foreground/55 @min-[22rem]:inline">
											AGENTS.md
										</span>
										<AnimatePresence>
											{isDirty && (
												<motion.span
													key="dirty"
													initial={{ opacity: 0, scale: 0.6 }}
													animate={{ opacity: 1, scale: 1 }}
													exit={{ opacity: 0, scale: 0.6 }}
													className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-500"
													title={labels.unsavedChanges}
												>
													<span className="relative flex h-1.5 w-1.5">
														<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-60" />
														<span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
													</span>
													<span className="hidden @min-[28rem]:inline">{labels.unsavedChanges}</span>
												</motion.span>
											)}
										</AnimatePresence>
									</div>

									<div className="flex shrink-0 items-center gap-1.5">
										<AnimatePresence mode="popLayout">
											{saveStatus === "saved" && (
												<motion.span
													key="saved"
													initial={{ opacity: 0, x: 6 }}
													animate={{ opacity: 1, x: 0 }}
													exit={{ opacity: 0, x: 6 }}
													className="hidden items-center gap-1 text-[11px] font-medium text-emerald-500 @min-[22rem]:flex"
												>
													<span className="icon-[mdi--check-circle] h-3.5 w-3.5" />
													{labels.saved}
												</motion.span>
											)}
											{saveStatus === "error" && (
												<motion.span
													key="error"
													initial={{ opacity: 0, x: 6 }}
													animate={{ opacity: 1, x: 0 }}
													exit={{ opacity: 0, x: 6 }}
													className="flex items-center gap-1 text-[11px] font-medium text-destructive"
													title={labels.saveFailed}
												>
													<span className="icon-[mdi--alert-circle-outline] h-3.5 w-3.5" />
													<span className="hidden @min-[22rem]:inline">{labels.saveFailed}</span>
												</motion.span>
											)}
										</AnimatePresence>
										<Button
											type="button"
											variant={isDirty ? "primary" : "outline"}
											size="sm"
											onClick={onSave}
											disabled={!isDirty || saveStatus === "saving"}
											title={labels.save}
											aria-label={labels.save}
										>
											{saveStatus === "saving" ? (
												<span className="icon-[mdi--loading] h-3.5 w-3.5 animate-spin" />
											) : (
												<span className="icon-[mdi--content-save-outline] h-3.5 w-3.5" />
											)}
											<span className="hidden @min-[18rem]:inline">{labels.save}</span>
										</Button>
									</div>
								</div>

								{/* Editor body */}
								{loading ? (
									<div className="flex flex-1 items-center justify-center py-16">
										<span className="icon-[mdi--loading] h-5 w-5 animate-spin text-primary/50" />
									</div>
								) : (
									<div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
										<div
											aria-hidden
											className={cn(
												"pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent transition-opacity duration-300",
												editorFocused ? "opacity-100" : "opacity-0",
											)}
										/>
										<textarea
											ref={textareaRef}
											value={content}
											onChange={(e) => onContentChange(e.target.value)}
											onFocus={onEditorFocus}
											onBlur={onEditorBlur}
											placeholder={labels.editorPlaceholder}
											spellCheck={false}
											className="min-h-0 min-w-0 flex-1 resize-none bg-transparent px-3 py-3 font-mono text-[13px] leading-[1.7] text-foreground placeholder:text-muted-foreground/30 focus:outline-none @md:px-5 @md:py-4"
										/>
									</div>
								)}

								{/* Footer hint */}
								<div className="flex shrink-0 items-center gap-1.5 overflow-hidden border-t border-border/30 bg-accent/10 px-3 py-2 text-[11px] text-muted-foreground/50 @md:px-4">
									<span className="icon-[mdi--information-outline] h-3 w-3 shrink-0 opacity-60" />
									<span className="min-w-0 flex-1 truncate">{labels.agentsMdHint}</span>
									<kbd className="shrink-0 rounded-md border border-border/40 bg-background/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/70">
										{labels.saveShortcut}
									</kbd>
									<span className="hidden shrink-0 @min-[22rem]:inline">{labels.quickSave}</span>
								</div>
							</div>
						</motion.section>
					</div>
				</div>
				{activityPanel}
			</div>
		</div>
	);
}
