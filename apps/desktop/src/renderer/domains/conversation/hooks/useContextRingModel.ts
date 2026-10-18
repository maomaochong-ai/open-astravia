import { CIRCUMFERENCE as CONTEXT_RING_CIRCUMFERENCE } from "@astravia-org/theme-ui/chat/ContextRingView";
import { type ContextUsageData, contextUsageAtom, isCompactingAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { buildContextRingDetails, type ContextRingDetailsModel, formatTokens } from "../services/context-ring-details";

type Translate = (key: string, options?: Record<string, unknown>) => string;

export interface ContextRingModel {
	percent: number;
	offset: number;
	color: string;
	isCompacting: boolean;
	tooltip: string;
	details: ContextRingDetailsModel | null;
}

export interface ContextRingBinding {
	readonly usage: ContextUsageData | null;
	readonly isCompacting: boolean;
}

export interface ContextRingScopeBinding extends ContextRingBinding {
	readonly id: string;
	readonly label: string;
	readonly avatar?: string;
	readonly blueprintId?: string;
}

export interface ContextRingScopeModel {
	readonly id: string;
	readonly label: string;
	readonly avatar?: string;
	readonly blueprintId?: string;
	readonly model: ContextRingModel;
}

export function useDefaultContextRingModel(includeDetails = true): ContextRingModel | null {
	const usage = useAtomValue(contextUsageAtom);
	const isCompacting = useAtomValue(isCompactingAtom);
	return useContextRingModel({ usage, isCompacting }, includeDetails);
}

export function useContextRingModel(binding: ContextRingBinding, includeDetails = true): ContextRingModel | null {
	const { t } = useTranslation("chat");
	const translate = useCallback<Translate>(
		(key, options) =>
			String((t as unknown as (key: string, options?: Record<string, unknown>) => unknown)(key, options)),
		[t],
	);
	const { usage, isCompacting } = binding;
	const detailLabels = useMemo(
		() => (includeDetails ? contextRingDetailLabels(translate) : null),
		[includeDetails, translate],
	);
	const composition = usage?.composition;
	const details = useMemo(
		() => (detailLabels ? buildContextRingDetails(composition, detailLabels) : null),
		[composition, detailLabels],
	);
	return useMemo(
		() => buildContextRingModel({ usage, isCompacting }, translate, details),
		[details, isCompacting, translate, usage],
	);
}

export function useContextRingScopeModels(
	bindings: readonly ContextRingScopeBinding[],
	includeDetails = true,
): readonly ContextRingScopeModel[] {
	const { t } = useTranslation("chat");
	const translate = useCallback<Translate>(
		(key, options) =>
			String((t as unknown as (key: string, options?: Record<string, unknown>) => unknown)(key, options)),
		[t],
	);
	const detailLabels = useMemo(
		() => (includeDetails ? contextRingDetailLabels(translate) : null),
		[includeDetails, translate],
	);
	return useMemo(
		() =>
			bindings.flatMap((binding) => {
				const details = detailLabels ? buildContextRingDetails(binding.usage?.composition, detailLabels) : null;
				const model = buildContextRingModel(binding, translate, details);
				return model
					? [
							{
								id: binding.id,
								label: binding.label,
								avatar: binding.avatar,
								blueprintId: binding.blueprintId,
								model,
							},
						]
					: [];
			}),
		[bindings, detailLabels, translate],
	);
}

function contextRingDetailLabels(t: Translate) {
	return {
		unknown: t("contextRing.details.unknown"),
		owner: {
			core: t("contextRing.details.owner.core"),
			extension: t("contextRing.details.owner.extension"),
			runtime: t("contextRing.details.owner.runtime"),
			user: t("contextRing.details.owner.user"),
			unknown: t("contextRing.details.owner.unknown"),
		},
		kind: {
			instruction: t("contextRing.details.kind.instruction"),
			tool_schema: t("contextRing.details.kind.tool_schema"),
			history: t("contextRing.details.kind.history"),
			runtime_context: t("contextRing.details.kind.runtime_context"),
			user_input: t("contextRing.details.kind.user_input"),
		},
		group: {
			instructions: t("contextRing.details.group.instructions"),
			capabilities: t("contextRing.details.group.capabilities"),
			tools: t("contextRing.details.group.tools"),
			conversation: t("contextRing.details.group.conversation"),
			runtime: t("contextRing.details.group.runtime"),
		},
	} as const;
}

/** 纯函数，公开给测试：颜色/提示直接由用量与压缩阈值决定。 */
export function buildContextRingModel(
	binding: ContextRingBinding,
	t: Translate,
	details: ContextRingDetailsModel | null,
): ContextRingModel | null {
	const ctx = binding.usage;
	const isCompacting = binding.isCompacting;
	const composition = ctx?.composition;

	if (!ctx || !ctx.contextWindow) return null;

	const hasActualTokens = typeof ctx.contextTokens === "number" && Number.isFinite(ctx.contextTokens);
	const contextTokens = hasActualTokens
		? ctx.contextTokens!
		: (composition?.estimate.tokens ??
			composition?.estimate.knownTokens ??
			((ctx.percent ?? 0) * ctx.contextWindow) / 100);
	const percent = ctx.contextWindow > 0 ? (contextTokens / ctx.contextWindow) * 100 : (ctx.percent ?? 0);
	const clamped = Math.min(100, Math.max(0, percent));
	const offset = CONTEXT_RING_CIRCUMFERENCE - (clamped / 100) * CONTEXT_RING_CIRCUMFERENCE;

	// 红色必须代表「已经到了或过了自动压缩的触发线」，而不是一个写死的百分比：压缩策略的
	// 触发线是 max(窗口 - 预留, 窗口 × (1 - 最小空闲比例))，1M 窗口上就是 96.4%，而写死的 90%
	// 会让环先变红，然后久等不见压缩。拿不到阈值时才退回 90%。
	const thresholdPercent =
		ctx.compactionThresholdTokens !== undefined && ctx.contextWindow > 0
			? (ctx.compactionThresholdTokens / ctx.contextWindow) * 100
			: 90;
	const willCompact =
		ctx.compactionThresholdTokens !== undefined
			? contextTokens >= ctx.compactionThresholdTokens
			: percent > thresholdPercent;
	const color = isCompacting || willCompact ? "var(--destructive)" : "var(--primary)";

	const tooltip = isCompacting
		? t("contextRing.tooltip.compacting")
		: hasActualTokens || ctx.percent !== null
			? t(
					ctx.compactionThresholdTokens === undefined
						? "contextRing.tooltip.usage"
						: "contextRing.tooltip.usageWithThreshold",
					{
						percent: percent.toFixed(1),
						window: formatTokens(ctx.contextWindow),
						tokens: formatTokens(contextTokens),
						threshold: thresholdPercent.toFixed(0),
					},
				)
			: t("contextRing.tooltip.unknown", { window: formatTokens(ctx.contextWindow) });

	return {
		percent,
		offset,
		color,
		isCompacting,
		tooltip,
		details,
	};
}
