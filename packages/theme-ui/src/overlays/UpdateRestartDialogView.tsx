import { AnimatePresence, motion } from "motion/react";
import type { JSX, RefObject } from "react";
import { cn } from "@vetta/ui";
import { ThemeSurface } from "../appearance/ThemeSurface";

export interface UpdateRestartDialogViewLabels {
	readonly install: string;
	readonly later: string;
	readonly message: string;
	readonly title: string;
}

export interface UpdateRestartDialogViewProps {
	readonly labels: UpdateRestartDialogViewLabels;
	readonly onClose: () => void;
	readonly onInstall: () => void;
	readonly overlayRef: RefObject<HTMLDivElement | null>;
	readonly releaseNote?: string;
	readonly visible: boolean;
}

/** Matches desktop Button ghost/primary + sm without importing host UI primitives. */
const buttonBase =
	"group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50";
const buttonSm =
	"h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem]";

export function UpdateRestartDialogView({
	labels,
	onClose,
	onInstall,
	overlayRef,
	releaseNote,
	visible,
}: UpdateRestartDialogViewProps): JSX.Element {
	return (
		<AnimatePresence>
			{visible && (
				<motion.div
					ref={overlayRef}
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					transition={{ duration: 0.15 }}
					className="fixed inset-0 z-[100] flex items-center justify-center bg-background/70"
					onClick={(e) => {
						if (e.target === overlayRef.current) onClose();
					}}
				>
					<motion.div
						initial={{ opacity: 0, scale: 0.95 }}
						animate={{ opacity: 1, scale: 1 }}
						exit={{ opacity: 0, scale: 0.95 }}
						transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
						className="relative w-[420px] rounded-xl border border-border bg-popover shadow-lg"
					>
						<ThemeSurface slot="root.updateRestartDialog.panel" />
						<div className="relative z-10 p-5">
							<div className="flex items-center gap-2">
								<span className="icon-[mdi--download-circle-outline] h-5 w-5 text-primary" />
								<h3 className="text-[15px] font-semibold text-foreground">{labels.title}</h3>
							</div>
							<p className="mt-2 text-[12px] text-muted-foreground">{labels.message}</p>
							{releaseNote && (
								<div className="mt-3 max-h-[40vh] overflow-auto rounded-lg border border-border bg-secondary/50 p-3">
									<p className="whitespace-pre-wrap break-words text-[12px] text-muted-foreground">
										{releaseNote}
									</p>
								</div>
							)}
							<div className="mt-5 flex justify-end gap-2">
								<button
									type="button"
									data-slot="button"
									data-variant="ghost"
									data-size="sm"
									className={cn(
										buttonBase,
										buttonSm,
										"text-muted-foreground hover:bg-accent/50 hover:text-foreground",
									)}
									onClick={onClose}
								>
									{labels.later}
								</button>
								<button
									type="button"
									data-slot="button"
									data-variant="primary"
									data-size="sm"
									className={cn(
										buttonBase,
										buttonSm,
										"bg-primary text-primary-foreground hover:bg-primary/90",
									)}
									onClick={onInstall}
								>
									{labels.install}
								</button>
							</div>
						</div>
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
