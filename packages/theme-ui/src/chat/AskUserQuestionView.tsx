import { AnimatePresence, motion } from "motion/react";
import type { JSX } from "react";
import { useState } from "react";

const SWITCH = { duration: 0.18, ease: [0.22, 0.61, 0.36, 1] as const };

export interface AskUserQuestionOption {
	label: string;
	description?: string;
	badges?: string[];
}

export interface AskUserQuestionItem {
	question: string;
	header: string;
	options: AskUserQuestionOption[];
	multiSelect?: boolean;
}

export interface AskUserQuestionViewLabels {
	defaultQuestionLabel: (number: number) => string;
	cancelledMessage: string;
}

export interface AskUserQuestionViewProps {
	toolCallId: string;
	questions: AskUserQuestionItem[];
	cancelled: boolean;
	answersByQuestion: ReadonlyMap<string, string[]>;
	labels: AskUserQuestionViewLabels;
}

/**
 * ask_user_question transcript rich view: echoes questions and chosen answers.
 */
export function AskUserQuestionView({
	toolCallId,
	questions,
	cancelled,
	answersByQuestion,
	labels,
}: AskUserQuestionViewProps): JSX.Element | null {
	const [active, setActive] = useState(0);

	if (questions.length === 0) {
		return cancelled ? <CancelledBanner message={labels.cancelledMessage} /> : null;
	}

	const single = questions.length === 1;
	const activeIndex = Math.min(active, questions.length - 1);

	return (
		<div className="flex flex-col gap-2">
			{cancelled && <CancelledBanner message={labels.cancelledMessage} />}

			{!single && (
				<div className="flex items-center gap-0.5 overflow-x-auto">
					{questions.map((q, i) => {
						const answered = (answersByQuestion.get(q.question) ?? []).length > 0;
						const isActive = i === activeIndex;
						return (
							<button
								key={i}
								type="button"
								onClick={() => setActive(i)}
								className={`relative flex shrink-0 items-center gap-1 rounded-t-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
									isActive ? "text-foreground" : "text-muted-foreground/70 hover:text-foreground/80"
								}`}
							>
								<span className="max-w-[120px] truncate">
									{q.header || labels.defaultQuestionLabel(i + 1)}
								</span>
								{answered && <span className="icon-[mdi--check-circle] size-3 shrink-0 text-primary" />}
								{isActive && (
									<motion.span
										layoutId={`askq-tab-underline-${toolCallId}`}
										className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-primary"
										transition={SWITCH}
									/>
								)}
							</button>
						);
					})}
				</div>
			)}

			{single ? (
				<QuestionBody question={questions[0]} chosen={answersByQuestion.get(questions[0].question) ?? []} showHeader />
			) : (
				<div className="relative overflow-hidden">
					<AnimatePresence mode="wait" initial={false}>
						<motion.div
							key={activeIndex}
							initial={{ opacity: 0, x: 10 }}
							animate={{ opacity: 1, x: 0 }}
							exit={{ opacity: 0, x: -10 }}
							transition={SWITCH}
						>
							<QuestionBody
								question={questions[activeIndex]}
								chosen={answersByQuestion.get(questions[activeIndex].question) ?? []}
							/>
						</motion.div>
					</AnimatePresence>
				</div>
			)}
		</div>
	);
}

function CancelledBanner({ message }: { message: string }): JSX.Element {
	return (
		<div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
			<span className="icon-[mdi--close-circle-outline] size-3.5" />
			{message}
		</div>
	);
}

function QuestionBody({
	question,
	chosen,
	showHeader,
}: {
	question: AskUserQuestionItem;
	chosen: string[];
	showHeader?: boolean;
}): JSX.Element {
	return (
		<div className="rounded-lg border border-border/60 bg-background/40 p-2">
			<div className="mb-2 flex flex-col gap-1">
				{showHeader && question.header && (
					<span className="self-start rounded bg-muted px-1.5 py-0.5 text-[10px] leading-5 text-muted-foreground">
						{question.header}
					</span>
				)}
				<span className="break-words text-[12px] leading-5 text-foreground/90">{question.question}</span>
			</div>
			<div className="flex flex-col gap-1">
				{question.options.map((opt) => {
					const isChosen = chosen.includes(opt.label);
					return (
						<div
							key={opt.label}
							className={`grid grid-cols-[auto_minmax(0,1fr)] gap-x-1.5 gap-y-1 rounded px-1.5 py-0.5 text-[11px] ${
								isChosen ? "bg-primary/10 text-foreground" : "text-muted-foreground/60"
							}`}
						>
							<span
								className={`mt-0.5 size-3 shrink-0 ${
									isChosen ? "icon-[mdi--check-circle] text-primary" : "icon-[mdi--circle-outline]"
								}`}
							/>
							<span className="break-words leading-4">{opt.label}</span>
							{opt.badges && opt.badges.length > 0 && (
								<div className="col-start-2 flex flex-wrap items-center gap-1">
									{opt.badges.map((b) => (
										<span
											key={b}
											className="whitespace-nowrap rounded-full bg-primary/15 px-1 text-[9px] leading-4 text-primary"
										>
											{b}
										</span>
									))}
								</div>
							)}
						</div>
					);
				})}
				{chosen
					.filter((c) => !question.options.some((o) => o.label === c))
					.map((custom) => (
						<div
							key={custom}
							className="flex items-center gap-1.5 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-foreground"
						>
							<span className="icon-[mdi--pencil] size-3 shrink-0 text-primary" />
							<span className="min-w-0 flex-1">{custom}</span>
						</div>
					))}
			</div>
		</div>
	);
}
