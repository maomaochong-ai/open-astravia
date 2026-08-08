import { useRef, type JSX, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button, cn } from "@vetta/ui";
import { InputField } from "./SettingsFormFields";
import { shouldCloseEmptyApiKeyEditor } from "./shouldCloseEmptyApiKeyEditor";

/**
 * 右侧切换体感慢的主因是 AnimatePresence mode="wait" 串行：
 * exit + enter 叠时长；exit 若落到 motion 默认 tween（0.3s）再加 enter ≈ 400ms+。
 * 策略：旧内容瞬时卸掉（duration 0），新内容 100ms 仅 opacity 渐现；总感知 ≈ 100ms。
 */
const FADE_IN = { duration: 0.1, ease: "easeOut" as const };
const FADE_OUT = { duration: 0 };

export interface PresetProviderRowModelView {
	readonly displayName: string;
	readonly icon?: string;
	readonly isExpanded: boolean;
	readonly isOpen: boolean;
	readonly adopted: boolean;
	readonly offline: boolean;
	readonly models: readonly unknown[];
	readonly refreshing: boolean;
	readonly hasApiKey: boolean;
	readonly modelsError: string | null;
}

export interface PresetProviderRowViewLabels {
	readonly collapseModels: string;
	readonly viewModels: string;
	readonly enabled: string;
	readonly deprecated: string;
	readonly modelsCount: (count: number) => string;
	readonly collapse: string;
	readonly cancel: string;
	readonly changeKey: string;
	readonly remove: string;
	readonly enable: string;
	readonly apiKeyDirect: (name: string) => string;
	readonly apiKeyPlaceholder: string;
	readonly encryptedApiKeyPlaceholder: string;
	readonly save: string;
	readonly refreshModels: string;
	readonly refreshingModels: string;
	readonly copyApiKey: string;
}

export interface PresetProviderRowViewProps {
	readonly row: PresetProviderRowModelView;
	readonly draftKey: string;
	readonly saving: boolean;
	readonly labels: PresetProviderRowViewLabels;
	readonly onToggleExpanded: () => void;
	readonly onToggleEditor: () => void;
	readonly onDraftKeyChange: (key: string) => void;
	readonly onAdopt: () => void;
	readonly onRemove: () => void;
	readonly onRefreshModels: () => void;
	readonly onCopyApiKey: () => void;
	readonly icon: ReactNode;
	readonly modelsList?: ReactNode;
}

