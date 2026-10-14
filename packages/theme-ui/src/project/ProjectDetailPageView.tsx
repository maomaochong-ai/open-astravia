import { Button, cn } from "@vetta-org/ui";
import { AnimatePresence, motion } from "motion/react";
import { useState, type JSX, type ReactNode, type RefObject } from "react";
import { MarkdownPreviewView } from "../activity/MarkdownPreviewView";


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
	recentSessionsTitle: string;
	recentSessionsEmpty: string;
	startFirst: string;
	running: string;
	runningTasks: string;
	contextTitle: string;
	claudeHint: string;
	previewMode: string;
	editMode: string;
	emptyFileTitle: string;
	emptyFileHint: string;
	startEditing: string;
}

export interface ProjectDetailRecentSession {
	path: string;
	label: string;
	date: string;
	pinned?: boolean;
	running: boolean;
}
export interface ProjectDetailPageViewProps {
	activityOpen: boolean;
	/** Host ActivityPanel. */
	activityPanel: ReactNode;
	/** Host BatchQueueStatus section body (already wrapped or raw). */
	batchSection: ReactNode | null;
	content: string;
	activeDocument: "AGENTS.md" | "CLAUDE.md";
	mode?: "edit" | "preview";
	onModeChange?: (mode: "edit" | "preview") => void;
	theme?: "light" | "dark";
	recentSessions: readonly ProjectDetailRecentSession[];
	runningSessionCount: number;
	runningTaskCount: number;
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
	onDocumentChange: (file: "AGENTS.md" | "CLAUDE.md") => void;
	onOpenRecentSession: (path: string) => void;
	projectTypeLabel: string | null;
	saveStatus: ProjectDetailSaveStatus;
	sessionCountLabel: string;
	taskCountLabel: string | null;
	textareaRef: RefObject<HTMLTextAreaElement | null>;
}

