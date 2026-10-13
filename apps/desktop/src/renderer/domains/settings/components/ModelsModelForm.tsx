import { getReasoningPreset } from "@vetta/ai/reasoning-presets";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@vetta-org/ui";
import { cn } from "@shared/lib/utils";
import { CheckboxField } from "./McpSettings";
import { InputField, SelectField } from "@vetta-org/theme-ui/settings";
import { CONTEXT_WINDOW_PICKS, MAX_OUTPUT_PICKS, NumberQuickPicks } from "./NumberQuickPicks";
import { moveReasoningLevel } from "./reasoning-levels";
import {
	buildModelApiOptions,
	CANDIDATE_REASONING_LEVELS,
	INPUT_OPTIONS,
	type ModelFormState,
} from "./useModelsSettingsModel";

/** 模型表单体：仅字段编辑，不含底部按钮——取消 / 保存由外层对话框统一渲染。 */
export function ModelsModelForm({
	form,
	setForm,
}: {
	form: ModelFormState;
	setForm: React.Dispatch<React.SetStateAction<ModelFormState>>;
}): JSX.Element {
	const { t } = useTranslation("settings");
	const inheritLabel = t("inheritedFromProvider");
	const apiOptions = useMemo(() => buildModelApiOptions(form.api, inheritLabel), [form.api, inheritLabel]);

	const toggleInput = (value: string) => {
		setForm((current) => {
			const has = current.input.includes(value);
			return { ...current, input: has ? current.input.filter((item) => item !== value) : [...current.input, value] };
		});
	};

	return (
		<div className="grid grid-cols-2 gap-3">
			<div>
				<label className="mb-1 block text-[11px] text-muted-foreground">{t("modelId")}</label>
				<InputField
					value={form.id}
					onChange={(value) => setForm((current) => ({ ...current, id: value }))}
					placeholder={t("modelIdPlaceholder")}
				/>
			</div>
			<div>
				<label className="mb-1 block text-[11px] text-muted-foreground">{t("displayName")}</label>
				<InputField
					value={form.name}
					onChange={(value) => setForm((current) => ({ ...current, name: value }))}
					placeholder={t("optional")}
				/>
			</div>
			<div>
				<label className="mb-1 block text-[11px] text-muted-foreground">{t("apiType")}</label>
				<SelectField
					value={form.api}
					onChange={(value) => setForm((current) => ({ ...current, api: value }))}
					options={apiOptions}
				/>
			</div>
			<div>
				<label className="mb-1 block text-[11px] text-muted-foreground">{t("inputCapability")}</label>
				<div className="flex h-8 items-center gap-3">
					{INPUT_OPTIONS.map((option) => (
						<label key={option.value} className="flex cursor-pointer select-none items-center gap-1.5">
							<button
								type="button"
								onClick={() => toggleInput(option.value)}
								className={cn(
									"flex h-4 w-4 items-center justify-center rounded border transition-colors",
									form.input.includes(option.value)
										? "border-primary bg-primary"
										: "border-input bg-secondary hover:bg-accent",
								)}
							>
								{form.input.includes(option.value) && (
									<span className="icon-[mdi--check] h-3 w-3 text-primary-foreground" />
								)}
							</button>
							<span className="text-[12px] text-foreground">{option.label}</span>
						</label>
					))}
				</div>
			</div>
			<div>
				<label className="mb-1 block text-[11px] text-muted-foreground">{t("contextWindow")}</label>
				<InputField
					value={form.contextWindow}
					onChange={(value) => setForm((current) => ({ ...current, contextWindow: value }))}
					placeholder={t("contextWindowPlaceholder")}
				/>
				<NumberQuickPicks
					picks={CONTEXT_WINDOW_PICKS}
					current={form.contextWindow}
					onPick={(value) => setForm((current) => ({ ...current, contextWindow: value }))}
				/>
			</div>
			<div>
				<label className="mb-1 block text-[11px] text-muted-foreground">{t("maxOutputTokens")}</label>
				<InputField
					value={form.maxTokens}
					onChange={(value) => setForm((current) => ({ ...current, maxTokens: value }))}
					placeholder={t("maxOutputTokensPlaceholder")}
				/>
				<NumberQuickPicks
					picks={MAX_OUTPUT_PICKS}
					current={form.maxTokens}
					onPick={(value) => setForm((current) => ({ ...current, maxTokens: value }))}
				/>
			</div>
			<div className="col-span-2">
				<CheckboxField
					checked={form.reasoning}
					onChange={(value) => setForm((current) => ({ ...current, reasoning: value }))}
					label={t("supportsReasoning")}
				/>
			</div>
			{form.reasoning && <ReasoningLevelsEditor form={form} setForm={setForm} />}
		</div>
	);
}

/** 拖拽载荷的自定义 MIME，避免与文件、会话等拖拽串台。 */
const REASONING_LEVEL_DRAG_MIME = "application/x-vetta-reasoning-level";

/** 插入指示线：不可见时也占一行高度，避免落点切换时列表跳动。 */
function DropLine({ visible }: { visible: boolean }): JSX.Element {
	return (
		<span
			aria-hidden="true"
			className={cn("mx-1 block h-px rounded-full", visible ? "bg-primary" : "bg-transparent")}
		/>
	);
}

/**
 * 推理档位编辑器。已添加的档位按声明顺序排列，可以拖拽调整先后——顺序就是客户端
 * 展示与「默认档位」候选的顺序，因此拖拽与编辑、删除一样直接改配置。
 */
