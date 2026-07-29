import type { JSX } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
	Button,
	Popover,
	PopoverContent,
	PopoverTrigger,
	cn,
} from "@vetta/ui";
import { SettingsAiAssistButtonView } from "./SettingsAiAssistButtonView";

export interface SettingsAiAssistDialogViewLabels {
	readonly title: string;
	readonly description: string;
	readonly approvalHint: string;
	readonly cancel: string;
	readonly start: string;
}

export interface SettingsAiAssistDialogViewProps {
	readonly open: boolean;
	readonly onOpenChange: (open: boolean) => void;
	readonly triggerLabel: string;
	readonly examples: readonly string[];
	readonly intent: string;
	readonly placeholder: string;
	readonly submitError: string | null;
	readonly onApplyExample: (text: string) => void;
	readonly onIntentChange: (value: string) => void;
	/** Optional origin rect (submit button) so the fly-orb starts at the click point. */
	readonly onSubmit: (originRect?: DOMRect | null) => void;
	readonly labels: SettingsAiAssistDialogViewLabels;
	readonly className?: string;
}

const springPop = { type: "spring" as const, stiffness: 380, damping: 26 };
const springChip = { type: "spring" as const, stiffness: 420, damping: 22 };

/**
 * AI-assist intent entry as a solid-surface popover under the CTA.
 * Header icon peeks above the panel edge.
 */
