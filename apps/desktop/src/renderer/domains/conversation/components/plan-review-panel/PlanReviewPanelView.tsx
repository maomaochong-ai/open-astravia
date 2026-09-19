import { Textarea } from "@shared/components/ui/textarea";
import { ThemeSurface } from "@vetta-org/theme-ui/appearance";
import { Button } from "@vetta-org/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { composePlanFeedback, type PlanSegment, splitPlanIntoSegments } from "../../services/plan-review";
import { MarkdownContent } from "../blocks/TextBlock";
import type { PlanReviewPanelViewProps } from "./types";

type Mode = "review" | "editing" | "feedback";

/**
 * 计划审批面板：接管输入区，直到用户对计划做出决定。
 *
 * 阅读顺序即决策顺序——先看计划，再选「批准」或「要求修改」。编辑正文、逐条意见属于次级操作，
 * 出现在需要它们的位置而不与主操作争抢注意力。
 */
export function PlanReviewPanelView({
	plan,
	labels,
	onApprove,
	onRequestChanges,
	onDismiss,
	className,
}: PlanReviewPanelViewProps): JSX.Element {
	const [mode, setMode] = useState<Mode>("review");
	const [draftPlan, setDraftPlan] = useState(plan);
	const [feedback, setFeedback] = useState("");
	const [stepComments, setStepComments] = useState<Record<string, string>>({});
	const [commentingKey, setCommentingKey] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		containerRef.current?.focus();
	}, []);

	const segments = useMemo(() => splitPlanIntoSegments(draftPlan), [draftPlan]);
	const editedPlan = draftPlan.trim() !== plan.trim() && draftPlan.trim().length > 0 ? draftPlan : undefined;
	const comments = segments.flatMap((segment) =>
		segment.kind === "step" && stepComments[segment.key]?.trim()
			? [{ number: segment.number, title: segment.title, comment: stepComments[segment.key] ?? "" }]
			: [],
	);
	const composedFeedback = composePlanFeedback(feedback, comments);
	const canSendFeedback = composedFeedback.length > 0 || editedPlan !== undefined;

	const approve = (): void => {
		setSubmitting(true);
		onApprove(editedPlan);
	};
	const dismiss = (): void => {
		setSubmitting(true);
		onDismiss();
	};
	const sendFeedback = (): void => {
		if (!canSendFeedback) return;
		setSubmitting(true);
		onRequestChanges(composedFeedback, editedPlan);
	};

	return (
		<div className={["relative mx-auto w-full max-w-2xl px-2 pb-3 pt-1 sm:px-4 sm:pb-4", className].filter(Boolean).join(" ")}>
			<section
				ref={containerRef}
				tabIndex={-1}
				aria-labelledby="plan-review-title"
				className="relative rounded-2xl border border-primary/30 bg-card p-3 shadow-sm outline-none"
			>
				<ThemeSurface slot="chat.questionPanel" />
				<div className="relative z-10 rounded-[inherit]">
					<header className="mb-2 flex items-start gap-2 px-1">
						<span className="icon-[solar--checklist-minimalistic-linear] mt-0.5 size-4 shrink-0 text-primary" />
						<div className="min-w-0 flex-1">
							<h2 id="plan-review-title" className="text-sm font-medium text-foreground">
								{labels.title}
							</h2>
							<p className="text-xs leading-5 text-muted-foreground">{labels.subtitle}</p>
						</div>
						{editedPlan !== undefined && mode !== "editing" && (
							<span className="flex shrink-0 items-center gap-1">
								<span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium leading-4 text-primary">
									{labels.edited}
								</span>
								<Button variant="ghost" size="xs" disabled={submitting} onClick={() => setDraftPlan(plan)}>
									{labels.resetEdits}
								</Button>
							</span>
						)}
						<Button
							variant="ghost"
							size="xs"
							disabled={submitting}
							onClick={() => setMode(mode === "editing" ? "review" : "editing")}
						>
							<span
								className={`${mode === "editing" ? "icon-[solar--check-circle-linear]" : "icon-[solar--pen-2-linear]"} size-3`}
							/>
							{mode === "editing" ? labels.doneEditing : labels.edit}
						</Button>
					</header>

					<div className="max-h-[46vh] overflow-x-hidden overflow-y-auto rounded-xl border border-border bg-background/40 p-2">
						{mode === "editing" ? (
							<Textarea
								// biome-ignore lint/a11y/noAutofocus: 进入编辑态即开始改正文，与问答面板的自定义输入一致
								autoFocus
								aria-label={labels.editorLabel}
								value={draftPlan}
								onChange={(event) => setDraftPlan(event.target.value)}
								className="min-h-40 resize-none border-transparent bg-transparent font-mono text-[13px] leading-6 focus-visible:border-transparent dark:bg-transparent"
							/>
						) : (
							<ol className="flex list-none flex-col gap-1 p-0">
								{segments.map((segment) => (
									<PlanSegmentItem
										key={segment.key}
										segment={segment}
										comment={stepComments[segment.key] ?? ""}
										commenting={commentingKey === segment.key}
										disabled={submitting}
										commentLabel={segment.kind === "step" ? labels.commentOnStep(segment.number) : ""}
										commentPlaceholder={labels.stepCommentPlaceholder}
										onToggleComment={() => setCommentingKey(commentingKey === segment.key ? null : segment.key)}
										onCommentChange={(comment) => setStepComments((prev) => ({ ...prev, [segment.key]: comment }))}
									/>
								))}
							</ol>
						)}
					</div>

					{mode === "feedback" && (
						<label className="mt-2 flex flex-col gap-1 px-1">
							<span className="text-xs font-medium text-foreground">{labels.feedbackLabel}</span>
							<Textarea
								// biome-ignore lint/a11y/noAutofocus: 用户刚选择「要求修改」，下一步就是写意见
								autoFocus
								value={feedback}
								onChange={(event) => setFeedback(event.target.value)}
								placeholder={labels.feedbackPlaceholder}
								className="max-h-32 min-h-16 resize-none text-[13px]"
							/>
						</label>
					)}

					<footer className="mt-3 flex items-center justify-between gap-2">
						<Button variant="ghost" size="sm" disabled={submitting} onClick={dismiss}>
							{labels.dismiss}
						</Button>
						<div className="flex items-center gap-2">
							{mode === "feedback" ? (
								<>
									<Button variant="outline" size="sm" disabled={submitting} onClick={() => setMode("review")}>
										{labels.back}
									</Button>
									<Button variant="primary" size="sm" disabled={!canSendFeedback || submitting} onClick={sendFeedback}>
										{labels.sendFeedback(comments.length)}
									</Button>
								</>
							) : comments.length > 0 ? (
								// 已经写了逐条意见：下一步最可能是把意见发回去，而不是带着异议批准。
								<>
									<Button variant="outline" size="sm" disabled={submitting} onClick={approve}>
										{labels.approve}
									</Button>
									<Button variant="primary" size="sm" disabled={submitting} onClick={() => setMode("feedback")}>
										{labels.sendFeedback(comments.length)}
									</Button>
								</>
							) : (
								<>
									<Button variant="outline" size="sm" disabled={submitting} onClick={() => setMode("feedback")}>
										{labels.requestChanges}
									</Button>
									<Button variant="primary" size="sm" disabled={submitting} onClick={approve}>
										{labels.approve}
									</Button>
								</>
							)}
						</div>
					</footer>
				</div>
			</section>
		</div>
	);
}

