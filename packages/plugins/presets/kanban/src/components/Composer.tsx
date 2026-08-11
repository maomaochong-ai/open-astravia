import { useTranslation } from "@vetta-org/plugin-sdk";
import { cn } from "@vetta/ui";
import { ModelPicker } from "./ModelPicker";
import { ProjectPicker } from "./ProjectPicker";
import { PromptTextarea, type PromptTextareaHandle } from "./PromptTextarea";
import { useCallback, useMemo, useRef, useState, type JSX, type KeyboardEvent } from "react";
import type { KanbanModelOption, KanbanSkillOption } from "../board/board-controller";
import type { KanbanIdeaState } from "../board/types";

export interface ComposerSubmitPayload {
	title: string;
	detail: string;
	cwd: string;
	/** 空串 = 不指定，派单时跟随宿主全局默认模型。 */
	modelKey: string;
	priority: 0 | 1 | 2;
	ideaState: KanbanIdeaState;
	/** true = 入池后立即派发（⌘↵）。 */
	dispatchNow: boolean;
}

export interface ComposerProps {
	defaultCwd: string;
	projects: Array<{ path: string; name?: string }>;
	models: KanbanModelOption[];
	/** 正文里可 `@` 提及的技能。 */
	skills: KanbanSkillOption[];
	/** 当前看板默认模型；发布器里的选择即写这个值（见 {@link ComposerProps.onModelKeyChange}）。 */
	modelKey: string;
	/** 宿主全局默认模型，仅用于在「跟随默认」项上标注它到底是谁。 */
	hostDefaultModelKey: string;
	onModelKeyChange: (modelKey: string) => void;
	/** 派发直达是否可用（无名额时禁用 ⌘↵ 直达，Enter 入池不受限）。 */
	canDispatchNow: boolean;
	onSubmit: (payload: ComposerSubmitPayload) => void;
}

const PRIORITY_META: Record<0 | 1 | 2, { icon: string; className: string }> = {
	0: { icon: "icon-[solar--flag-linear]", className: "text-muted-foreground" },
	1: { icon: "icon-[solar--flag-bold]", className: "text-amber-500" },
	2: { icon: "icon-[solar--flag-bold]", className: "text-red-500" },
};

/**
 * 看板的发布器。**沿用宿主 AI 输入栏的设计语言**（同款胶囊卡片、focus 光晕、
 * 底部工具栏、⌘↵ 快捷发送），让「看板即对话入口」在形式上也成立——用户在这里
 * 获得和会话页输入框一致的肌肉记忆。
 *
 * 宿主输入栏本体是 Lexical 编辑器且深度绑定会话状态，无法跨 Module Federation
 * 复用；这里按同一套 token（bg-input-bar-bg / border-primary 光晕 / rounded-[20px]）
 * 复刻其形态，功能换成看板语义：首行是标题、其余是需求正文，正文里可以 `@` 技能。
 *
 * 交互模型刻意保持两档：
 * - Enter        → 记入灵感池（默认草稿，鼓励先记下来再打磨）
 * - ⌘↵ / Ctrl+↵ → 标为待认领并**立即派发**（跳过打磨，直接开工）
 */
