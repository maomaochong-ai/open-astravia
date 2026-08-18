import type { ActivityTabKey } from "@shared/lib/project-profile";
import { startTransition, useEffect, useMemo, useState } from "react";
import type { ResolvedActivityTab } from "../registry/types";
import {
	type ActivityTabResidencyInput,
	createActivityTabResidencyState,
	DEFAULT_INACTIVE_WARM_TAB_LIMIT,
	evictWarmActivityTabs,
	reconcileActivityTabResidency,
	resolveResidentActivityTabs,
	resolveWarmTabEvictions,
} from "../services/activity-tab-residency";

const IDLE_EVICTION_TIMEOUT_MS = 1_000;
const FALLBACK_EVICTION_DELAY_MS = 250;

export interface UseActivityTabResidencyInput {
	activeTab: ActivityTabKey;
	candidates: readonly ResolvedActivityTab[];
	floatingKeys: ReadonlySet<ActivityTabKey>;
	maxInactiveWarmTabs?: number;
	scopeKey: string | null;
	warmEligibleTabs: readonly ResolvedActivityTab[];
}

/**
 * Keeps visited tabs mounted and evicts overflow outside the interaction path.
 * The pure policy lives in activity-tab-residency so scheduling can change independently.
 */
export function useActivityTabResidency({
	activeTab,
	candidates,
	floatingKeys,
	maxInactiveWarmTabs = DEFAULT_INACTIVE_WARM_TAB_LIMIT,
	scopeKey,
	warmEligibleTabs,
}: UseActivityTabResidencyInput): ResolvedActivityTab[] {
	const input = useMemo<ActivityTabResidencyInput>(
		() => ({ activeTab, candidates, floatingKeys, scopeKey, warmEligibleTabs }),
		[activeTab, candidates, floatingKeys, scopeKey, warmEligibleTabs],
	);
	const [state, setState] = useState(() =>
		reconcileActivityTabResidency(createActivityTabResidencyState(scopeKey), input),
	);
	const reconciledState = useMemo(() => reconcileActivityTabResidency(state, input), [state, input]);

	useEffect(() => {
		setState((current) => reconcileActivityTabResidency(current, input));
	}, [input]);

	useEffect(() => {
		const evictions = resolveWarmTabEvictions(reconciledState, input, maxInactiveWarmTabs);
		if (evictions.length === 0) return;

		let cancelled = false;
		const evict = (): void => {
			if (cancelled) return;
			startTransition(() => {
				setState((current) => {
					const latest = reconcileActivityTabResidency(current, input);
					return evictWarmActivityTabs(latest, resolveWarmTabEvictions(latest, input, maxInactiveWarmTabs));
				});
			});
		};
		if (typeof window.requestIdleCallback === "function") {
			const handle = window.requestIdleCallback(evict, { timeout: IDLE_EVICTION_TIMEOUT_MS });
			return () => {
				cancelled = true;
				window.cancelIdleCallback(handle);
			};
		}
		const handle = window.setTimeout(evict, FALLBACK_EVICTION_DELAY_MS);
		return () => {
			cancelled = true;
			window.clearTimeout(handle);
		};
	}, [input, maxInactiveWarmTabs, reconciledState]);

	return useMemo(() => resolveResidentActivityTabs(reconciledState, input), [reconciledState, input]);
}
