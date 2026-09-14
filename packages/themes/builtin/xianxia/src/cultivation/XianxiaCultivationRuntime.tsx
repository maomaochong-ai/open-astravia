import { useThemeUsageStats } from "@vetta-org/theme-sdk";
import { useEffect } from "react";
import { computeCultivation } from "./computeCultivation";
import { useCultivationRepository } from "./persistence/cultivation-repository";

const SYNC_INTERVAL_MS = 30_000;

/**
 * Headless runtime: app-monitor aggregates → theme cultivation storage.
 * CultivationRepository owns persistence for the canonical cultivation state.
 * Verify via console `[xianxia-cultivation]` and
 * `~/.vetta/desktop-app/themes/xianxia/{cultivation,cultivation-history}.json`.
 */
export function XianxiaCultivationRuntime(): null {
	const repository = useCultivationRepository();
	const usage = useThemeUsageStats();
	const repositoryStatus = repository.status;
	const usageStatus = usage.status;

	useEffect(() => {
		void usage.refresh();
		const timer = window.setInterval(() => {
			void usage.refresh();
		}, SYNC_INTERVAL_MS);

		const onFocus = (): void => {
			void usage.refresh();
		};
		window.addEventListener("focus", onFocus);

		return () => {
			window.clearInterval(timer);
			window.removeEventListener("focus", onFocus);
		};
	}, [usage.refresh]);

	useEffect(() => {
		if (usageStatus !== "ready" || !usage.stats) return;
		if (repositoryStatus !== "ready") return;

		const now = Date.now();
		const state = computeCultivation(usage.stats, now, repository.load());
		if (!repository.save(state)) return;
		const { snapshot } = state;
		console.info(
			`[xianxia-cultivation] synced realm=${snapshot.realmId} level=${snapshot.level} ` +
				`score=${snapshot.score} progress=${snapshot.progressToNext.toFixed(3)} ` +
				`messages=${snapshot.metrics.messages} turns=${snapshot.metrics.turns} ` +
				`tools=${snapshot.metrics.toolsCompleted} activeMs=${snapshot.metrics.foregroundActiveMs}`,
		);
	}, [repository, repositoryStatus, usage.stats, usageStatus]);

	return null;
}