interface PlanSegmentItemProps {
	segment: PlanSegment;
	comment: string;
	commenting: boolean;
	disabled: boolean;
	commentLabel: string;
	commentPlaceholder: string;
	onToggleComment: () => void;
	onCommentChange: (comment: string) => void;
}

function PlanSegmentItem({
	segment,
	comment,
	commenting,
	disabled,
	commentLabel,
	commentPlaceholder,
	onToggleComment,
	onCommentChange,
}: PlanSegmentItemProps): JSX.Element {
	if (segment.kind === "text") {
		return (
			<li className="px-1">
				<MarkdownContent text={segment.markdown} className="text-[13px]" />
			</li>
		);
	}
	const hasComment = comment.trim().length > 0;
	return (
		<li
			className={`group/step rounded-lg border px-1 transition-colors ${
				hasComment || commenting ? "border-primary/40 bg-primary/5" : "border-transparent hover:bg-muted/40"
			}`}
		>
			<div className="flex items-start gap-1">
				<div className="min-w-0 flex-1">
					<MarkdownContent text={segment.markdown} className="text-[13px]" />
				</div>
				<Button
					variant="ghost"
					size="icon-xs"
					title={commentLabel}
					aria-label={commentLabel}
					aria-expanded={commenting}
					disabled={disabled}
					onClick={onToggleComment}
					className={`mt-0.5 shrink-0 ${
						hasComment || commenting
							? "text-primary"
							: "opacity-0 focus-visible:opacity-100 group-hover/step:opacity-100"
					}`}
				>
					<span className="icon-[solar--chat-round-line-linear] size-3" />
				</Button>
			</div>
			{(commenting || hasComment) && (
				<Textarea
					// biome-ignore lint/a11y/noAutofocus: 点开评论即开始输入；已有意见的步骤不抢焦点
					autoFocus={commenting && !hasComment}
					aria-label={commentLabel}
					value={comment}
					disabled={disabled}
					onChange={(event) => onCommentChange(event.target.value)}
					placeholder={commentPlaceholder}
					className="mb-1 max-h-24 min-h-8 resize-none py-1 text-[12px]"
				/>
			)}
		</li>
	);
}
