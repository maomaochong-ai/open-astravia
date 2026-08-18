import type { OpenMarketplaceCatalog } from "@preload/api";

export interface AbilityMarketSourceState {
	attempted: boolean;
	usable: boolean;
}

/** 成功的空目录与带内容的旧缓存都可用；只有失败且无缓存的来源不可用。 */
export function getOpenMarketplaceLoadState(catalog: OpenMarketplaceCatalog): AbilityMarketSourceState {
	const enabledSourceIds = new Set(catalog.sources.filter((source) => source.enabled).map((source) => source.id));
	return {
		attempted: enabledSourceIds.size > 0,
		usable: catalog.snapshots.some(
			(snapshot) => enabledSourceIds.has(snapshot.sourceId) && (!snapshot.error || snapshot.abilities.length > 0),
		),
	};
}

/** 仅当至少尝试过一个市场来源，且所有已尝试来源都不可用时，列表才显示加载错误。 */
export function areAllAttemptedMarketSourcesUnavailable(states: AbilityMarketSourceState[]): boolean {
	const attempted = states.filter((state) => state.attempted);
	return attempted.length > 0 && attempted.every((state) => !state.usable);
}

/** 是否需要展示 loadFailed：本地失败，或已尝试的市场来源全部不可用。 */
export function shouldReportAbilityLoadFailure(input: {
	localFailed: boolean;
	server: AbilityMarketSourceState;
	open: AbilityMarketSourceState;
}): boolean {
	if (input.localFailed) return true;
	return areAllAttemptedMarketSourcesUnavailable([input.server, input.open]);
}
