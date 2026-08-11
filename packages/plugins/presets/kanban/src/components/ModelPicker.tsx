import { useTranslation } from "@vetta-org/plugin-sdk";
import {
	ModelSelectorView,
	type ModelSelectorOptionView,
	type ModelSelectorProviderGroup,
} from "@vetta/theme-ui/plugin-ui";
import { useMemo, type JSX } from "react";
import type { KanbanModelOption } from "../board/board-controller";

/**
 * 模型选择器。**直接用宿主输入栏的那一个**（`@vetta/theme-ui/plugin-ui` 经 Module
 * Federation 共享域拿到宿主运行时的同一份实例），所以搜索、provider 分组、图标、
 * 云端徽章的行为和会话页完全一致，宿主改了这里跟着改。
 *
 * 看板与宿主的差别只在语义层，都在这一层适配掉：
 * - 宿主选的是「当前会话的模型」，看板选的是「这张卡 / 这块板的模型」。
 * - 看板多一个「跟随默认」——用 {@link INHERIT_KEY} 作为哨兵混进列表首组，
 *   选中后回吐空串。视图本身不需要知道有这回事。
 * - 推理档位不接（看板不按轮次调档），故 `menuLevels` 恒为空。
 */

const INHERIT_KEY = "__kanban_inherit__";

export interface ModelPickerProps {
	models: KanbanModelOption[];
	/** 当前选择；空串 = 跟随默认。 */
	value: string;
	/** 空串 = 用户选了「跟随默认」。 */
	onChange: (modelKey: string) => void;
	/** 「跟随默认」这一项的文案（如「看板默认（Opus 5）」）。 */
	inheritLabel: string;
	/** 打上「默认」徽章的模型 key（看板默认或宿主默认）。 */
	defaultKey?: string;
	className?: string;
	triggerClassName?: string;
}

export function ModelPicker({
	className,
	defaultKey,
	inheritLabel,
	models,
	onChange,
	triggerClassName,
	value,
}: ModelPickerProps): JSX.Element {
	const { t } = useTranslation();

	const inheritOption = useMemo<ModelSelectorOptionView>(
		() => ({ key: INHERIT_KEY, provider: INHERIT_KEY, modelId: INHERIT_KEY, displayName: inheritLabel }),
		[inheritLabel],
	);

	const groups = useMemo<ModelSelectorProviderGroup[]>(() => {
		const byProvider = new Map<string, ModelSelectorProviderGroup>();
		for (const model of models) {
			const group = byProvider.get(model.providerId) ?? {
				provider: model.providerId,
				label: model.providerName,
				...(model.providerIcon ? { icon: model.providerIcon } : {}),
				models: [],
			};
			group.models = [
				...group.models,
				{
					key: model.key,
					provider: model.providerId,
					modelId: model.modelId,
					displayName: model.displayName,
				},
			];
			byProvider.set(model.providerId, group);
		}
		// 「跟随默认」单独成组钉在最前：它不属于任何 provider，混进某一组会被误读成那家的模型。
		return [
			{ provider: INHERIT_KEY, label: t("model.inheritGroup"), models: [inheritOption] },
			...byProvider.values(),
		];
	}, [inheritOption, models, t]);

	const selectedOption = useMemo<ModelSelectorOptionView>(() => {
		if (!value) return inheritOption;
		const found = models.find((model) => model.key === value);
		if (found) {
			return { key: found.key, provider: found.providerId, modelId: found.modelId, displayName: found.displayName };
		}
		// catalog 里没有（模型被删 / 未登录）时仍显示 key 的模型段，不要退回「跟随默认」误导用户。
		const modelId = value.slice(value.indexOf("/") + 1);
		return { key: value, provider: value.slice(0, Math.max(0, value.indexOf("/"))), modelId, displayName: modelId };
	}, [inheritOption, models, value]);

	return (
		<ModelSelectorView
			className={className}
			classNames={{ trigger: triggerClassName }}
			defaultKey={defaultKey}
			groups={groups}
			labels={{
				clearSearch: t("model.clearSearch"),
				cloudOnly: t("model.cloudOnly"),
				defaultBadge: t("model.defaultBadge"),
				levelLabel: (levelValue) => levelValue,
				modelHeader: t("model.modelHeader"),
				noResults: t("model.noResults"),
				noResultsHint: t("model.noResultsHint"),
				placeholder: inheritLabel,
				reasoningHeader: "",
				searchPlaceholder: t("model.searchPlaceholder"),
				visionBadge: t("model.visionBadge"),
			}}
			menuLevels={[]}
			onModelSelect={(key) => onChange(key === INHERIT_KEY ? "" : key)}
			onReasoningSelect={() => undefined}
			selectedModel={value || INHERIT_KEY}
			selectedOption={selectedOption}
		/>
	);
}
