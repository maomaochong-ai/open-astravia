import { useTranslation } from "@vetta-org/plugin-sdk";
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@vetta/ui";
import { useEffect, useState, type JSX } from "react";
import { PromptTextarea } from "./PromptTextarea";
import type { KanbanSkillOption } from "../board/board-controller";
import type { KanbanCard } from "../board/types";

export interface FeedbackDialogProps {
	card: KanbanCard | null;
	/** 反馈里可 `@` 提及的技能（反馈同样作为 prompt 发进会话）。 */
	skills: KanbanSkillOption[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (feedback: string) => void;
}

/**
 * 打回重做的反馈框。反馈会发往**原会话**——agent 带着完整上下文修正，
 * 所以这里鼓励写「哪里不对、期望什么」，而不是重述整个需求。
 */
export function FeedbackDialog({ card, onOpenChange, onSubmit, open, skills }: FeedbackDialogProps): JSX.Element {
	const { t } = useTranslation();
	const [feedback, setFeedback] = useState("");

	useEffect(() => {
		if (open) setFeedback("");
	}, [open]);

	const submit = (): void => {
		const trimmed = feedback.trim();
		if (!trimmed) return;
		onSubmit(trimmed);
		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent data-vetta-plugin-root="kanban" className="max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<span className="icon-[solar--undo-left-round-linear] h-4 w-4 text-amber-500" />
						{t("feedback.title", { title: card?.title ?? "" })}
					</DialogTitle>
					<DialogDescription>{t("feedback.description")}</DialogDescription>
				</DialogHeader>
				{card?.deliveryNote && (
					<div className="rounded-lg border border-border/60 bg-muted/30 px-2.5 py-2">
						<p className="text-[10px] font-semibold text-muted-foreground">{t("card.deliveryNote")}</p>
						<p className="mt-0.5 line-clamp-4 text-[11px] leading-relaxed text-foreground/80">{card.deliveryNote}</p>
					</div>
				)}
				<PromptTextarea
					value={feedback}
					onChange={setFeedback}
					skills={skills}
					autoFocus
					placeholder={t("feedback.placeholder")}
					onKeyDown={(event) => {
						if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit();
					}}
					className="rounded-lg border border-border bg-background transition-colors focus-within:border-primary/60"
					textareaClassName="min-h-[96px] resize-y"
				/>
				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						{t("editor.cancel")}
					</Button>
					<Button onClick={submit} disabled={!feedback.trim()}>
						<span className="icon-[solar--undo-left-round-linear] h-3.5 w-3.5" />
						{t("feedback.submit")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
