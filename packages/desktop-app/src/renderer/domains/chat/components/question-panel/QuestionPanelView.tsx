import { Button } from "@vetta/ui";

import { ThemeSurface } from "@vetta/theme-ui/appearance";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { QuestionItem, QuestionPanelViewProps } from "./types";

interface QState {
	selected: string[];
	otherText: string;
	otherActive: boolean;
}

function emptyState(): QState {
	return { selected: [], otherText: "", otherActive: false };
}

function answersOf(state: QState): string[] {
	const out = [...state.selected];
	const other = state.otherText.trim();
	if (state.otherActive && other) out.push(other);
	return out;
}

function isAnswered(state: QState): boolean {
	return answersOf(state).length > 0;
}

function clamp(n: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, n));
}

const SWITCH = { duration: 0.18, ease: [0.22, 0.61, 0.36, 1] as const };

export function QuestionPanelView({
	pending,
	className,
	classNames,
	labels,
	onSubmitAnswers,
	onCancel,
}: QuestionPanelViewProps): JSX.Element {
	const questions = pending.questions;
	const [states, setStates] = useState<QState[]>(() => questions.map(() => emptyState()));
	const [active, setActive] = useState(0);
	const [focused, setFocused] = useState(0);
	const [submitting, setSubmitting] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);

	const allAnswered = useMemo(() => states.every(isAnswered), [states]);
	const activeIndex = Math.min(active, questions.length - 1);
	const activeQuestion = questions[activeIndex];
	const otherIndex = activeQuestion.options.length;
	const isLastQuestion = activeIndex >= questions.length - 1;
	const currentAnswered = isAnswered(states[activeIndex]);
	/** 多题未到最后一题：主按钮是「下一步」；单题或最后一题：主按钮是「提交」。 */
	const showNext = questions.length > 1 && !isLastQuestion;

	useEffect(() => {
		containerRef.current?.focus();
	}, []);

	const submit = useCallback(() => {
		if (!allAnswered || submitting) return;
		setSubmitting(true);
		onSubmitAnswers(questions.map((q, i) => ({ question: q.question, answers: answersOf(states[i]) })));
	}, [allAnswered, submitting, questions, states, onSubmitAnswers]);

	const cancel = useCallback(() => {
		if (submitting) return;
		setSubmitting(true);
		onCancel();
	}, [submitting, onCancel]);

	const goTab = useCallback(
		(next: number) => {
			setActive(clamp(next, 0, questions.length - 1));
			setFocused(0);
		},
		[questions.length],
	);

	const goNext = useCallback(() => {
		if (submitting || isLastQuestion || !currentAnswered) return;
		goTab(activeIndex + 1);
	}, [submitting, isLastQuestion, currentAnswered, activeIndex, goTab]);

	const advance = useCallback(() => {
		if (!isLastQuestion) goNext();
		else submit();
	}, [isLastQuestion, goNext, submit]);

	const toggleOption = useCallback((qIndex: number, label: string, multiSelect: boolean) => {
		setStates((prev) =>
			prev.map((s, i) => {
				if (i !== qIndex) return s;
				if (multiSelect) {
					const has = s.selected.includes(label);
					return { ...s, selected: has ? s.selected.filter((l) => l !== label) : [...s.selected, label] };
				}
				return { ...s, selected: [label], otherActive: false };
			}),
		);
	}, []);

	const activateOther = useCallback((qIndex: number, multiSelect: boolean) => {
		setStates((prev) =>
			prev.map((s, i) => {
				if (i !== qIndex) return s;
				return { ...s, otherActive: true, selected: multiSelect ? s.selected : [] };
			}),
		);
	}, []);

	const setOtherText = useCallback((qIndex: number, text: string) => {
		setStates((prev) => prev.map((s, i) => (i === qIndex ? { ...s, otherText: text, otherActive: true } : s)));
	}, []);

	const selectFocused = useCallback(() => {
		if (focused >= otherIndex) {
			activateOther(activeIndex, activeQuestion.multiSelect ?? false);
		} else {
			toggleOption(activeIndex, activeQuestion.options[focused].label, activeQuestion.multiSelect ?? false);
		}
	}, [focused, otherIndex, activeIndex, activeQuestion, activateOther, toggleOption]);

	const handleKey = useCallback(
		(e: React.KeyboardEvent<HTMLDivElement>) => {
			if (submitting || e.nativeEvent.isComposing) return;
			const inInput = (e.target as HTMLElement).tagName === "INPUT";
			switch (e.key) {
				case "Enter":
					e.preventDefault();
					advance();
					break;
				case "Tab":
					e.preventDefault();
					goTab(activeIndex + (e.shiftKey ? -1 : 1));
					break;
				case "ArrowRight":
					if (inInput) return;
					e.preventDefault();
					goTab(activeIndex + 1);
					break;
				case "ArrowLeft":
					if (inInput) return;
					e.preventDefault();
					goTab(activeIndex - 1);
					break;
				case "ArrowDown":
					if (inInput) return;
					e.preventDefault();
					setFocused((f) => clamp(f + 1, 0, otherIndex));
					break;
				case "ArrowUp":
					if (inInput) return;
					e.preventDefault();
					setFocused((f) => clamp(f - 1, 0, otherIndex));
					break;
				case " ":
					if (inInput) return;
					e.preventDefault();
					selectFocused();
					break;
				case "Escape":
					if (inInput) {
						(e.target as HTMLInputElement).blur();
						containerRef.current?.focus();
					}
					break;
			}
		},
		[submitting, advance, goTab, activeIndex, otherIndex, selectFocused],
	);

	const single = questions.length === 1;

	return (
		<div
			className={["relative mx-auto w-full max-w-2xl px-2 pb-3 pt-1 sm:px-4 sm:pb-4", className, classNames?.root]
				.filter(Boolean)
				.join(" ")}
		>
			<div
				ref={containerRef}
				tabIndex={-1}
				onKeyDown={handleKey}
				className={[
					"relative overflow-visible rounded-[20px] border border-primary/30 bg-card p-3 shadow-sm outline-none",
					classNames?.panel,
				]
					.filter(Boolean)
					.join(" ")}
			>
				<ThemeSurface slot="chat.questionPanel" />
				<div className={["relative z-10 rounded-[inherit]", classNames?.content].filter(Boolean).join(" ")}>
					<div className="mb-2 flex items-center gap-2 px-1">
						<span className="icon-[solar--question-circle-linear] size-4 text-primary" />
						<span className="text-sm font-medium text-foreground">{labels.title}</span>
						{!single && (
							<span className="text-xs text-muted-foreground">
								{states.filter(isAnswered).length}/{questions.length}
							</span>
						)}
					</div>

					{!single && (
						<div className="mb-2 flex items-center gap-0.5 overflow-x-auto border-b border-border/60">
							{questions.map((q, i) => {
								const answered = isAnswered(states[i]);
								const isActive = i === activeIndex;
								return (
									<button
										key={i}
										type="button"
										tabIndex={-1}
										onClick={() => goTab(i)}
										className={`relative flex shrink-0 items-center gap-1 rounded-t-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
											isActive ? "text-foreground" : "text-muted-foreground/70 hover:text-foreground/80"
										}`}
									>
										<span className="max-w-[120px] truncate">
											{q.header || labels.questionTabLabel(i + 1)}
										</span>
										{answered && <span className="icon-[solar--check-circle-bold] size-3 shrink-0 text-primary" />}
										{isActive && (
											<motion.span
												layoutId={`askq-panel-underline-${pending.requestId}`}
												className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-primary"
												transition={SWITCH}
											/>
										)}
									</button>
								);
							})}
						</div>
					)}

					<div
						className={["relative max-h-[46vh] overflow-x-hidden overflow-y-auto", classNames?.body]
							.filter(Boolean)
							.join(" ")}
					>
						<AnimatePresence mode="wait" initial={false}>
							<motion.div
								key={activeIndex}
								initial={{ opacity: 0, x: single ? 0 : 10 }}
								animate={{ opacity: 1, x: 0 }}
								exit={{ opacity: 0, x: single ? 0 : -10 }}
								transition={SWITCH}
							>
								<QuestionBody
									question={activeQuestion}
									state={states[activeIndex]}
									focused={focused}
									showHeader={single}
									multiSelectHint={labels.multiSelectHint}
									otherOption={labels.otherOption}
									otherPlaceholder={labels.otherPlaceholder}
									onToggleOption={(label) =>
										toggleOption(activeIndex, label, activeQuestion.multiSelect ?? false)
									}
									onFocusOption={setFocused}
									onActivateOther={() => activateOther(activeIndex, activeQuestion.multiSelect ?? false)}
									onOtherText={(text) => setOtherText(activeIndex, text)}
								/>
							</motion.div>
						</AnimatePresence>
					</div>

					<div
						className={["mt-3 flex items-center justify-between gap-2", classNames?.footer]
							.filter(Boolean)
							.join(" ")}
					>
						<span className="hidden px-1 text-[11px] text-muted-foreground/70 sm:inline">
							{labels.keyboardHint}
						</span>
						<div className="flex items-center gap-2">
							<Button variant="ghost" size="sm" onClick={cancel} disabled={submitting}>
								{labels.cancel}
							</Button>
							{showNext ? (
								<Button size="sm" onClick={goNext} disabled={!currentAnswered || submitting}>
									{labels.next}
								</Button>
							) : (
								<Button size="sm" onClick={submit} disabled={!allAnswered || submitting}>
									{labels.submit}
								</Button>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

interface QuestionBodyProps {
	question: QuestionItem;
	state: QState;
	focused: number;
	showHeader: boolean;
	multiSelectHint: string;
	otherOption: string;
	otherPlaceholder: string;
	onToggleOption: (label: string) => void;
	onFocusOption: (index: number) => void;
	onActivateOther: () => void;
	onOtherText: (text: string) => void;
}

function QuestionBody({
	question,
	state,
	focused,
	showHeader,
	multiSelectHint,
	otherOption,
	otherPlaceholder,
	onToggleOption,
	onFocusOption,
	onActivateOther,
	onOtherText,
}: QuestionBodyProps): JSX.Element {
	const multiSelect = question.multiSelect ?? false;
	const otherIndex = question.options.length;

	return (
		<div className="rounded-xl border border-border bg-background/40 p-2">
			<div className="mb-2 flex items-start gap-1.5 px-1">
				{showHeader && question.header && (
					<span className="shrink-0 whitespace-nowrap rounded bg-muted px-1.5 py-0.5 text-[10px] leading-5 text-muted-foreground">
						{question.header}
					</span>
				)}
				<span className="min-w-0 flex-1 text-sm leading-5 text-foreground">{question.question}</span>
			</div>
			{multiSelect && <p className="mb-1 px-1 text-xs text-muted-foreground">{multiSelectHint}</p>}

			<div className="flex flex-col gap-1.5">
				{question.options.map((opt, i) => {
					const selected = state.selected.includes(opt.label);
					const isFocused = focused === i;
					return (
						<button
							key={opt.label}
							type="button"
							tabIndex={-1}
							onClick={() => {
								onFocusOption(i);
								onToggleOption(opt.label);
							}}
							onMouseEnter={() => onFocusOption(i)}
							className={`flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors ${
								selected ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50"
							} ${isFocused ? "ring-1 ring-primary/50" : ""}`}
						>
							<div className="flex items-center gap-2">
								<span
									className={`size-3.5 shrink-0 ${
										selected
											? multiSelect
												? "icon-[mdi--checkbox-marked] text-primary"
												: "icon-[mdi--radiobox-marked] text-primary"
											: multiSelect
												? "icon-[mdi--checkbox-blank-outline] text-muted-foreground"
												: "icon-[mdi--radiobox-blank] text-muted-foreground"
									}`}
								/>
								<span className="text-sm font-medium text-foreground">{opt.label}</span>
								{opt.badges?.map((badge) => (
									<span
										key={badge}
										className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary"
									>
										{badge}
									</span>
								))}
							</div>
							{opt.description && <span className="pl-5 text-xs text-muted-foreground">{opt.description}</span>}
						</button>
					);
				})}

				<div
					className={`flex flex-col gap-1 rounded-lg border px-3 py-2 ${
						state.otherActive ? "border-primary bg-primary/5" : "border-dashed border-border"
					} ${focused === otherIndex ? "ring-1 ring-primary/50" : ""}`}
				>
					<button
						type="button"
						tabIndex={-1}
						onClick={() => {
							onFocusOption(otherIndex);
							onActivateOther();
						}}
						onMouseEnter={() => onFocusOption(otherIndex)}
						className="flex items-center gap-2 text-left text-sm text-muted-foreground"
					>
						<span className="icon-[solar--pen-2-linear] size-3.5 shrink-0" />
						{otherOption}
					</button>
					{state.otherActive && (
						<input
							// biome-ignore lint/a11y/noAutofocus: preserve original other-option focus
							autoFocus
							value={state.otherText}
							onChange={(e) => onOtherText(e.target.value)}
							placeholder={otherPlaceholder}
							className="h-8 w-full min-w-0 rounded-lg border border-border/60 bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring/60"
						/>
					)}
				</div>
			</div>
		</div>
	);
}
