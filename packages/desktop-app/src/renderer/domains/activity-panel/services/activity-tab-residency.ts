import type { ActivityTabKey } from "@shared/lib/project-profile";
import type { ActivityTabId, ActivityTabRetention, ResolvedActivityTab } from "../registry/types";

export const DEFAULT_INACTIVE_WARM_TAB_LIMIT = 2;

export interface ActivityTabResidencyState {
	/** A scope change invalidates every retained component instance. */
	scopeKey: string | null;
	/** Oldest to newest; contains only visited tabs with warm retention. */
	warmLru: readonly ActivityTabId[];
}

export interface ActivityTabResidencyInput {
	activeTab: ActivityTabKey;
	candidates: readonly ResolvedActivityTab[];
	floatingKeys: ReadonlySet<ActivityTabKey>;
	scopeKey: string | null;
	/** Only attached/on-bar tabs may consume the bounded warm cache. */
	warmEligibleTabs: readonly ResolvedActivityTab[];
}

export function activityTabRetention(tab: ResolvedActivityTab): ActivityTabRetention {
	if (tab.definition.retention) return tab.definition.retention;
	if (tab.definition.keepAliveWhenAvailable === true) return "pinned";
	if (tab.definition.keepAliveWhenAvailable === false) return "active-only";
	return "warm";
}

export function createActivityTabResidencyState(scopeKey: string | null): ActivityTabResidencyState {
	return { scopeKey, warmLru: [] };
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Prune unavailable entries and touch the current warm tab as most-recently used. */
export function reconcileActivityTabResidency(
	state: ActivityTabResidencyState,
	input: ActivityTabResidencyInput,
): ActivityTabResidencyState {
	const baseLru = state.scopeKey === input.scopeKey ? state.warmLru : [];
	const candidateById = new Map(input.candidates.map((tab) => [tab.id, tab]));
	const eligibleIds = new Set(input.warmEligibleTabs.map((tab) => tab.id));
	const retained = baseLru.filter((id) => {
		const tab = candidateById.get(id);
		return tab !== undefined && eligibleIds.has(id) && activityTabRetention(tab) === "warm";
	});
	const active = candidateById.get(input.activeTab);
	if (active !== undefined && eligibleIds.has(active.id) && activityTabRetention(active) === "warm") {
		const previousIndex = retained.indexOf(active.id);
		if (previousIndex >= 0) retained.splice(previousIndex, 1);
		retained.push(active.id);
	}
	if (state.scopeKey === input.scopeKey && arraysEqual(state.warmLru, retained)) return state;
	return { scopeKey: input.scopeKey, warmLru: retained };
}

export function resolveResidentActivityTabs(
	state: ActivityTabResidencyState,
	input: ActivityTabResidencyInput,
): ResolvedActivityTab[] {
	const warmIds = new Set(state.warmLru);
	const eligibleIds = new Set(input.warmEligibleTabs.map((tab) => tab.id));
	return input.candidates.filter((tab) => {
		const id = tab.id as ActivityTabKey;
		if (id === input.activeTab || input.floatingKeys.has(id)) return true;
		const retention = activityTabRetention(tab);
		if (retention === "pinned") return true;
		if (retention === "warm") return eligibleIds.has(tab.id) && warmIds.has(tab.id);
		return false;
	});
}

/** Select the oldest inactive warm entries; active/floating tabs never consume the limit. */
export function resolveWarmTabEvictions(
	state: ActivityTabResidencyState,
	input: ActivityTabResidencyInput,
	maxInactiveWarmTabs = DEFAULT_INACTIVE_WARM_TAB_LIMIT,
): ActivityTabId[] {
	const protectedIds = new Set<string>([input.activeTab, ...input.floatingKeys]);
	const inactiveIds = state.warmLru.filter((id) => !protectedIds.has(id));
	return inactiveIds.slice(0, Math.max(0, inactiveIds.length - Math.max(0, maxInactiveWarmTabs)));
}

export function evictWarmActivityTabs(
	state: ActivityTabResidencyState,
	tabIds: readonly ActivityTabId[],
): ActivityTabResidencyState {
	if (tabIds.length === 0) return state;
	const evicted = new Set(tabIds);
	const warmLru = state.warmLru.filter((id) => !evicted.has(id));
	return warmLru.length === state.warmLru.length ? state : { ...state, warmLru };
}
