import type { JSX } from "react";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@vetta/ui";

/**
 * Per-channel "how this works" guide, opened from a channel's config
 * dialog. Same shape as the knowledge-base guide (numbered steps down a
 * spine, callouts at the end) so the two read as one family; the extras
 * here are what IM setup actually needs — a command or URL attached to a
 * step, and callouts that can warn rather than only inform.
 */
export interface ImChannelGuideStepView {
	readonly icon: string;
	readonly title: string;
	readonly description: string;
	/** Command or URL to copy, rendered monospace under the step. */
	readonly code?: string;
}

export interface ImChannelGuideNoteView {
	/** "warning" is for things that break or surprise the user. */
	readonly tone: "info" | "warning";
	readonly title: string;
	readonly description: string;
}

export interface ImChannelGuideDialogViewLabels {
	readonly title: string;
	readonly subtitle: string;
	readonly close: string;
}

export interface ImChannelGuideDialogViewProps {
	readonly open: boolean;
	readonly onClose: () => void;
	readonly steps: readonly ImChannelGuideStepView[];
	readonly notes: readonly ImChannelGuideNoteView[];
	readonly labels: ImChannelGuideDialogViewLabels;
}

export function ImChannelGuideDialogView({
	open,
	onClose,
	steps,
	notes,
	labels,
}: ImChannelGuideDialogViewProps): JSX.Element {
	return (
		<Dialog open={open} onOpenChange={(next) => !next && onClose()}>
			{/* 弹窗本体固定高度、不滚动：滚动条只出现在下面的内容区，
			    页头与页脚始终可见；overflow-x-hidden 杜绝横向滚动条。 */}
			<DialogContent className="flex max-h-[min(90vh,760px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[560px]">
				<DialogHeader className="shrink-0 gap-3 border-b border-border px-6 pt-6 pb-5">
					<div className="flex items-start gap-3.5">
						<div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15 ring-inset">
							<span className="icon-[mdi--book-open-page-variant-outline] h-5 w-5" />
						</div>
						<div className="min-w-0">
							<DialogTitle className="text-[16px]">{labels.title}</DialogTitle>
							<DialogDescription className="mt-1 text-[12.5px] leading-relaxed">
								{labels.subtitle}
							</DialogDescription>
						</div>
					</div>
				</DialogHeader>

				<div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6 py-5">
					<ol className="relative flex flex-col gap-5">
						{/* 贯穿步骤序号的竖线，连接 1→2→3 */}
						<span aria-hidden className="absolute top-4 bottom-4 left-[15px] w-px bg-border" />
						{steps.map((step, index) => (
							<li key={`${step.title}-${index}`} className="relative flex items-start gap-3.5">
								<span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-[13px] font-semibold text-primary-foreground shadow-sm">
									{index + 1}
								</span>
								<div className="min-w-0 flex-1 pt-0.5">
									<div className="flex items-center gap-1.5">
										<span className={`${step.icon} h-4 w-4 shrink-0 text-muted-foreground`} />
										<span className="min-w-0 text-[13.5px] font-semibold break-words text-foreground">
											{step.title}
										</span>
									</div>
									<p className="mt-1 text-[12.5px] leading-relaxed break-words text-muted-foreground">
										{step.description}
									</p>
									{step.code && (
										<code className="mt-1.5 block rounded-md border border-border bg-secondary px-2.5 py-1.5 font-mono text-[11.5px] break-all whitespace-pre-wrap text-foreground">
											{step.code}
										</code>
									)}
								</div>
							</li>
						))}
					</ol>

					{notes.map((note, index) => (
						<div
							key={`${note.title}-${index}`}
							className={
								note.tone === "warning"
									? "mt-4 flex items-start gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/[0.07] p-3.5"
									: "mt-4 flex items-start gap-2.5 rounded-xl border border-border bg-card/40 p-3.5"
							}
						>
							<span
								className={
									note.tone === "warning"
										? "icon-[mdi--alert-circle-outline] mt-px h-4 w-4 shrink-0 text-amber-500"
										: "icon-[mdi--information-outline] mt-px h-4 w-4 shrink-0 text-muted-foreground"
								}
							/>
							<p className="min-w-0 text-[12.5px] leading-relaxed break-words text-muted-foreground">
								<span className="font-semibold text-foreground">{note.title}</span> {note.description}
							</p>
						</div>
					))}
				</div>

				<DialogFooter className="shrink-0 border-t border-border px-6 py-4">
					<Button variant="primary" onClick={onClose}>
						{labels.close}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