export function ProjectDetailPageView({
	activityOpen,
	mode: controlledMode,
	onModeChange: controlledOnModeChange,
	theme = "dark",
	activityPanel,
	batchSection,
	activeDocument,
	recentSessions,
	runningSessionCount,
	runningTaskCount,
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
	onDocumentChange,
	onOpenRecentSession,
	onToggleActivity,
	projectTypeLabel,
	saveStatus,
	sessionCountLabel,
	taskCountLabel,
	textareaRef,
}: ProjectDetailPageViewProps): JSX.Element {
	const [internalMode, setInternalMode] = useState<"edit" | "preview">("preview");
	const currentMode = controlledMode ?? internalMode;
	const setMode = controlledOnModeChange ?? setInternalMode;
	const metrics = [
		{ icon: "icon-[solar--chat-round-line-linear]", value: sessionCountLabel },
		createdAtLabel ? { icon: "icon-[solar--calendar-linear]", value: createdAtLabel } : null,
		taskCountLabel ? { icon: "icon-[solar--layers-linear]", value: taskCountLabel } : null,
	].filter((item): item is { icon: string; value: string } => item != null);

	return (
		<div className="flex h-full w-full flex-col overflow-hidden">
			<div className="flex min-h-0 flex-1">
				{/* @container：按主栏宽度（非视口）响应，Activity 挤窄时也能正确折叠 */}
				<div className="@container flex min-w-0 flex-1 flex-col">
					<header className="shrink-0 px-4 pb-8 pt-1 @md:px-8">
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
					</header>

					<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
						{batchSection}

						{/* ── Recent Sessions ─────────────────────────────────── */}
						{recentSessions.length > 0 && (
							<div className="w-full px-4 pb-8 @md:px-8">
								<section aria-label={labels.recentSessionsTitle}>
									<div className="mb-2 flex items-center justify-between">
										<h2 className="text-[13px] font-medium tracking-wide text-muted-foreground/80">
											{labels.recentSessionsTitle}
										</h2>
										{(runningSessionCount > 0 || runningTaskCount > 0) && (
											<span className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60">
												<span className="h-1.5 w-1.5 rounded-full bg-emerald-500/80 animate-pulse" />
												{[runningSessionCount > 0 ? labels.running : null, runningTaskCount > 0 ? labels.runningTasks : null].filter(Boolean).join(" · ")}
											</span>
										)}
									</div>

									<div className="flex flex-col">
										{recentSessions.map((session) => (
											<button
												key={session.path}
												type="button"
												onClick={() => onOpenRecentSession(session.path)}
												className="group relative flex w-full items-center justify-between gap-4 py-2 text-left transition-colors hover:text-foreground focus-visible:outline-1 focus-visible:outline-ring"
											>
												<div className="flex min-w-0 flex-1 items-center gap-2.5">
													{session.running ? (
														<span className="relative flex h-2 w-2 shrink-0">
															<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
															<span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
														</span>
													) : session.pinned ? (
														<span className="icon-[solar--pin-linear] h-3.5 w-3.5 shrink-0 text-primary/70" />
													) : (
														<span className="icon-[solar--chat-round-line-linear] h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground/70" aria-hidden />
													)}
													<span className="min-w-0 truncate text-[13px] text-foreground/90 transition-colors group-hover:text-foreground">
														{session.label}
													</span>
												</div>
												<div className="flex shrink-0 items-center gap-2">
													<time className="font-mono text-[11px] text-muted-foreground/50 transition-colors group-hover:text-muted-foreground/75">
														{session.date}
													</time>
													<span className="icon-[solar--alt-arrow-right-linear] h-3.5 w-3.5 text-muted-foreground/30 opacity-0 transition-all -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0" aria-hidden />
												</div>
											</button>
										))}
									</div>
								</section>
							</div>
						)}

						{/* ── Project Instructions ─────────────────────────────── */}
						<section className="flex w-full flex-col px-4 pb-12 @md:px-8">
							{/* Header controls: Document switch & Mode switch */}
							<div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 pb-4">
								<div className="flex flex-col gap-2">
									<h2 className="text-[13px] font-medium tracking-wide text-muted-foreground/80">
										{labels.contextTitle}
									</h2>
									<div role="tablist" aria-label={labels.contextTitle} className="flex gap-4">
										{(["AGENTS.md", "CLAUDE.md"] as const).map((file) => (
											<button
												key={file}
												type="button"
												role="tab"
												id={`project-context-${file}`}
												aria-controls="project-context-panel"
												aria-selected={activeDocument === file}
												onClick={() => onDocumentChange(file)}
												className={cn(
													"font-mono text-[13px] transition-colors focus-visible:outline-1 focus-visible:outline-ring",
													activeDocument === file
														? "font-semibold text-foreground underline decoration-primary/50 underline-offset-4"
														: "text-muted-foreground/60 hover:text-foreground"
												)}
											>
												{file}
											</button>
										))}
									</div>
								</div>

								{/* Right toolbar: Preview/Edit toggle + Save button */}
								<div className="flex items-center gap-2">
									<div className="flex items-center gap-1 rounded-md bg-accent/30 p-0.5 text-[11px]">
										<button
											type="button"
											onClick={() => setMode("preview")}
											className={cn(
												"rounded px-2 py-0.5 font-medium transition-colors",
												currentMode === "preview"
													? "bg-background text-foreground shadow-xs"
													: "text-muted-foreground/60 hover:text-foreground"
											)}
										>
											{labels.previewMode}
										</button>
										<button
											type="button"
											onClick={() => setMode("edit")}
											className={cn(
												"rounded px-2 py-0.5 font-medium transition-colors",
												currentMode === "edit"
													? "bg-background text-foreground shadow-xs"
													: "text-muted-foreground/60 hover:text-foreground"
											)}
										>
											{labels.editMode}
										</button>
									</div>

									{currentMode === "edit" && (
										<div className="flex items-center gap-1.5 ml-1">
											<AnimatePresence mode="popLayout">
												{saveStatus === "saved" && (
													<motion.span
														key="saved"
														initial={{ opacity: 0, x: 4 }}
														animate={{ opacity: 1, x: 0 }}
														exit={{ opacity: 0, x: 4 }}
														className="flex items-center gap-1 text-[11px] font-medium text-emerald-500"
													>
														<span className="icon-[mdi--check-circle] h-3.5 w-3.5" />
														<span className="hidden @min-[22rem]:inline">{labels.saved}</span>
													</motion.span>
												)}
												{saveStatus === "error" && (
													<motion.span
														key="error"
														initial={{ opacity: 0, x: 4 }}
														animate={{ opacity: 1, x: 0 }}
														exit={{ opacity: 0, x: 4 }}
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
												variant={isDirty ? "primary" : "ghost"}
												size="sm"
												onClick={onSave}
												disabled={loading || !isDirty || saveStatus === "saving"}
												aria-label={labels.save}
												className="h-7 px-2.5 text-[11px]"
											>
												{saveStatus === "saving" ? (
													<span className="icon-[mdi--loading] h-3.5 w-3.5 animate-spin" />
												) : (
													<span className="icon-[mdi--content-save-outline] h-3.5 w-3.5" />
												)}
												<span>{labels.save}</span>
											</Button>
										</div>
									)}
								</div>
							</div>

							{/* Document Content View */}
							<div role="tabpanel" id="project-context-panel" aria-labelledby={`project-context-${activeDocument}`}>
								<div className="flex min-h-0 min-w-0 flex-1 flex-col">
									{loading ? (
										<div className="flex flex-1 items-center justify-center py-20">
											<span className="icon-[mdi--loading] h-5 w-5 animate-spin text-primary/50" />
										</div>
									) : currentMode === "preview" ? (
										<div className="min-h-[22rem] py-1">
											{content.trim() ? (
												<div className="prose prose-sm dark:prose-invert max-w-none text-foreground/90 font-sans leading-relaxed">
													<MarkdownPreviewView
														content={content}
														theme={theme}
														className="!px-0 !pt-1 !pb-4"
														onOpenExternal={(href) => window.vetta?.shell?.openExternal?.(href)}
													/>
												</div>
											) : (
												<div className="flex flex-col items-start gap-3 py-10 text-muted-foreground/60">
													<p className="text-[13px]">{labels.emptyFileTitle}</p>
													<p className="text-[11px]">{labels.emptyFileHint}</p>
													<Button variant="outline" size="sm" onClick={() => setMode("edit")} className="mt-1">
														{labels.startEditing}
													</Button>
												</div>
											)}
										</div>
									) : (
										<div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
											<textarea
												aria-label={activeDocument}
												ref={textareaRef}
												value={content}
												onChange={(e) => onContentChange(e.target.value)}
												onFocus={onEditorFocus}
												onBlur={onEditorBlur}
												placeholder={labels.editorPlaceholder}
												spellCheck={false}
												className="min-h-[24rem] h-[32rem] min-w-0 flex-1 resize-y bg-accent/15 rounded-lg p-4 font-mono text-[12.5px] leading-relaxed text-foreground placeholder:text-muted-foreground/40 focus-visible:outline-1 focus-visible:outline-ring"
											/>
										</div>
									)}

									<p className="py-2.5 text-[11px] text-muted-foreground/60">
										{activeDocument === "AGENTS.md" ? labels.agentsMdHint : labels.claudeHint}{" "}
										<span className="whitespace-nowrap font-mono">{labels.saveShortcut}</span>
									</p>
								</div>
							</div>
						</section>
					</div>
				</div>
				{activityPanel}
			</div>
		</div>
	);
}
