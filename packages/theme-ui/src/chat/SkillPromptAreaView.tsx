import type { ChangeEvent, JSX, KeyboardEvent, ReactNode, RefObject } from "react";

export interface SkillPromptAreaViewLabels {
	removeSkill: string;
	removeSkillMissing: string;
	missingBadge: string;
	skillButtonTitle: string;
	skillButtonLabel: string;
}

export interface SkillPromptAreaViewProps {
	prompt: string;
	placeholder: string;
	minHeight: number;
	className?: string;
	autoFocus?: boolean;
	slashOpen: boolean;
	skillMissing: boolean;
	isScene: boolean;
	skillDisplayName: string;
	hasSkill: boolean;
	anchorRect: DOMRect | null;
	textareaRef: RefObject<HTMLTextAreaElement | null>;
	cardRef: RefObject<HTMLDivElement | null>;
	labels: SkillPromptAreaViewLabels;
	/** Host SlashPanel portal content (or null). */
	slashPanel: ReactNode;
	onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
	onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
	onPlusClick: () => void;
	onRemoveSkill: () => void;
}

/**
 * Batch-task / automation prompt field with skill capsule + slash panel slot.
 */
export function SkillPromptAreaView({
	prompt,
	placeholder,
	minHeight,
	className,
	autoFocus,
	slashOpen,
	skillMissing,
	isScene,
	skillDisplayName,
	hasSkill,
	textareaRef,
	cardRef,
	labels,
	slashPanel,
	onChange,
	onKeyDown,
	onPlusClick,
	onRemoveSkill,
}: SkillPromptAreaViewProps): JSX.Element {
	return (
		<div className={`relative ${className ?? ""}`}>
			{slashPanel}

			<div ref={cardRef} className="rounded-lg border border-border/60 bg-background/30">
				{hasSkill && (
					<div>
							<div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5">
								<button
									type="button"
									onClick={onRemoveSkill}
									title={skillMissing ? labels.removeSkillMissing : labels.removeSkill}
									className={`group flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
										skillMissing
											? "border-amber-500/40 bg-amber-500/10 text-amber-500"
											: "border-primary/20 bg-primary/10 text-primary"
									}`}
								>
									<span
										className={`${isScene ? "icon-[mdi--movie-open-outline]" : "icon-[mdi--puzzle-outline]"} h-3 w-3 shrink-0`}
									/>
									<span className="max-w-[160px] truncate">{skillDisplayName}</span>
									{skillMissing && (
										<span className="shrink-0 rounded-sm bg-amber-500/20 px-1 py-px text-[9px] font-medium">
											{labels.missingBadge}
										</span>
									)}
									<span className="icon-[mdi--close] h-3 w-3 opacity-50 transition-opacity group-hover:opacity-100" />
								</button>
							</div>
					</div>
				)}

				<textarea
					ref={textareaRef}
					value={prompt}
					onChange={onChange}
					onKeyDown={onKeyDown}
					placeholder={placeholder}
					autoFocus={autoFocus}
					className="block w-full resize-y border-none bg-transparent px-3 pt-2.5 pb-1 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
					style={{ minHeight }}
				/>

				<div className="flex items-center justify-start gap-1 border-t border-border/40 px-2 py-1.5">
					<button
						type="button"
						onClick={onPlusClick}
						title={labels.skillButtonTitle}
						className={`flex h-7 items-center gap-1 rounded-md px-2 text-[12px] transition-colors ${
							slashOpen
								? "bg-primary/10 text-primary"
								: "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
						}`}
					>
						<span className="icon-[mdi--plus] h-3.5 w-3.5" />
						<span>{labels.skillButtonLabel}</span>
					</button>
				</div>
			</div>
		</div>
	);
}
