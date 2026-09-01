import type {
	PluginCommandRunOptions,
	PluginCommandRunResult,
	PluginCommandSpawnHandle,
	PluginCommandSpawnOptions,
} from "./command.js";
import type { Disposable } from "./disposable.js";

export type PluginCliProviderPhase = "disabled" | "checking" | "installing" | "verifying" | "ready" | "failed";

export interface PluginCliProviderStatus {
	providerId: string;
	phase: PluginCliProviderPhase;
	message?: string;
	recentOutput: string;
}

/** Host-managed CLI dependency declared by `plugin.json#providers.cli`. */
export interface PluginCliProviderApi {
	getStatus(providerId: string): Promise<PluginCliProviderStatus>;
	onStatusChanged(listener: (status: PluginCliProviderStatus) => void): Disposable;
	retry(providerId: string): Promise<void>;
	run(
		providerId: string,
		args?: string[],
		options?: PluginCommandRunOptions,
	): Promise<PluginCommandRunResult>;
	spawn(
		providerId: string,
		args?: string[],
		options?: PluginCommandSpawnOptions,
	): Promise<PluginCommandSpawnHandle>;
}