export function Composer({
	canDispatchNow,
	defaultCwd,
	hostDefaultModelKey,
	modelKey,
	models,
	onModelKeyChange,
	onSubmit,
	projects,
	skills,
}: ComposerProps): JSX.Element {
	const { t } = useTranslation();
	const [text, setText] = useState("");
	const [cwd, setCwd] = useState("");
	const [priority, setPriority] = useState<0 | 1 | 2>(0);
	const [focused, setFocused] = useState(false);
	const textareaRef = useRef<PromptTextareaHandle | null>(null);

	const hasText = text.trim().length > 0;
	const hostDefaultModel = useMemo(
		() => models.find((model) => model.key === hostDefaultModelKey) ?? null,
		[models, hostDefaultModelKey],
	);

	const submit = useCallback(
		(dispatchNow: boolean) => {
			const lines = text.split("\n");
			const title = lines[0]?.trim() ?? "";
			if (!title) return;
			const detail = lines.slice(1).join("\n").trim();
			onSubmit({
				title,
				detail,
				cwd,
				// 固化当前选择而不是留空跟随：之后改看板默认模型，不该回头改写已有卡片。
				modelKey,
				priority,
				ideaState: dispatchNow ? "ready" : "draft",
				dispatchNow,
			});
			setText("");
			setPriority(0);
		},
		[cwd, modelKey, onSubmit, priority, text],
	);

	const handleKeyDown = useCallback(
		(event: KeyboardEvent<HTMLTextAreaElement>) => {
			if (event.key !== "Enter") return;
			if (event.metaKey || event.ctrlKey) {
				event.preventDefault();
				if (canDispatchNow) submit(true);
				return;
			}
			if (!event.shiftKey) {
				event.preventDefault();
				submit(false);
			}
			// Shift+Enter = 换行（写需求正文）
		},
		[canDispatchNow, submit],
	);

	const priorityMeta = PRIORITY_META[priority];

	return (
		<div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 px-4 pb-4">
			<div className="pointer-events-auto mx-auto w-full max-w-2xl">
				<div
					className={cn(
						// 复刻宿主 input-card：浅色用大扩散低透明外投影托起，深色靠底色层级差
						"relative overflow-visible rounded-[20px] border bg-input-bar-bg",
						"shadow-[0_8px_28px_-14px_rgb(0_0_0/0.18)] transition-[border-color,box-shadow] duration-200 dark:shadow-[0_12px_40px_-16px_rgb(0_0_0/0.55)]",
						focused ? "border-primary/25" : "border-border",
					)}
				>
					<div className="relative z-10 rounded-[inherit]">
						<PromptTextarea
							ref={textareaRef}
							value={text}
							onChange={setText}
							skills={skills}
							placeholder={t("composer.placeholder")}
							paddingClassName="px-4 pt-3"
							autoGrow={{ min: 44, max: 160 }}
							onKeyDown={handleKeyDown}
							onFocus={() => setFocused(true)}
							onBlur={() => setFocused(false)}
						/>
						<div className="flex items-center gap-1 px-2.5 pb-2 pt-1">
							{/* 目标项目 */}
							<ProjectPicker
								projects={projects}
								value={cwd}
								defaultCwd={defaultCwd}
								onChange={setCwd}
								triggerClassName="h-6 max-w-40 rounded-full border border-border/60 px-2 text-[11px] hover:border-border"
							/>

							{/*
							  * 执行模型：与会话页输入栏是**同一个组件**（宿主 theme-ui 共享域）。
							  * 这里选的是「看板默认」，新卡片按当前值固化，单张卡可在编辑弹窗里改。
							  */}
							{models.length > 0 && (
								<ModelPicker
									models={models}
									value={modelKey}
									onChange={onModelKeyChange}
									inheritLabel={
										hostDefaultModel
											? t("composer.followHostModel", { name: hostDefaultModel.displayName })
											: t("composer.defaultModel")
									}
									defaultKey={hostDefaultModelKey || undefined}
									triggerClassName="h-6 max-w-44 rounded-full border-border/60 px-2 text-muted-foreground hover:border-border hover:text-foreground"
								/>
							)}

							{/* 优先级：点按循环 低→中→高 */}
							<button
								type="button"
								title={t("composer.priority")}
								onClick={() => setPriority((prev) => ((prev + 1) % 3) as 0 | 1 | 2)}
								className="flex h-6 w-6 items-center justify-center rounded-full transition-colors hover:bg-accent/60"
							>
								<span className={cn(priorityMeta.icon, "h-3.5 w-3.5", priorityMeta.className)} />
							</button>

							{/* 技能：插入 @skill token，正文里直接敲 @ 也可以 */}
							{skills.length > 0 && (
								<button
									type="button"
									title={t("composer.insertSkill")}
									onClick={() => textareaRef.current?.openSkillPicker()}
									className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
								>
									<span className="icon-[solar--stars-minimalistic-linear] h-3.5 w-3.5" />
								</button>
							)}

							<div className="min-w-0 flex-1" />

							{/* 快捷键提示 + 双档发送 */}
							<span className="hidden shrink-0 text-[10px] text-muted-foreground/45 sm:block">
								{t("composer.hint")}
							</span>
							<button
								type="button"
								disabled={!hasText || !canDispatchNow}
								title={canDispatchNow ? t("composer.dispatchNow") : t("dispatch.refuse.wipFull")}
								onClick={() => submit(true)}
								className={cn(
									"flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium transition-all",
									hasText && canDispatchNow
										? "border-primary/30 text-primary hover:bg-primary/10"
										: "cursor-not-allowed border-border/50 text-muted-foreground/40",
								)}
							>
								<span className="icon-[solar--rocket-2-linear] h-3.5 w-3.5" />
								{t("composer.dispatchNow")}
							</button>
							<button
								type="button"
								disabled={!hasText}
								title={t("composer.capture")}
								onClick={() => submit(false)}
								className={cn(
									"flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all",
									hasText
										? "bg-primary text-primary-foreground shadow-sm hover:opacity-90"
										: "cursor-not-allowed bg-muted text-muted-foreground/40",
								)}
							>
								<span className="icon-[solar--arrow-up-linear] h-4 w-4" />
							</button>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