export function PresetProviderRowView({
	row,
	draftKey,
	saving,
	labels,
	onToggleExpanded,
	onToggleEditor,
	onDraftKeyChange,
	onAdopt,
	onRemove,
	onRefreshModels,
	onCopyApiKey,
	icon,
	modelsList,
}: PresetProviderRowViewProps): JSX.Element {
	// 已下线的旧条目不在内置目录里,给不了 key 也拉不到模型。
	const canEditKey = !row.offline;
	const editing = canEditKey && row.isOpen;
	const editorRef = useRef<HTMLDivElement>(null);
	// blur 后 microtask 再读,避免闭包拿到过期 draft/saving。
	const draftKeyRef = useRef(draftKey);
	const savingRef = useRef(saving);
	draftKeyRef.current = draftKey;
	savingRef.current = saving;

	const tryAdopt = (): void => {
		if (draftKey.trim() && !saving) onAdopt();
	};

	/**
	 * 空内容失焦收起。relatedTarget 在点按钮时经常为 null，
	 * 因此推迟到 microtask 再用 activeElement 做 contains 判定。
	 */
	const handleEditorBlur = (relatedTarget: EventTarget | null): void => {
		queueMicrotask(() => {
			if (
				!shouldCloseEmptyApiKeyEditor({
					draftKey: draftKeyRef.current,
					saving: savingRef.current,
					editorRoot: editorRef.current,
					relatedTarget: relatedTarget instanceof Object ? relatedTarget : null,
					activeElement: document.activeElement,
				})
			) {
				return;
			}
			onToggleEditor();
		});
	};

	return (
		<div className="border-b border-border last:border-b-0">
			{/* 固定行高 + 稳定左右栅格；右侧只做内容替换，不动画宽度。 */}
			<div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 py-3">
				<button
					type="button"
					onClick={onToggleExpanded}
					className="flex min-w-0 items-center gap-3 text-left"
					title={row.isExpanded ? labels.collapseModels : labels.viewModels}
				>
					<span
						className={cn(
							"icon-[mdi--chevron-right] h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150",
							row.isExpanded && "rotate-90",
						)}
					/>
					{icon}
					<div className="min-w-0 flex-1">
						<div className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-foreground">
							<span className="truncate">{row.displayName}</span>
							{row.adopted && (
								<span className="shrink-0 whitespace-nowrap rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-medium text-primary">
									{labels.enabled}
								</span>
							)}
							{row.offline && (
								<span className="shrink-0 whitespace-nowrap rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium text-amber-400">
									{labels.deprecated}
								</span>
							)}
						</div>
						{/* 只保留模型数；编辑态也保持可见。 */}
						<div className="mt-0.5 truncate text-[11px] text-muted-foreground">
							{labels.modelsCount(row.models.length)}
						</div>
					</div>
				</button>

				{/* 宽度瞬时切换；mode=wait 防双内容叠宽，但 exit 时长必须为 0。 */}
				<div
					className={cn(
						"flex h-8 items-center justify-end",
						editing ? "w-[18.5rem]" : "w-auto",
					)}
				>
					<AnimatePresence mode="wait" initial={false}>
						{editing ? (
							<motion.div
								key="api-key-editor"
								ref={editorRef}
								className="flex min-w-0 w-full items-center gap-1.5"
								initial={{ opacity: 0 }}
								animate={{ opacity: 1, transition: FADE_IN }}
								exit={{ opacity: 0, transition: FADE_OUT }}
							>
								<div className="min-w-0 flex-1">
									<InputField
										value={draftKey}
										onChange={onDraftKeyChange}
										placeholder={
											row.hasApiKey ? labels.encryptedApiKeyPlaceholder : labels.apiKeyPlaceholder
										}
										type="password"
										disabled={saving}
										autoFocus
										aria-label={labels.apiKeyDirect(row.displayName)}
										className="h-8 rounded-md px-2 text-[12px]"
										onBlur={(event) => handleEditorBlur(event.relatedTarget)}
										onKeyDown={(event) => {
											if (event.key === "Enter") {
												event.preventDefault();
												tryAdopt();
												return;
											}
											if (event.key === "Escape") {
												event.preventDefault();
												if (!saving) onToggleEditor();
											}
										}}
									/>
								</div>
								{row.hasApiKey && (
									<Button
										variant="ghost"
										size="icon-sm"
										onClick={onCopyApiKey}
										title={labels.copyApiKey}
										aria-label={labels.copyApiKey}
										className="shrink-0 text-muted-foreground hover:text-foreground"
									>
										<span className="icon-[mdi--content-copy] h-3.5 w-3.5" />
									</Button>
								)}
								<Button
									variant="primary"
									size="sm"
									onClick={tryAdopt}
									disabled={!draftKey.trim() || saving}
									className="h-8 shrink-0 px-2.5 text-[12px]"
								>
									{row.adopted ? labels.save : labels.enable}
								</Button>
								<Button
									variant="ghost"
									size="icon-sm"
									onClick={onToggleEditor}
									disabled={saving}
									title={labels.cancel}
									aria-label={labels.cancel}
									className="shrink-0 text-muted-foreground hover:text-foreground"
								>
									<span className="icon-[mdi--close] h-3.5 w-3.5" />
								</Button>
							</motion.div>
						) : (
							<motion.div
								key="api-key-actions"
								className="flex items-center gap-1.5"
								initial={{ opacity: 0 }}
								animate={{ opacity: 1, transition: FADE_IN }}
								exit={{ opacity: 0, transition: FADE_OUT }}
							>
								{row.adopted && !row.offline && (
									<Button
										variant="ghost"
										size="icon-sm"
										onClick={onRefreshModels}
										disabled={row.refreshing}
										title={row.refreshing ? labels.refreshingModels : labels.refreshModels}
										className="text-muted-foreground hover:text-foreground"
									>
										<span
											className={cn(
												"icon-[mdi--refresh] h-3.5 w-3.5",
												row.refreshing && "animate-spin",
											)}
										/>
									</Button>
								)}
								{canEditKey && (
									<Button
										variant="ghost"
										size="icon-sm"
										onClick={onToggleEditor}
										title={row.adopted ? labels.changeKey : labels.enable}
										aria-label={row.adopted ? labels.changeKey : labels.enable}
										className={cn(
											"text-muted-foreground hover:text-foreground",
											!row.adopted && "hover:text-primary",
										)}
									>
										<span
											className={cn(
												"h-3.5 w-3.5",
												row.adopted ? "icon-[mdi--key-outline]" : "icon-[mdi--key-plus]",
											)}
										/>
									</Button>
								)}
								{row.adopted && (
									<Button
										variant="ghost"
										size="icon-sm"
										onClick={onRemove}
										title={labels.remove}
										aria-label={labels.remove}
										className="text-muted-foreground hover:text-destructive"
									>
										<span className="icon-[mdi--delete-outline] h-3.5 w-3.5" />
									</Button>
								)}
								{row.offline && !row.adopted && (
									<span className="text-[11px] text-muted-foreground">{labels.deprecated}</span>
								)}
							</motion.div>
						)}
					</AnimatePresence>
				</div>
			</div>

			{/* 错误行独立展示,编辑态也能看到校验失败原因。 */}
			{row.modelsError && (
				<div className="truncate px-5 pb-2.5 text-[11px] text-amber-400">{row.modelsError}</div>
			)}

			{row.isExpanded && modelsList}
		</div>
	);
}
