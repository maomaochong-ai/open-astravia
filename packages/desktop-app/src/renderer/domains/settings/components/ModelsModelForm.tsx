import { getReasoningPreset } from "@vetta/ai/reasoning-presets";
import { useTranslation } from "react-i18next";
import { Button } from "@vetta/ui";
import { cn } from "@shared/lib/utils";
import { CheckboxField } from "./McpSettings";
import { InputField } from "@vetta/theme-ui/settings";
import { CONTEXT_WINDOW_PICKS, MAX_OUTPUT_PICKS, NumberQuickPicks } from "./NumberQuickPicks";
import {
	CANDIDATE_REASONING_LEVELS,
	INPUT_OPTIONS,
	type ModelFormState,
} from "./useModelsSettingsModel";

export function ModelsModelForm({
	form,
	setForm,
	onSave,
	onCancel,
	saving,
	saveLabel,
}: {
	form: ModelFormState;
	setForm: React.Dispatch<React.SetStateAction<ModelFormState>>;
	onSave: () => void;
	onCancel: () => void;
	saving: boolean;
	saveLabel: string;
}): JSX.Element {
	const { t } = useTranslation("settings");

	const toggleInput = (value: string) => {
		setForm((current) => {
			const has = current.input.includes(value);
			return { ...current, input: has ? current.input.filter((item) => item !== value) : [...current.input, value] };
		});
	};

	return (
		<>
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
					<InputField
						value={form.api}
						onChange={(value) => setForm((current) => ({ ...current, api: value }))}
						placeholder={t("inheritedFromProvider")}
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
			<div className="mt-3 flex justify-end gap-2">
				<Button variant="ghost" size="sm" onClick={onCancel}>
					{t("cancel")}
				</Button>
				<Button variant="primary" size="sm" onClick={onSave} disabled={!form.id.trim() || saving}>
					{saveLabel}
				</Button>
			</div>
		</>
	);
}

function ReasoningLevelsEditor({
	form,
	setForm,
}: {
	form: ModelFormState;
	setForm: React.Dispatch<React.SetStateAction<ModelFormState>>;
}): JSX.Element {
	const { t } = useTranslation("settings");
	const candidates = [
		...new Set([...(getReasoningPreset(form.api)?.levels ?? []), ...CANDIDATE_REASONING_LEVELS]),
	].filter((candidate) => !form.reasoningLevels.includes(candidate));

	return (
		<div className="col-span-2">
			<label className="mb-1 block text-[11px] text-muted-foreground">{t("reasoningLevels")}</label>
			<div className="space-y-1.5">
				{form.reasoningLevels.length === 0 && (
					<p className="text-[11px] text-muted-foreground/70">{t("reasoningLevelsEmpty")}</p>
				)}
				{form.reasoningLevels.map((level, index) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and editable
					<div key={index} className="flex items-center gap-2">
						<InputField
							value={level}
							onChange={(value) =>
								setForm((current) => {
									const levels = [...current.reasoningLevels];
									const prev = levels[index];
									levels[index] = value;
									return {
										...current,
										reasoningLevels: levels,
										defaultReasoningLevel:
											current.defaultReasoningLevel === prev ? value : current.defaultReasoningLevel,
									};
								})
							}
							placeholder="low / medium / high / max"
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
									const levels = current.reasoningLevels.filter((_, itemIndex) => itemIndex !== index);
									return {
										...current,
										reasoningLevels: levels,
										defaultReasoningLevel:
											current.defaultReasoningLevel === removed ? (levels[0] ?? "") : current.defaultReasoningLevel,
									};
								})
							}
						>
							{t("reasoningRemove")}
						</Button>
					</div>
				))}
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
