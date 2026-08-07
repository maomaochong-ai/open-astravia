import type { CodingAgentHostBootstrap } from "@vetta/coding-agent/bootstrap";
import {
	CodingAgentActiveSessionHost as CodingAgentGreenfieldActiveSessionHost,
	CodingAgentProcessSessionHost,
	createCodingAgentSessionSetupSeedInitializer,
	createCodingAgentRuntimeComposition as createGreenfieldRuntimeComposition,
	type CodingAgentRuntimeComposition as GreenfieldRuntimeComposition,
	type CodingAgentRuntimeCompositionOptions as GreenfieldRuntimeCompositionOptions,
	type CodingAgentRuntimeSessionOptions as GreenfieldRuntimeSessionOptions,
	resolveSessionIdFromPath as resolveGreenfieldSessionIdFromPath,
} from "@vetta/coding-agent/composition";
import { getVettaHomePath } from "@vetta/coding-agent/config";
import {
	createCodingAgentMcpRuntimeToolSource,
	createCodingAgentPluginMcpRuntime,
} from "@vetta/coding-agent/host-services";
import {
	type CodingAgentRuntimeExtensionEventHost,
	type CodingAgentRuntimeExtensionSessionHost,
	createCodingAgentCompactionExtensionRuntime,
	createCodingAgentRuntimeBranchNavigationHost,
	createCodingAgentRuntimeExtensionCommandActions,
	createCodingAgentRuntimeExtensionEventHost,
	createCodingAgentRuntimeExtensionSessionHost,
	createCodingAgentRuntimeResourceReloadHost,
} from "@vetta/coding-agent/runtime";
import { buildDefaultHookConfigLayers } from "@vetta/ecosystem-adapter";
import {
	type GreenfieldRuntimeSession,
	InitializationRollbackScope,
	type RuntimeSessionCatalog,
} from "@vetta/runtime-core";
import {
	FileConversationOwnershipManager,
	type FileConversationOwnershipManagerOptions,
} from "@vetta/runtime-storage/conversation";

export const GREENFIELD_RUNTIME_HOST_STARTUP_FAILURE = "Greenfield IM Runtime startup and cleanup failed";

export interface GreenfieldCliSessionAssemblyOptions {
	readonly bootstrap: CodingAgentHostBootstrap;
	readonly conversationDir: string;
	readonly sessionCatalog: RuntimeSessionCatalog;
	readonly sessionId: string;
	readonly sessionPath?: string;
	readonly initialModel: GreenfieldRuntimeCompositionOptions["initialModel"];
	readonly initialThinkingLevel: GreenfieldRuntimeCompositionOptions["initialThinkingLevel"];
	readonly backend: "greenfield" | "greenfield-im";
	readonly intent: "rpc" | "print";
	readonly createSessionId: () => string;
	readonly ownership?: FileConversationOwnershipManagerOptions;
	readonly createPluginRuntime?: GreenfieldRuntimeCompositionOptions["createPluginRuntime"];
}

export interface GreenfieldCliSessionAssembly {
	readonly runtime: GreenfieldRuntimeComposition;
	readonly sessionHost: CodingAgentProcessSessionHost;
	readonly extensionSessionHost: CodingAgentRuntimeExtensionSessionHost;
	dispose(): Promise<void>;
}

