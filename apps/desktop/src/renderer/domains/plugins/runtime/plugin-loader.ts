import type { InstalledPlugin } from "@preload/api";
import type { PluginDefinition } from "@vetta-org/plugin-sdk";
import { PluginActivationCleanupController } from "./plugin-activation-cleanup";
import { clearAgentToolLabelsForPlugin } from "./plugin-agent-context";
import { createPluginContext } from "./plugin-context";
import { createPluginSecretsApi } from "./plugin-host-apis";
import { type LoadedPlugin, PluginLocalContributions } from "./plugin-local-contributions";
import { loadPluginDefinition } from "./plugin-module-loader";
import { pluginRendererCapabilityHost } from "./plugin-renderer-capability-host";
import { logPluginRuntimeError, logPluginRuntimeInfo } from "./plugin-runtime-log";
import { loadPluginStyles } from "./plugin-style-loader";

export type { LoadedPlugin } from "./plugin-local-contributions";

export async function loadPlugin(plugin: InstalledPlugin, onChanged: () => void): Promise<LoadedPlugin> {
	const activationId = crypto.randomUUID();
	const logFields = {
		pluginId: plugin.id,
		pluginVersion: plugin.activeVersion,
		pluginSource: plugin.source,
		activationId,
	} as const;
	logPluginRuntimeInfo("activation started", { ...logFields, stage: "begin-contributions" });
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
	let capabilitySessionDiagnosticId: string | undefined;
	let stage = "begin-contributions";
	const closeCapabilitySession = async (): Promise<void> => {
		if (capabilitySessionId === undefined) return;
		const sessionId = capabilitySessionId;
		pluginRendererCapabilityHost.closeSession(sessionId);
		try {
			await window.vetta.plugins.internalCapabilities.closeSession(sessionId);
		} finally {
			capabilitySessionId = undefined;
		}
	};
	try {
		await window.vetta.plugins.beginAgentContributionsLoad(plugin.id, activationId);
		stage = "load-definition";
		definition = await loadPluginDefinition(plugin);
		const pendingRuntimeRegistrations: Promise<void>[] = [];
		stage = "open-capability-session";
		capabilitySessionId = await window.vetta.plugins.internalCapabilities.openSession(plugin.id);
		capabilitySessionDiagnosticId = capabilitySessionId;
		pluginRendererCapabilityHost.bindSession(capabilitySessionId, plugin);
		const secretsApi = createPluginSecretsApi(plugin, capabilitySessionId, disposers);
		const context = createPluginContext({
			plugin,
			contributions,
			secretsApi,
			onChanged,
			disposers,
			pendingRuntimeRegistrations,
			activationId,
			capabilitySessionId,
		});
		activationStarted = true;
		stage = "activate";
		const cleanup = await definition.activate(context);
		activationCleanup.set(cleanup ?? undefined);
		stage = "runtime-registrations";
		await Promise.all(pendingRuntimeRegistrations);
		stage = "commit-contributions";
		await window.vetta.plugins.commitAgentContributionsLoad(plugin.id, activationId);
		logPluginRuntimeInfo("activation completed", {
			...logFields,
			capabilitySessionId: capabilitySessionDiagnosticId,
			stage: "active",
			count: pendingRuntimeRegistrations.length,
		});
		return contributions.toLoadedPlugin(plugin, async () => {
			logPluginRuntimeInfo("deactivation started", {
				...logFields,
				capabilitySessionId: capabilitySessionDiagnosticId,
				stage: "plugin-cleanup",
			});
			try {
				try {
					await activationCleanup.dispose().catch((error: unknown) => {
						logPluginRuntimeError(
							"deactivation stage failed",
							{ ...logFields, capabilitySessionId: capabilitySessionDiagnosticId, stage: "plugin-cleanup" },
							error,
						);
						throw error;
					});
				} finally {
					await Promise.resolve(definition?.deactivate?.()).catch((error: unknown) => {
						logPluginRuntimeError(
							"deactivation stage failed",
							{
								...logFields,
								capabilitySessionId: capabilitySessionDiagnosticId,
								stage: "definition-deactivate",
							},
							error,
						);
						throw error;
					});
				}
			} finally {
				try {
					await window.vetta.plugins.clearAgentContributions(plugin.id, activationId);
				} finally {
					try {
						disposeLocalContributions();
					} finally {
						await closeCapabilitySession();
					}
				}
			}
			logPluginRuntimeInfo("deactivation completed", { ...logFields, stage: "closed" });
		});
	} catch (error) {
		logPluginRuntimeError(
			"activation failed",
			{ ...logFields, capabilitySessionId: capabilitySessionDiagnosticId, stage },
			error,
		);
		if (activationStarted) {
			await activationCleanup.dispose().catch((cleanupError: unknown) => {
				logPluginRuntimeError(
					"activation rollback stage failed",
					{ ...logFields, capabilitySessionId: capabilitySessionDiagnosticId, stage: "plugin-cleanup" },
					cleanupError,
				);
			});
			await Promise.resolve(definition?.deactivate?.()).catch((deactivateError: unknown) => {
				logPluginRuntimeError(
					"activation rollback stage failed",
					{
						...logFields,
						capabilitySessionId: capabilitySessionDiagnosticId,
						stage: "definition-deactivate",
					},
					deactivateError,
				);
			});
		}
		await window.vetta.plugins.abortAppActionActivation(plugin.id, activationId).catch((abortError: unknown) => {
			logPluginRuntimeError(
				"activation rollback stage failed",
				{ ...logFields, capabilitySessionId: capabilitySessionDiagnosticId, stage: "abort-app-actions" },
				abortError,
			);
		});
		await window.vetta.plugins.clearAgentContributions(plugin.id, activationId).catch((clearError: unknown) => {
			logPluginRuntimeError(
				"activation rollback stage failed",
				{
					...logFields,
					capabilitySessionId: capabilitySessionDiagnosticId,
					stage: "clear-agent-contributions",
				},
				clearError,
			);
		});
		disposeLocalContributions();
		await closeCapabilitySession().catch((closeError: unknown) => {
			logPluginRuntimeError(
				"activation rollback stage failed",
				{
					...logFields,
					capabilitySessionId: capabilitySessionDiagnosticId,
					stage: "close-capability-session",
				},
				closeError,
			);
		});
		throw error;
	}
}
