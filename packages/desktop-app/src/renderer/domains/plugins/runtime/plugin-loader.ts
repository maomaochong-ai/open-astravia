import type { InstalledPlugin } from "@preload/api";
import type { PluginDefinition } from "@vetta-org/plugin-sdk";
import { PluginActivationCleanupController } from "./plugin-activation-cleanup";
import { clearAgentToolLabelsForPlugin, debugPluginAgent } from "./plugin-agent-context";
import { createPluginContext } from "./plugin-context";
import { createPluginSettingsApi } from "./plugin-host-apis";
import { type LoadedPlugin, PluginLocalContributions } from "./plugin-local-contributions";
import { loadPluginDefinition } from "./plugin-module-loader";
import { pluginRendererCapabilityHost } from "./plugin-renderer-capability-host";
import { loadPluginStyles } from "./plugin-style-loader";

export type { LoadedPlugin } from "./plugin-local-contributions";

export async function loadPlugin(plugin: InstalledPlugin, onChanged: () => void): Promise<LoadedPlugin> {
	const activationId = crypto.randomUUID();
	debugPluginAgent("load start", {
		pluginId: plugin.id,
		version: plugin.activeVersion,
		runtime: plugin.runtime,
		source: plugin.source,
		activationId,
	});
	const contributions = new PluginLocalContributions();
	const disposers: Array<() => void> = [];
	const styleHandle = loadPluginStyles(plugin);
	let locallyDisposed = false;
	const disposeLocalContributions = (): void => {
		if (locallyDisposed) return;
		locallyDisposed = true;
		styleHandle.dispose();
		for (const dispose of disposers) dispose();
		contributions.clear();
		clearAgentToolLabelsForPlugin(plugin.id);
		onChanged();
	};
	let definition: PluginDefinition | undefined;
	const activationCleanup = new PluginActivationCleanupController();
	let activationStarted = false;
	let capabilitySessionId: string | undefined;
	const closeCapabilitySession = async (): Promise<void> => {
		if (capabilitySessionId === undefined) return;
		const sessionId = capabilitySessionId;
		capabilitySessionId = undefined;
		pluginRendererCapabilityHost.closeSession(sessionId);
		await window.vetta.plugins.internalCapabilities.closeSession(sessionId);
	};
	try {
		await window.vetta.plugins.beginAgentContributionsLoad(plugin.id, activationId);
		debugPluginAgent("began dynamic agent contribution activation", { pluginId: plugin.id, activationId });
		definition = await loadPluginDefinition(plugin);
		const initialSettings = plugin.settingsSchema?.length
			? await window.vetta.plugins.getSettings(plugin.id).catch(() => ({}))
			: {};
		const settingsApi = createPluginSettingsApi(plugin, initialSettings, disposers);
		const pendingRuntimeRegistrations: Promise<void>[] = [];
		capabilitySessionId = await window.vetta.plugins.internalCapabilities.openSession(plugin.id);
		pluginRendererCapabilityHost.bindSession(capabilitySessionId, plugin);
		const context = createPluginContext({
			plugin,
			contributions,
			settingsApi,
			onChanged,
			disposers,
			pendingRuntimeRegistrations,
			activationId,
			capabilitySessionId,
		});
		activationStarted = true;
		const cleanup = await definition.activate(context);
		activationCleanup.set(cleanup ?? undefined);
		debugPluginAgent("activate resolved", {
			pluginId: plugin.id,
			pendingRuntimeRegistrations: pendingRuntimeRegistrations.length,
			activationId,
		});
		await Promise.all(pendingRuntimeRegistrations);
		await window.vetta.plugins.commitAppActionActivation(plugin.id, activationId);
		debugPluginAgent("load complete", {
			pluginId: plugin.id,
			runtimeContributionsRegistered: pendingRuntimeRegistrations.length,
			globalSlots: contributions.slots.length,
			activityTabs: contributions.activityTabs.length,
			cardRenderers: contributions.cardRenderers.length,
			toolCallSlots: contributions.toolCallSlots.length,
			activationId,
		});
		return contributions.toLoadedPlugin(plugin, async () => {
			debugPluginAgent("dispose start", { pluginId: plugin.id, activationId });
			try {
				try {
					await activationCleanup.dispose();
				} finally {
					await definition?.deactivate?.();
				}
			} finally {
				try {
					await window.vetta.plugins.clearAgentContributions(plugin.id, activationId);
					debugPluginAgent("cleared dynamic agent contributions on dispose", {
						pluginId: plugin.id,
						activationId,
					});
				} finally {
					try {
						disposeLocalContributions();
					} finally {
						await closeCapabilitySession();
					}
				}
			}
		});
	} catch (error) {
		if (activationStarted) {
			await activationCleanup.dispose().catch((cleanupError: unknown) => {
				console.error(`Plugin ${plugin.id} failed to clean up after activation failure`, cleanupError);
			});
			await Promise.resolve(definition?.deactivate?.()).catch((deactivateError: unknown) => {
				console.error(`Plugin ${plugin.id} failed to deactivate after activation failure`, deactivateError);
			});
		}
		await window.vetta.plugins.abortAppActionActivation(plugin.id, activationId).catch((abortError: unknown) => {
			console.error(`Plugin ${plugin.id} failed to abort app action activation`, abortError);
		});
		await window.vetta.plugins.clearAgentContributions(plugin.id, activationId).catch((clearError: unknown) => {
			console.error(`Plugin ${plugin.id} failed to clear contributions after activation failure`, clearError);
		});
		disposeLocalContributions();
		await closeCapabilitySession().catch((closeError: unknown) => {
			console.error(`Plugin ${plugin.id} failed to close capability session`, closeError);
		});
		throw error;
	}
}