export async function createGreenfieldCliSessionAssembly(
	options: GreenfieldCliSessionAssemblyOptions,
): Promise<GreenfieldCliSessionAssembly> {
	const { bootstrap } = options;
	const { parsed } = bootstrap;
	const mcpDebug = bootstrap.settingsManager.getMcpDebug();
	const managedMcpSource = await createCodingAgentMcpRuntimeToolSource({
		projectRoot: bootstrap.cwd,
		agentDir: bootstrap.agentDir,
		debug: mcpDebug,
		enabled: true,
	});
	const rollback = new InitializationRollbackScope();
	const dismissMcpRollback = rollback.defer({
		id: "managed-mcp-source",
		rollback: () => managedMcpSource.dispose(),
	});

	let runtime: GreenfieldRuntimeComposition | undefined;
	let extensionSessionHost: CodingAgentRuntimeExtensionSessionHost | undefined;
	let dismissRuntimeRollback: (() => void) | undefined;
	let dismissSessionRollback: (() => void) | undefined;
	let dismissExtensionRollback: (() => void) | undefined;
	let dismissActiveSessionRollback: (() => void) | undefined;
	try {
		runtime = await createGreenfieldRuntimeComposition({
			conversationDir: options.conversationDir,
			modelRegistry: bootstrap.modelRegistry,
			initialModel: options.initialModel,
			initialThinkingLevel: options.initialThinkingLevel,
			cwd: bootstrap.cwd,
			agentDir: bootstrap.agentDir,
			hookConfigLayers: buildDefaultHookConfigLayers({
				cwd: bootstrap.cwd,
				vettaHome: getVettaHomePath(),
			}),
			scenario: options.backend === "greenfield-im" ? "im-claw" : (parsed.scenario ?? "cli"),
			activation:
				parsed.noTools || parsed.tools
					? { mode: "explicit", toolNames: parsed.tools ?? [] }
					: {
							mode: "scope",
							scope: options.backend === "greenfield-im" ? "im-claw" : (parsed.scenario ?? "cli"),
						},
			enableSubagents: options.backend !== "greenfield-im" && options.intent === "rpc",
			systemPromptAdvertisedToolNames:
				options.backend === "greenfield-im" && !parsed.noTools && !parsed.tools
					? ["kb_filter_by_tags", "kb_list_available_tags"]
					: undefined,
			mcpSource: managedMcpSource.source,
			promptResourceSource: bootstrap.resourceLoader,
			promptSettingsSource: bootstrap.settingsManager,
			resolveCompactionSettings: () => bootstrap.settingsManager.getCompactionSettings(),
			createCompactionExtensionRuntime: () =>
				createCodingAgentCompactionExtensionRuntime(() => extensionSessionHost?.readRunner()),
			createPluginRuntime: options.createPluginRuntime,
			extensionTools: bootstrap.extensionsResult.extensions,
			createPluginMcpRuntime: ({ agentDir }) => createCodingAgentPluginMcpRuntime({ agentDir, debug: mcpDebug }),
			conversationOwnershipManager: new FileConversationOwnershipManager(options.ownership),
		});
		const acquiredRuntime = runtime;
		dismissRuntimeRollback = rollback.defer({
			id: "runtime-composition",
			rollback: () => acquiredRuntime.dispose(),
		});
		const sessionOptions: GreenfieldRuntimeSessionOptions = {
			sessionId: options.sessionId,
			cwd: bootstrap.cwd,
			memoryMode: parsed.memoryMode || parsed.memoryFile !== undefined,
			memoryFile: parsed.memoryFile,
		};
		const session = options.sessionPath
			? await runtime.backend.resume(sessionOptions)
			: await runtime.backend.create(sessionOptions);
		const dismissSession = rollback.defer({
			id: "runtime-session",
			rollback: () => session.dispose(),
		});
		dismissSessionRollback = dismissSession;
		runtime.sessionHooks.start(session.sessionId, "resume");
		const createExtensionEventHost = (
			targetSession: GreenfieldRuntimeSession,
			bindingOptions?: { readonly replaceExisting?: boolean },
		) => {
			const extensionsResult = bootstrap.resourceLoader.getExtensions();
			return createCodingAgentRuntimeExtensionEventHost({
				extensions: extensionsResult.extensions,
				runtime: extensionsResult.runtime,
				cwd: bootstrap.cwd,
				session: targetSession,
				modelRegistry: bootstrap.modelRegistry,
				resourceLoader: bootstrap.resourceLoader,
				bindEvents: (runner, rebindOptions) =>
					runtime!.bindExtensionRunner(targetSession.sessionId, runner, rebindOptions ?? bindingOptions),
			});
		};
		const extensionEventHost: CodingAgentRuntimeExtensionEventHost = createExtensionEventHost(session);
		const dismissExtensionEventRollback = rollback.defer({
			id: "extension-event-host",
			rollback: () => extensionEventHost.dispose(),
		});
		extensionSessionHost = createCodingAgentRuntimeExtensionSessionHost(extensionEventHost, createExtensionEventHost);
		dismissExtensionEventRollback();
		const acquiredExtensionSessionHost = extensionSessionHost;
		dismissExtensionRollback = rollback.defer({
			id: "extension-session-host",
			rollback: () => acquiredExtensionSessionHost.dispose(),
		});
		const activeSessionHost = new CodingAgentGreenfieldActiveSessionHost({
			runtime,
			initialSession: session,
			sessionOptions,
			conversationDir: options.conversationDir,
			sessionCatalog: options.sessionCatalog,
			createSessionId: options.createSessionId,
			resolveSessionId: (path) => resolveGreenfieldSessionIdFromPath(options.conversationDir, path),
			lifecycle: {
				before: (transition) => extensionSessionHost!.before(transition),
				prepare: (transition) => extensionSessionHost!.prepare(transition),
				after: (transition) => extensionSessionHost!.after(transition),
			},
		});
		dismissSessionRollback();
		dismissActiveSessionRollback = rollback.defer({
			id: "active-session-host",
			rollback: () => activeSessionHost.dispose(),
		});
		const branchNavigationHost = createCodingAgentRuntimeBranchNavigationHost({
			withActiveSession: (operation) => activeSessionHost.runActiveSessionMutation(operation),
			readRunner: () => extensionSessionHost!.readRunner(),
			settingsManager: bootstrap.settingsManager,
			clearExecutionContext: (targetSessionId) => runtime!.clearSessionExecutionContext(targetSessionId),
		});
		const resourceReloadHost = createCodingAgentRuntimeResourceReloadHost({
			settingsManager: bootstrap.settingsManager,
			resourceLoader: bootstrap.resourceLoader,
			runWithExtensionLifecycle: (operation) =>
				extensionSessionHost!.reload(activeSessionHost.readSession(), operation),
			afterReload: () => {
				const extensionsResult = bootstrap.resourceLoader.getExtensions();
				for (const [name, value] of bootstrap.parsed.unknownFlags) {
					extensionsResult.runtime.flagValues.set(name, value);
				}
				for (const { name, config } of extensionsResult.runtime.pendingProviderRegistrations) {
					bootstrap.modelRegistry.registerProvider(name, config);
				}
				extensionsResult.runtime.pendingProviderRegistrations = [];
				runtime!.refreshExtensionTools(extensionsResult.extensions);
			},
		});
		const extensionCommandActions = createCodingAgentRuntimeExtensionCommandActions({
			waitForIdle: () => activeSessionHost.waitForIdle(),
			newSession: (newSessionOptions) => activeSessionHost.newSession(newSessionOptions),
			createSessionSetupInitializer: createCodingAgentSessionSetupSeedInitializer,
			fork: (entryId) => activeSessionHost.fork(entryId),
			navigateTree: (targetId, navigateOptions) => branchNavigationHost.navigateTree(targetId, navigateOptions),
			switchSession: (targetPath) => activeSessionHost.switchSession(targetPath),
			reload: () => activeSessionHost.runActiveSessionMutation(() => resourceReloadHost.reload()),
		});
		extensionSessionHost.bindCommandContext(extensionCommandActions);
		const sessionHost = new CodingAgentProcessSessionHost({
			runtime,
			activeSessionHost,
			extensionSessionHost,
			mcpSource: managedMcpSource,
			readRetrySettings: () => bootstrap.settingsManager.getRetrySettings(),
			setRetryEnabled: (enabled) => bootstrap.settingsManager.setRetryEnabled(enabled),
		});
		dismissActiveSessionRollback();
		dismissRuntimeRollback();
		dismissMcpRollback();
		dismissExtensionRollback();
		rollback.commit();
		return {
			runtime,
			sessionHost,
			extensionSessionHost,
			dispose: () => sessionHost.dispose(),
		};
	} catch (error) {
		return rollback.rollback(error, GREENFIELD_RUNTIME_HOST_STARTUP_FAILURE);
	}
}
