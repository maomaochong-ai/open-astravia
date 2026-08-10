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
import type { KanbanCard } from "../board/types";

export interface CardDraft {
	title: string;
	detail: string;
	cwd: string;
	priority: 0 | 1 | 2;
	tags: string[];
	dependsOn: string[];
}

export interface CardEditorDialogProps {
	/** 可作为依赖被选中的卡片（不含正在编辑的这张）。 */
	dependencyOptions: KanbanCard[];
	/** null = 新建。 */
	card: KanbanCard | null;
	defaultCwd: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (draft: CardDraft) => void;
}

const inputClass =
	"w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none transition-colors focus:border-primary/60";

function toDraft(card: KanbanCard | null): CardDraft {
	return {
		title: card?.title ?? "",
		detail: card?.detail ?? "",
		cwd: card?.cwd ?? "",
		priority: card?.priority ?? 0,
		tags: card?.tags ?? [],
		dependsOn: card?.dependsOn ?? [],
	};
}

/** 新建 / 编辑卡片。灵感池的价值就在于「可以不断完善」，所以正文给足空间。 */
export function CardEditorDialog({
	card,
	defaultCwd,
	dependencyOptions,
	onOpenChange,
	onSubmit,
	open,
}: CardEditorDialogProps): JSX.Element {
	const { t } = useTranslation();
	const [draft, setDraft] = useState<CardDraft>(() => toDraft(card));
	const [tagText, setTagText] = useState("");

	useEffect(() => {
		if (!open) return;
		setDraft(toDraft(card));
		setTagText((card?.tags ?? []).join(", "));
	}, [card, open]);

	const submit = (): void => {
		const title = draft.title.trim();
		if (!title) return;
		onSubmit({
			...draft,
			title,
			tags: tagText
				.split(/[,，]/)
				.map((tag) => tag.trim())
				.filter(Boolean),
		});
		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent data-vetta-plugin-root="kanban" className="max-w-lg">
				<DialogHeader>
					<DialogTitle>{t(card ? "editor.editTitle" : "editor.newTitle")}</DialogTitle>
					<DialogDescription>{t("editor.description")}</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-3">
					<label className="flex flex-col gap-1">
						<span className="text-[11px] font-medium text-muted-foreground">{t("editor.title")}</span>
						<input
							className={inputClass}
							value={draft.title}
							autoFocus
							placeholder={t("editor.titlePlaceholder")}
							onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
							onKeyDown={(event) => {
								if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit();
							}}
						/>
					</label>

					<label className="flex flex-col gap-1">
						<span className="text-[11px] font-medium text-muted-foreground">{t("editor.detail")}</span>
						<textarea
							className={`${inputClass} min-h-[120px] resize-y leading-relaxed`}
							value={draft.detail}
							placeholder={t("editor.detailPlaceholder")}
							onChange={(event) => setDraft((prev) => ({ ...prev, detail: event.target.value }))}
						/>
					</label>

					<div className="grid grid-cols-2 gap-3">
						<label className="flex flex-col gap-1">
							<span className="text-[11px] font-medium text-muted-foreground">{t("editor.priority")}</span>
							<select
								className={inputClass}
								value={draft.priority}
								onChange={(event) =>
									setDraft((prev) => ({ ...prev, priority: Number(event.target.value) as 0 | 1 | 2 }))
								}
							>
								<option value={0}>{t("priority.low")}</option>
								<option value={1}>{t("priority.medium")}</option>
								<option value={2}>{t("priority.high")}</option>
							</select>
						</label>
						<label className="flex flex-col gap-1">
							<span className="text-[11px] font-medium text-muted-foreground">{t("editor.tags")}</span>
							<input
								className={inputClass}
								value={tagText}
								placeholder={t("editor.tagsPlaceholder")}
								onChange={(event) => setTagText(event.target.value)}
							/>
						</label>
					</div>

					<label className="flex flex-col gap-1">
						<span className="text-[11px] font-medium text-muted-foreground">{t("editor.cwd")}</span>
						<input
							className={inputClass}
							value={draft.cwd}
							placeholder={defaultCwd || t("editor.cwdPlaceholder")}
							onChange={(event) => setDraft((prev) => ({ ...prev, cwd: event.target.value }))}
						/>
					</label>

					{dependencyOptions.length > 0 && (
						<div className="flex flex-col gap-1">
							<span className="text-[11px] font-medium text-muted-foreground">{t("editor.dependsOn")}</span>
							<p className="text-[10px] text-muted-foreground/70">{t("editor.dependsOnHint")}</p>
							<div className="max-h-28 overflow-y-auto rounded-md border border-border/60 p-1">
								{dependencyOptions.map((option) => (
									<label
										key={option.id}
										className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[12px] hover:bg-accent/50"
									>
										<input
											type="checkbox"
											checked={draft.dependsOn.includes(option.id)}
											onChange={(event) =>
												setDraft((prev) => ({
													...prev,
													dependsOn: event.target.checked
														? [...prev.dependsOn, option.id]
														: prev.dependsOn.filter((id) => id !== option.id),
												}))
											}
										/>
										<span className="min-w-0 truncate">{option.title || t("card.untitled")}</span>
									</label>
								))}
							</div>
						</div>
					)}
				</div>

				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						{t("editor.cancel")}
					</Button>
					<Button onClick={submit} disabled={!draft.title.trim()}>
						{t("editor.save")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
