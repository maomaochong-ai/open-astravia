import type { InstalledPlugin } from "@preload/api";
import type {
	Disposable,
	PluginCliProviderApi,
	PluginCommandSpawnExit,
	PluginCommandSpawnHandle,
} from "@vetta-org/plugin-sdk";

const exitListeners = new Map<string, Set<(exit: PluginCommandSpawnExit) => void>>();
let exitSubscriptionInstalled = false;

function ensureExitSubscription(): void {
	if (exitSubscriptionInstalled) return;
	exitSubscriptionInstalled = true;
	window.vetta.plugins.onCliProviderSpawnExit((event) => {
		const listeners = exitListeners.get(event.spawnId);
		if (!listeners) return;
		exitListeners.delete(event.spawnId);
		for (const listener of listeners) listener({ exitCode: event.exitCode, signal: event.signal });
	});
}

export function createPluginCliProviderApi(
	plugin: InstalledPlugin,
	disposers: Array<() => void>,
): PluginCliProviderApi {
	const assertDeclared = (providerId: string): string => {
		if (!plugin.cliProviders?.some((provider) => provider.id === providerId)) {
			throw new Error(`Plugin ${plugin.id} CLI provider not declared: ${providerId}`);
		}
		return providerId;
	};
	return {
		getStatus: (providerId) => window.vetta.plugins.getCliProviderStatus(plugin.id, assertDeclared(providerId)),
		onStatusChanged: (listener): Disposable => {
			const unsubscribe = window.vetta.plugins.onCliProviderStatusChanged((event) => {
				if (event.pluginId === plugin.id) listener(event.status);
			});
			disposers.push(unsubscribe);
			return { dispose: unsubscribe };
		},
		retry: (providerId) => window.vetta.plugins.retryCliProvider(plugin.id, assertDeclared(providerId)),
		run: (providerId, args, options) =>
			window.vetta.plugins.runCliProvider(plugin.id, assertDeclared(providerId), args ?? [], options),
		spawn: async (providerId, args, options): Promise<PluginCommandSpawnHandle> => {
			ensureExitSubscription();
			const result = await window.vetta.plugins.spawnCliProvider(
				plugin.id,
				assertDeclared(providerId),
				args ?? [],
				options,
			);
			let stopped = false;
			const stop = async (): Promise<void> => {
				if (stopped) return;
				stopped = true;
				await window.vetta.plugins.stopCliProviderSpawn(plugin.id, result.spawnId);
			};
			disposers.push(() => void stop());
			return {
				spawnId: result.spawnId,
				pid: result.pid,
				stop,
				status: () => window.vetta.plugins.getCliProviderSpawnStatus(plugin.id, result.spawnId),
				onExit: (listener) => {
					const listeners = exitListeners.get(result.spawnId) ?? new Set();
					listeners.add(listener);
					exitListeners.set(result.spawnId, listeners);
					return { dispose: () => listeners.delete(listener) };
				},
			};
		},
	};
}
