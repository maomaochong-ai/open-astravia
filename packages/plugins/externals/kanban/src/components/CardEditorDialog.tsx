import { useTranslation } from "@vetta-org/plugin-sdk";
import {
	Button,
	cn,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@vetta/ui";
import { useEffect, useRef, useState, type JSX } from "react";
import { ModelPicker } from "./ModelPicker";
import { ProjectPicker } from "./ProjectPicker";
import { PromptTextarea, type PromptTextareaHandle } from "./PromptTextarea";
import type { KanbanModelOption, KanbanSkillOption } from "../board/board-controller";
import type { KanbanCard } from "../board/types";

export interface CardDraft {
	title: string;
	detail: string;
	cwd: string;
	/** 空串 = 用看板默认模型。 */
	modelKey: string;
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
	projects: Array<{ path: string; name?: string }>;
	models: KanbanModelOption[];
	/** 看板默认模型，用于在「默认」项上标注它实际是谁。 */
	defaultModelKey: string;
	/** 正文里可 `@` 提及的技能。 */
	skills: KanbanSkillOption[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (draft: CardDraft) => void;
}

const inputClass =
	"w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none transition-colors focus:border-primary/60";

const fieldLabelClass = "text-[11px] font-medium text-muted-foreground";

const PRIORITY_META: Record<0 | 1 | 2, { key: "low" | "medium" | "high"; icon: string; active: string }> = {
	0: { key: "low", icon: "icon-[solar--flag-linear]", active: "bg-muted text-foreground" },
	1: { key: "medium", icon: "icon-[solar--flag-bold]", active: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
	2: { key: "high", icon: "icon-[solar--flag-bold]", active: "bg-red-500/15 text-red-600 dark:text-red-400" },
};

function toDraft(card: KanbanCard | null): CardDraft {
	return {
		title: card?.title ?? "",
		detail: card?.detail ?? "",
		cwd: card?.cwd ?? "",
		modelKey: card?.modelKey ?? "",
		priority: card?.priority ?? 0,
		tags: card?.tags ?? [],
		dependsOn: card?.dependsOn ?? [],
	};
}

/** 新建 / 编辑卡片。灵感池的价值就在于「可以不断完善」，所以正文给足空间。 */
export function CardEditorDialog({
	card,
	defaultCwd,
	defaultModelKey,
	dependencyOptions,
	models,
	onOpenChange,
	onSubmit,
	open,
	projects,
	skills,
}: CardEditorDialogProps): JSX.Element {
	const { t } = useTranslation();
	const [draft, setDraft] = useState<CardDraft>(() => toDraft(card));
	const [tagText, setTagText] = useState("");
	const detailRef = useRef<PromptTextareaHandle | null>(null);
	const boardDefaultModel = models.find((model) => model.key === defaultModelKey) ?? null;

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
			<DialogContent data-vetta-plugin-root="kanban" className="max-w-xl">
				<DialogHeader>
					<DialogTitle>{t(card ? "editor.editTitle" : "editor.newTitle")}</DialogTitle>
					<DialogDescription>{t("editor.description")}</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-3.5">
					<label className="flex flex-col gap-1">
						<span className={fieldLabelClass}>{t("editor.title")}</span>
						<input
							className={cn(inputClass, "text-[14px] font-medium")}
							value={draft.title}
							autoFocus
							placeholder={t("editor.titlePlaceholder")}
							onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
							onKeyDown={(event) => {
								if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit();
							}}
						/>
					</label>

					<div className="flex flex-col gap-1">
						<div className="flex items-center justify-between">
							<span className={fieldLabelClass}>{t("editor.detail")}</span>
							{skills.length > 0 && (
								<button
									type="button"
									title={t("editor.insertSkillHint")}
									onClick={() => detailRef.current?.openSkillPicker()}
									className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
								>
									<span className="icon-[solar--stars-minimalistic-linear] h-3 w-3 text-primary" />
									{t("editor.insertSkill")}
								</button>
							)}
						</div>
						<PromptTextarea
							ref={detailRef}
							value={draft.detail}
							onChange={(detail) => setDraft((prev) => ({ ...prev, detail }))}
							skills={skills}
							placeholder={t("editor.detailPlaceholder")}
							className="rounded-lg border border-border bg-background transition-colors focus-within:border-primary/60"
							textareaClassName="min-h-[140px] resize-y"
						/>
						{skills.length > 0 && <p className="text-[10px] text-muted-foreground/60">{t("editor.detailSkillHint")}</p>}
					</div>

					<div className="grid grid-cols-2 gap-3">
						<div className="flex flex-col gap-1">
							<span className={fieldLabelClass}>{t("editor.priority")}</span>
							<div className="grid h-[34px] grid-cols-3 gap-0.5 rounded-lg border border-border bg-background p-0.5">
								{([0, 1, 2] as const).map((level) => {
									const meta = PRIORITY_META[level];
									const selected = draft.priority === level;
									return (
										<button
											key={level}
											type="button"
											aria-pressed={selected}
											onClick={() => setDraft((prev) => ({ ...prev, priority: level }))}
											className={cn(
												"flex items-center justify-center gap-1 rounded-md text-[11px] font-medium transition-colors",
												selected ? meta.active : "text-muted-foreground/70 hover:bg-accent/50 hover:text-foreground",
											)}
										>
											<span className={cn(meta.icon, "h-3 w-3")} />
											{t(`priority.${meta.key}`)}
										</button>
									);
								})}
							</div>
						</div>
						<label className="flex flex-col gap-1">
							<span className={fieldLabelClass}>{t("editor.tags")}</span>
							<input
								className={inputClass}
								value={tagText}
								placeholder={t("editor.tagsPlaceholder")}
								onChange={(event) => setTagText(event.target.value)}
							/>
						</label>
					</div>

					<div className="grid grid-cols-2 gap-3">
						<div className="flex flex-col gap-1">
							<span className={fieldLabelClass}>{t("editor.cwd")}</span>
							<ProjectPicker
								projects={projects}
								value={draft.cwd}
								defaultCwd={defaultCwd}
								allowCustomPath
								onChange={(cwd) => setDraft((prev) => ({ ...prev, cwd }))}
								triggerClassName="h-[34px] w-full rounded-lg border border-border bg-background px-2.5 text-[12px]"
							/>
						</div>
						{models.length > 0 && (
							<div className="flex flex-col gap-1">
								<span className={fieldLabelClass}>{t("editor.model")}</span>
								{/* 与会话页输入栏同一个选择器；这里选的是「这张卡」的模型 */}
								<ModelPicker
									models={models}
									value={draft.modelKey}
									onChange={(modelKey) => setDraft((prev) => ({ ...prev, modelKey }))}
									inheritLabel={
										boardDefaultModel
											? t("editor.modelDefaultNamed", { name: boardDefaultModel.displayName })
											: t("editor.modelDefault")
									}
									defaultKey={defaultModelKey || undefined}
									triggerClassName="h-[34px] w-full max-w-none justify-start rounded-lg border-border bg-background px-2.5 text-[12px]"
								/>
							</div>
						)}
					</div>

					{dependencyOptions.length > 0 && (
						<div className="flex flex-col gap-1">
							<span className={fieldLabelClass}>{t("editor.dependsOn")}</span>
							<p className="text-[10px] text-muted-foreground/70">{t("editor.dependsOnHint")}</p>
							<div className="max-h-28 overflow-y-auto rounded-lg border border-border/60 p-1">
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
