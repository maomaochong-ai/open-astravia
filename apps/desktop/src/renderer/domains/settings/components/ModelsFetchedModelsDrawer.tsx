import { DetailDrawer } from "@vetta-org/theme-ui/overlays";
import { type FetchedModelRowView, ModelsFetchedModelsDrawerView } from "@vetta-org/theme-ui/settings";
import { useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { filterFetchedModels } from "./fetched-models";
import type { FetchedModelsState, ModelsSettingsModel } from "./useModelsSettingsModel";

/**
 * 服务商行「从接口拉取」对应的抽屉：与能力详情、智能体档案共用同一枚右侧滑出壳层。
 *
 * 候选模型与勾选状态都由 `useModelsSettingsModel` 持有，关闭时立即清空；这里留一份
 * 快照，让退出动画期间内容不闪空。
 */
export function ModelsFetchedModelsDrawer({ model }: { model: ModelsSettingsModel }): JSX.Element | null {
	const { t } = useTranslation("settings");
	const state = model.fetchedModels;
	const lastStateRef = useRef<FetchedModelsState | null>(null);
	if (state) lastStateRef.current = state;
	const visibleState = state ?? lastStateRef.current;

	const provider = visibleState ? model.config?.providers[visibleState.provider] : undefined;
	const displayName = provider?.displayName ?? visibleState?.provider ?? "";
	const subtitle = provider?.baseUrl ? `${displayName} · ${provider.baseUrl}` : displayName;

	const rows = useMemo<FetchedModelRowView[]>(() => {
		if (!visibleState) return [];
		const existing = new Set((provider?.models || []).map((item) => item.id));
		return filterFetchedModels(visibleState.models, visibleState.search).map((item) => ({
			id: item.id,
			name: item.name,
			ownedBy: item.ownedBy,
			contextWindow: item.contextWindow,
			maxTokens: item.maxTokens,
			vision: item.vision,
			reasoning: item.reasoning,
			reasoningLevels: item.reasoningLevels,
			selected: visibleState.selected.includes(item.id),
			alreadyAdded: existing.has(item.id),
			test: visibleState.tests[item.id],
		}));
	}, [provider, visibleState]);

	if (!visibleState) return null;

	const selectedCount = visibleState.selected.length;

	return (
		<DetailDrawer
			open={state !== null}
			title={t("fetchedModelsTitle")}
			description={subtitle}
			onClose={model.onCancelFetchedModels}
		>
			<ModelsFetchedModelsDrawerView
				labels={{
					title: t("fetchedModelsTitle"),
					subtitle,
					hint: visibleState.status === "ready" ? t("fetchedModelsHint", { n: visibleState.models.length }) : "",
					searchPlaceholder: t("searchFetchedModels"),
					clearSearch: t("clearModelSearch"),
					listLabel: t("fetchedModelsListLabel", { provider: displayName }),
					emptyList: t("noModels"),
					emptySearch: t("noMatchingModels"),
					selectAll: t("selectAllFetchedModels"),
					deselectAll: t("deselectAllFetchedModels"),
					selectedCount: t("fetchedModelsSelected", { n: selectedCount }),
					alreadyAdded: t("alreadyAdded"),
					vision: t("vision"),
					thinking: t("thinking"),
					testAction: t("testConnect"),
					testing: t("testing"),
					testOk: t("testOk"),
					testFail: t("testFailed"),
					apply: t("addSelectedModels", { n: selectedCount }),
					cancel: t("cancel"),
					retry: t("fetchAgain"),
					loading: t("fetching"),
				}}
				status={visibleState.status}
				error={visibleState.error}
				rows={rows}
				totalCount={visibleState.models.length}
				selectedCount={selectedCount}
				searchQuery={visibleState.search}
				saving={model.saving}
				onSearchQueryChange={model.onFetchedModelsSearchChange}
				onToggle={model.onToggleFetchedModel}
				onSelectAll={model.onSelectAllFetchedModels}
				onDeselectAll={model.onDeselectAllFetchedModels}
				onTest={model.onTestFetchedModel}
				onRetry={model.onRetryFetchProviderModels}
				onApply={() => void model.onApplyFetchedModels(visibleState.provider)}
				onClose={model.onCancelFetchedModels}
			/>
		</DetailDrawer>
	);
}