function ReasoningLevelsEditor({
	form,
	setForm,
}: {
	form: ModelFormState;
	setForm: React.Dispatch<React.SetStateAction<ModelFormState>>;
}): JSX.Element {
	const { t } = useTranslation("settings");
	const levels = form.reasoningLevels;
	const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
	/** 拖拽落点：插到该下标之前；等于档位数表示插到末尾。 */
	const [dropIndex, setDropIndex] = useState<number | null>(null);

	const candidates = [
		...new Set([...(getReasoningPreset(form.api)?.levels ?? []), ...CANDIDATE_REASONING_LEVELS]),
	].filter((candidate) => !levels.includes(candidate));

	const endDrag = (): void => {
		setDraggingIndex(null);
		setDropIndex(null);
	};

	/** 落在行上半部插到它之前，下半部插到它之后。 */
	const resolveInsertBefore = (event: React.DragEvent<HTMLDivElement>, index: number): number => {
		const rect = event.currentTarget.getBoundingClientRect();
		return event.clientY - rect.top > rect.height / 2 ? index + 1 : index;
	};

	const commitDrop = (insertBefore: number): void => {
		const from = draggingIndex;
		endDrag();
		if (from === null) return;
		setForm((current) => ({
			...current,
			reasoningLevels: moveReasoningLevel(current.reasoningLevels, from, insertBefore),
		}));
	};

	return (
		<div className="col-span-2">
			<label className="mb-1 block text-[11px] text-muted-foreground">{t("reasoningLevels")}</label>
			<div className="space-y-1.5">
				{levels.length === 0 && (
					<p className="text-[11px] text-muted-foreground/70">{t("reasoningLevelsEmpty")}</p>
				)}
				{/* 档位列表容器：落在行之间的空白处即插到末尾。 */}
				<div
					onDragOver={(event) => {
						if (draggingIndex === null) return;
						event.preventDefault();
						event.dataTransfer.dropEffect = "move";
						setDropIndex(levels.length);
					}}
					onDrop={(event) => {
						if (draggingIndex === null) return;
						event.preventDefault();
						commitDrop(levels.length);
					}}
				>
					{levels.map((level, index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and drag-sortable
						<div key={index}>
							<DropLine visible={dropIndex === index} />
							<div
								className={cn("flex items-center gap-2", draggingIndex === index && "opacity-40")}
								onDragOver={(event) => {
									if (draggingIndex === null) return;
									event.preventDefault();
									event.stopPropagation();
									event.dataTransfer.dropEffect = "move";
									const insertBefore = resolveInsertBefore(event, index);
									setDropIndex((prev) => (prev === insertBefore ? prev : insertBefore));
								}}
								onDrop={(event) => {
									if (draggingIndex === null) return;
									event.preventDefault();
									event.stopPropagation();
									commitDrop(resolveInsertBefore(event, index));
								}}
							>
								<span
									aria-hidden="true"
									draggable
									title={t("reasoningDrag")}
									onDragStart={(event) => {
										event.dataTransfer.effectAllowed = "move";
										event.dataTransfer.setData(REASONING_LEVEL_DRAG_MIME, String(index));
										setDraggingIndex(index);
									}}
									onDragEnd={endDrag}
									className="icon-[solar--hamburger-menu-linear] h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground/40"
								/>
								<InputField
									value={level}
									onChange={(value) =>
										setForm((current) => {
											const next = [...current.reasoningLevels];
											const prev = next[index];
											next[index] = value;
											return {
												...current,
												reasoningLevels: next,
												defaultReasoningLevel:
													current.defaultReasoningLevel === prev ? value : current.defaultReasoningLevel,
											};
										})
									}
									placeholder={t("reasoningLevelPlaceholder")}
								/>
								<Button
									variant="outline"
									size="xs"
									disabled={!level.trim()}
									onClick={() => setForm((current) => ({ ...current, defaultReasoningLevel: level }))}
									className={
										form.defaultReasoningLevel === level && level.trim()
											? "border-primary/40 bg-primary/10 text-primary"
											: ""
									}
								>
									{t("reasoningDefault")}
								</Button>
								<Button
									variant="outline"
									size="xs"
									onClick={() =>
										setForm((current) => {
											const removed = current.reasoningLevels[index];
											const next = current.reasoningLevels.filter((_, itemIndex) => itemIndex !== index);
											return {
												...current,
												reasoningLevels: next,
												defaultReasoningLevel:
													current.defaultReasoningLevel === removed ? (next[0] ?? "") : current.defaultReasoningLevel,
											};
										})
									}
								>
									{t("reasoningRemove")}
								</Button>
							</div>
						</div>
					))}
					<DropLine visible={dropIndex === levels.length} />
				</div>
				<div className="flex gap-2">
					<Button
						variant="outline"
						size="xs"
						onClick={() => setForm((current) => ({ ...current, reasoningLevels: [...current.reasoningLevels, ""] }))}
					>
						{t("reasoningAdd")}
					</Button>
					{getReasoningPreset(form.api) && (
						<Button
							variant="outline"
							size="xs"
							onClick={() => {
								const preset = getReasoningPreset(form.api);
								if (preset) {
									setForm((current) => ({
										...current,
										reasoningLevels: [...preset.levels],
										defaultReasoningLevel: preset.default,
									}));
								}
							}}
						>
							{t("reasoningLoadPreset")}
						</Button>
					)}
				</div>
				{candidates.length > 0 && (
					<div className="flex flex-wrap items-center gap-1.5">
						<span className="text-[11px] text-muted-foreground">{t("reasoningCandidates")}</span>
						{candidates.map((candidate) => (
							<Button
								key={candidate}
								variant="outline"
								size="xs"
								onClick={() =>
									setForm((current) =>
										current.reasoningLevels.includes(candidate)
											? current
											: { ...current, reasoningLevels: [...current.reasoningLevels, candidate] },
									)
								}
							>
								+ {candidate}
							</Button>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
