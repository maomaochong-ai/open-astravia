import { modelCatalog } from "@shared/store/model-catalog";
import { resolveReasoning } from "@shared/components/ModelSelect/resolveReasoning";
import { type ModelOption, useModelOptions } from "@shared/components/ModelSelect/useModelOptions";
import {
	ModelSelectorView,
	type ModelSelectorLabels,
	type ModelSelectorOptionView,
} from "@vetta-org/theme-ui/chat";
import { fmtMultiplier } from "@vetta-org/theme-ui/shared";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";

export interface TeamMemberModelSelectorProps {
	readonly value: string | null;
	readonly reasoning?: string;
	readonly disabled?: boolean;
	readonly placeholder: string;
	readonly emptyLabel: string;
	readonly ariaLabel: string;
	readonly onChange: (value: string | null) => void;
	readonly onReasoningChange: (reasoning: string) => void;
}

/**
 * 团队成员模型的受控连接层。
 *
 * 成员模型允许空值（跟随会话），所以不能直接复用会话域里会自动补默认值、并写入
 * 全局最近模型的 ModelSelector；这里只把相同目录适配到共享的 ModelSelectorView。
 */
export function TeamMemberModelSelector({
	value,
	reasoning,
	disabled = false,
	placeholder,
	emptyLabel,
	ariaLabel,
	onChange,
	onReasoningChange,
}: TeamMemberModelSelectorProps): JSX.Element {
	const { t } = useTranslation("common");
	const { options, grouped, defaultKey, iconFor, labelFor } = useModelOptions();
	const catalogOption = options.find((option) => option.key === value) ?? null;
	const selectedOption = catalogOption ?? (value ? fallbackOptionFromKey(value) : null);
	const resolved = resolveReasoning(catalogOption);
	const menuLevels = reasoningLevels(resolved?.levels);
	const currentLevel = resolved
		? reasoning && isValidReasoning(reasoning, resolved.levels)
			? reasoning
			: resolved.default
		: undefined;

	const labels: ModelSelectorLabels = {
		clearSearch: t("modelSelect.clearSearch"),
		cloudOnly: t("modelSelect.cloudOnly"),
		defaultBadge: t("modelSelect.defaultBadge"),
		levelLabel: (level) => t(`modelSelect.reasoningLevel.${level}`, { defaultValue: level }),
		modelHeader: t("modelSelect.modelHeader"),
		multiplierLabel: (option: ModelSelectorOptionView) => {
			const multiplier = options.find((candidate) => candidate.key === option.key)?.multiplier;
			if (!multiplier) return undefined;
			return multiplier.input === 0 && multiplier.output === 0
				? t("modelSelect.free")
				: t("modelSelect.multiplier", { value: fmtMultiplier(multiplier.input) });
		},
		noResults: t("modelSelect.noResults"),
		noResultsHint: t("modelSelect.noResultsHint"),
		placeholder,
		reasoningHeader: t("modelSelect.reasoningHeader"),
		searchPlaceholder: t("modelSelect.searchPlaceholder"),
		visionBadge: t("modelSelect.visionBadge"),
	};

	return (
		<ModelSelectorView
			ariaLabel={ariaLabel}
			disabled={disabled}
			selectedModel={value ?? undefined}
			selectedOption={selectedOption}
			currentLevel={currentLevel}
			menuLevels={menuLevels}
			groups={[...grouped.entries()].map(([provider, models]) => ({
				provider,
				label: labelFor(provider),
				icon: iconFor(provider),
				models,
			}))}
			defaultKey={defaultKey}
			labels={labels}
			emptyOption={{ label: emptyLabel, onSelect: () => onChange(null) }}
			className="w-full max-w-none justify-between rounded-md border border-input bg-transparent px-2 py-1 text-[12px] hover:border-border/60 hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:border-primary/30 data-[state=open]:bg-primary/10 data-[state=open]:text-primary"
			onModelSelect={onChange}
			onReasoningSelect={onReasoningChange}
			onOpenChange={(open) => {
				if (open) void modelCatalog.revalidate();
			}}
		/>
	);
}

function fallbackOptionFromKey(key: string): ModelOption {
	const slash = key.indexOf("/");
	return {
		key,
		provider: slash > 0 ? key.slice(0, slash) : key,
		modelId: slash > 0 ? key.slice(slash + 1) : key,
		displayName: key,
	};
}

function reasoningLevels(levels: readonly string[] | undefined): string[] {
	if (!levels?.length) return [];
	if (levels.includes("none")) return ["none", ...levels.filter((level) => level !== "none" && level !== "off")];
	return ["off", ...levels.filter((level) => level !== "off")];
}

function isValidReasoning(value: string, levels: readonly string[]): boolean {
	return value === "off" || value === "none" || levels.includes(value);
}