export function SettingsAiAssistDialogView({
	open,
	onOpenChange,
	triggerLabel,
	examples,
	intent,
	placeholder,
	submitError,
	onApplyExample,
	onIntentChange,
	onSubmit,
	labels,
	className,
}: SettingsAiAssistDialogViewProps): JSX.Element {
	const reduceMotion = useReducedMotion();

	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<PopoverTrigger asChild>
				<SettingsAiAssistButtonView label={triggerLabel} className={className} />
			</PopoverTrigger>

			<PopoverContent
				side="bottom"
				align="end"
				sideOffset={14}
				collisionPadding={12}
				onOpenAutoFocus={(event) => {
					const root = event.currentTarget as HTMLElement | null;
					const field = root?.querySelector("textarea");
					if (field instanceof HTMLTextAreaElement) {
						event.preventDefault();
						field.focus();
					}
				}}
				className={cn(
					// Solid surface; overflow-visible so the badge can sit on the top edge.
					"w-[min(21rem,calc(100vw-1.5rem))] gap-0 overflow-visible border-border bg-popover p-0 text-popover-foreground shadow-md",
					// Shell enter/leave (children also have motion springs). Requires tw-animate-css +
					// data-open/data-closed → data-state mapping in the host stylesheet.
					"origin-(--radix-popover-content-transform-origin)",
					"data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-top-1",
					"data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:slide-out-to-top-1",
					"data-[state=open]:duration-200 data-[state=closed]:duration-220",
					"ease-out",
				)}
			>
				{/* Floating badge — peeks above the border */}
				<motion.div
					aria-hidden
					initial={reduceMotion ? false : { opacity: 0, y: 6, scale: 0.88 }}
					animate={{ opacity: 1, y: 0, scale: 1 }}
					transition={reduceMotion ? { duration: 0 } : springPop}
					className="absolute top-0 left-4 z-10 -translate-y-1/2"
				>
					<div className="relative flex size-10 items-center justify-center">
						{!reduceMotion && (
							<motion.span
								className="absolute inset-0 rounded-full bg-primary/25"
								animate={{ scale: [1, 1.4, 1], opacity: [0.5, 0, 0.5] }}
								transition={{ duration: 2.4, repeat: Number.POSITIVE_INFINITY, ease: "easeOut" }}
							/>
						)}
						<span className="relative flex size-10 items-center justify-center rounded-full border border-border bg-popover text-primary shadow-md ring-2 ring-popover">
							<motion.span
								className="icon-[solar--magic-stick-3-bold] h-[18px] w-[18px]"
								animate={reduceMotion ? undefined : { rotate: [0, -10, 10, 0] }}
								transition={
									reduceMotion
										? undefined
										: {
												duration: 2.6,
												repeat: Number.POSITIVE_INFINITY,
												ease: "easeInOut",
												repeatDelay: 0.7,
											}
								}
							/>
						</span>
					</div>
				</motion.div>

				<motion.div
					initial={reduceMotion ? false : { opacity: 0, y: -6, scale: 0.98 }}
					animate={{ opacity: 1, y: 0, scale: 1 }}
					transition={reduceMotion ? { duration: 0 } : springPop}
					className="relative flex flex-col overflow-hidden rounded-[inherit]"
				>
					{/* Title block */}
					<div className="relative border-b border-border bg-popover px-3.5 pt-6 pb-3">
						{/* Subtle primary accent strip under the badge line */}
						<div
							aria-hidden
							className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-primary/10 to-transparent"
						/>
						{/* Icon floats above the border — title stays left-aligned in content padding */}
						<div className="relative min-w-0 text-left">
							<div className="flex items-center gap-2">
								<h2 className="truncate text-[14px] font-semibold tracking-tight text-foreground">
									{labels.title}
								</h2>
								<span className="relative mt-px flex size-1.5 shrink-0" aria-hidden>
									{!reduceMotion && (
										<span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-40" />
									)}
									<span className="relative inline-flex size-1.5 rounded-full bg-primary" />
								</span>
							</div>
							<p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
								{labels.description}
							</p>
						</div>
					</div>

					{/* Body */}
					<div className="relative flex flex-col gap-3 bg-popover p-3.5">
						{examples.length > 0 && (
							<div className="flex flex-col items-start gap-1.5">
								{examples.map((example, index) => (
									<motion.button
										key={example}
										type="button"
										onClick={() => onApplyExample(example)}
										initial={reduceMotion ? false : { opacity: 0, x: -8, scale: 0.96 }}
										animate={{ opacity: 1, x: 0, scale: 1 }}
										transition={
											reduceMotion
												? { duration: 0 }
												: { ...springChip, delay: 0.06 + index * 0.05 }
										}
										whileHover={reduceMotion ? undefined : { x: 2, scale: 1.02 }}
										whileTap={reduceMotion ? undefined : { scale: 0.98 }}
										className={cn(
											"max-w-full rounded-2xl rounded-bl-md border border-border bg-muted px-2.5 py-1.5 text-left text-[11px] leading-snug text-foreground/90",
											"transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-foreground",
										)}
									>
										<span className="mr-1 text-primary">✦</span>
										{example}
									</motion.button>
								))}
							</div>
						)}

						<div
							className={cn(
								"relative rounded-xl border border-input bg-background",
								"transition-[border-color]",
								"focus-within:border-primary/50",
							)}
						>
							<textarea
								value={intent}
								onChange={(event) => onIntentChange(event.target.value)}
								placeholder={placeholder}
								rows={3}
								className={cn(
									"field-sizing-content min-h-[4.5rem] w-full resize-none bg-transparent px-2.5 py-2 pr-11 pb-10 text-[13px] text-foreground outline-none",
									"placeholder:text-muted-foreground",
								)}
								onKeyDown={(event) => {
									if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
										event.preventDefault();
										// Keyboard path: no click rect; consumer falls back to DOM snapshot.
										onSubmit(null);
									}
								}}
							/>
							<div className="absolute right-1.5 bottom-1.5">
								<Button
									type="button"
									variant="primary"
									size="icon-sm"
									data-settings-ai-assist-submit=""
									onClick={(event) => {
										onSubmit(event.currentTarget.getBoundingClientRect());
									}}
									title={labels.start}
									aria-label={labels.start}
									className="size-8 rounded-full"
								>
									<span className="icon-[solar--arrow-to-top-left-linear] h-3.5 w-3.5" />
								</Button>
							</div>
						</div>

						<p className="text-[10px] leading-relaxed text-muted-foreground">{labels.approvalHint}</p>

						<AnimatePresence>
							{submitError ? (
								<motion.div
									initial={reduceMotion ? false : { opacity: 0, height: 0 }}
									animate={{ opacity: 1, height: "auto" }}
									exit={reduceMotion ? undefined : { opacity: 0, height: 0 }}
									className="overflow-hidden"
								>
									<div className="flex items-start gap-2 rounded-lg bg-destructive/10 px-2.5 py-2 text-[12px] text-destructive">
										<span className="icon-[solar--danger-circle-linear] mt-0.5 h-3.5 w-3.5 shrink-0" />
										<span>{submitError}</span>
									</div>
								</motion.div>
							) : null}
						</AnimatePresence>
					</div>
				</motion.div>
			</PopoverContent>
		</Popover>
	);
}
