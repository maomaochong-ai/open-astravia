import type { SessionSettingsPort } from "../contracts/session-settings.js";
import type { SettingsStatePort } from "../runtime/settings-state.js";

export function createSessionSettingsView(state: SettingsStatePort): SessionSettingsPort {
	const view: SessionSettingsPort = {
		getSteeringMode: () => state.read().steeringMode ?? "one-at-a-time",
		setSteeringMode: (steeringMode) => state.patchGlobal({ steeringMode }),
		getFollowUpMode: () => state.read().followUpMode ?? "one-at-a-time",
		setFollowUpMode: (followUpMode) => state.patchGlobal({ followUpMode }),
		getCompactionEnabled: () => state.read().compaction?.enabled ?? true,
		setCompactionEnabled: (enabled) => state.patchGlobal({ compaction: { enabled } }),
		getCompactionReserveTokens: () => state.read().compaction?.reserveTokens ?? 36000,
		getCompactionMinFreePercent: () => state.read().compaction?.minFreePercent ?? 20,
		getCompactionKeepRecentTokens: () => state.read().compaction?.keepRecentTokens ?? 20000,
		getCompactionSettings: () => ({
			enabled: view.getCompactionEnabled(),
			reserveTokens: view.getCompactionReserveTokens(),
			minFreePercent: view.getCompactionMinFreePercent(),
			keepRecentTokens: view.getCompactionKeepRecentTokens(),
		}),
		getBranchSummarySettings: () => ({ reserveTokens: state.read().branchSummary?.reserveTokens ?? 16384 }),
		getRetryEnabled: () => state.read().retry?.enabled ?? true,
		setRetryEnabled: (enabled) => state.patchGlobal({ retry: { enabled } }),
		getRetrySettings: () => {
			const retry = state.read().retry;
			return {
				enabled: retry?.enabled ?? true,
				maxRetries: retry?.maxRetries ?? 3,
				baseDelayMs: retry?.baseDelayMs ?? 2000,
				maxDelayMs: retry?.maxDelayMs ?? 60000,
			};
		},
		getHideThinkingBlock: () => state.read().hideThinkingBlock ?? false,
		setHideThinkingBlock: (hideThinkingBlock) => state.patchGlobal({ hideThinkingBlock }),
		getImageAutoResize: () => state.read().images?.autoResize ?? true,
		setImageAutoResize: (autoResize) => state.patchGlobal({ images: { autoResize } }),
		getBlockImages: () => state.read().images?.blockImages ?? false,
		setBlockImages: (blockImages) => state.patchGlobal({ images: { blockImages } }),
		getPersonalization: () => ({
			personaId: state.read().personalization?.personaId ?? "default",
			customPrompt: state.read().personalization?.customPrompt ?? "",
		}),
	};
	return view;
}
