import { useTranslation } from "@vetta-org/plugin-sdk";
import { cn, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@vetta/ui";
import { useCallback, useMemo, useRef, useState, type JSX, type KeyboardEvent } from "react";
import type { KanbanModelOption } from "../board/board-controller";
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

function projectLabel(path: string, name?: string): string {
	if (name?.trim()) return name.trim();
	const segments = path.split("/").filter(Boolean);
	return segments[segments.length - 1] ?? path;
}

/**
 * 看板的发布器。**沿用宿主 AI 输入栏的设计语言**（同款胶囊卡片、focus 光晕、
 * 底部工具栏、⌘↵ 快捷发送），让「看板即对话入口」在形式上也成立——用户在这里
 * 获得和会话页输入框一致的肌肉记忆。
 *
 * 宿主输入栏本体是 Lexical 编辑器且深度绑定会话状态，无法跨 Module Federation
 * 复用；这里按同一套 token（bg-input-bar-bg / border-primary 光晕 / rounded-[20px]）
 * 复刻其形态，功能换成看板语义：首行是标题、其余是需求正文。
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
}: ComposerProps): JSX.Element {
	const { t } = useTranslation();
	const [text, setText] = useState("");
	const [cwd, setCwd] = useState("");
	const [priority, setPriority] = useState<0 | 1 | 2>(0);
	const [focused, setFocused] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);

	const effectiveCwd = cwd || defaultCwd;
	const hasText = text.trim().length > 0;
	const selectedModel = useMemo(() => models.find((model) => model.key === modelKey) ?? null, [models, modelKey]);
	const hostDefaultModel = useMemo(
		() => models.find((model) => model.key === hostDefaultModelKey) ?? null,
		[models, hostDefaultModelKey],
	);

	const autoGrow = useCallback(() => {
		const element = textareaRef.current;
		if (!element) return;
		element.style.height = "0px";
		element.style.height = `${Math.min(160, Math.max(44, element.scrollHeight))}px`;
	}, []);

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
			requestAnimationFrame(autoGrow);
		},
		[autoGrow, cwd, modelKey, onSubmit, priority, text],
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
						<textarea
							ref={textareaRef}
							value={text}
							rows={1}
							placeholder={t("composer.placeholder")}
							onChange={(event) => {
								setText(event.target.value);
								autoGrow();
							}}
							onFocus={() => setFocused(true)}
							onBlur={() => setFocused(false)}
							onKeyDown={handleKeyDown}
							className="block max-h-40 min-h-[44px] w-full resize-none bg-transparent px-4 pt-3 text-[13px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50"
						/>
						<div className="flex items-center gap-1 px-2.5 pb-2 pt-1">
							{/* 目标项目 */}
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<button
										type="button"
										title={t("composer.project")}
										className="flex h-6 max-w-40 items-center gap-1 rounded-full border border-border/60 px-2 text-[11px] text-muted-foreground transition-colors hover:border-border hover:text-foreground"
									>
										<span className="icon-[solar--folder-linear] h-3 w-3 shrink-0" />
										<span className="min-w-0 truncate">
											{effectiveCwd ? projectLabel(effectiveCwd, projects.find((p) => p.path === effectiveCwd)?.name) : t("composer.noProject")}
										</span>
										<span className="icon-[solar--alt-arrow-down-linear] h-2.5 w-2.5 shrink-0 opacity-60" />
									</button>
								</DropdownMenuTrigger>
								<DropdownMenuContent data-vetta-plugin-root="kanban" align="start" className="max-h-64 w-56 overflow-y-auto">
									{projects.map((project) => (
										<DropdownMenuItem
											key={project.path}
											onSelect={() => setCwd(project.path === defaultCwd ? "" : project.path)}
											className="flex items-center gap-2 text-[12px]"
										>
											<span
												className={cn(
													"icon-[solar--folder-linear] h-3.5 w-3.5 shrink-0",
													project.path === effectiveCwd ? "text-primary" : "text-muted-foreground",
												)}
											/>
											<span className="min-w-0 flex-1 truncate">{projectLabel(project.path, project.name)}</span>
											{project.path === effectiveCwd && (
												<span className="icon-[solar--check-read-linear] h-3.5 w-3.5 shrink-0 text-primary" />
											)}
										</DropdownMenuItem>
									))}
								</DropdownMenuContent>
							</DropdownMenu>

							{/* 执行模型：这里选的是「看板默认」，新卡片按当前值固化，单张卡可在编辑里改 */}
							{models.length > 0 && (
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<button
											type="button"
											title={t("composer.model")}
											className="flex h-6 max-w-44 items-center gap-1 rounded-full border border-border/60 px-2 text-[11px] text-muted-foreground transition-colors hover:border-border hover:text-foreground"
										>
											<span className="icon-[solar--cpu-bolt-linear] h-3 w-3 shrink-0" />
											<span className="min-w-0 truncate">
												{selectedModel?.displayName ?? hostDefaultModel?.displayName ?? t("composer.defaultModel")}
											</span>
											<span className="icon-[solar--alt-arrow-down-linear] h-2.5 w-2.5 shrink-0 opacity-60" />
										</button>
									</DropdownMenuTrigger>
									<DropdownMenuContent data-vetta-plugin-root="kanban" align="start" className="max-h-72 w-64 overflow-y-auto">
										<DropdownMenuItem onSelect={() => onModelKeyChange("")} className="flex items-center gap-2 text-[12px]">
											<span
												className={cn(
													"icon-[solar--star-linear] h-3.5 w-3.5 shrink-0",
													modelKey ? "text-muted-foreground" : "text-primary",
												)}
											/>
											<span className="min-w-0 flex-1 truncate">
												{hostDefaultModel ? t("composer.followHostModel", { name: hostDefaultModel.displayName }) : t("composer.defaultModel")}
											</span>
											{!modelKey && <span className="icon-[solar--check-read-linear] h-3.5 w-3.5 shrink-0 text-primary" />}
										</DropdownMenuItem>
										{models.map((model) => (
											<DropdownMenuItem
												key={model.key}
												onSelect={() => onModelKeyChange(model.key)}
												className="flex items-center gap-2 text-[12px]"
											>
												<span
													className={cn(
														"icon-[solar--cpu-bolt-linear] h-3.5 w-3.5 shrink-0",
														model.key === modelKey ? "text-primary" : "text-muted-foreground",
													)}
												/>
												<span className="min-w-0 flex-1 truncate">{model.displayName}</span>
												<span className="shrink-0 text-[10px] text-muted-foreground/60">{model.providerName}</span>
												{model.key === modelKey && (
													<span className="icon-[solar--check-read-linear] h-3.5 w-3.5 shrink-0 text-primary" />
												)}
											</DropdownMenuItem>
										))}
									</DropdownMenuContent>
								</DropdownMenu>
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
