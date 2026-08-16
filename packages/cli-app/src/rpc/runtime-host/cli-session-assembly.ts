import { join } from "node:path";
import type { CodingAgentBootstrap } from "@vetta/coding-agent/bootstrap";
import {
	CodingAgentActiveSessionHost,
	type CodingAgentMemoryRuntimeFactoryOptions,
	CodingAgentProcessSessionHost,
	type CodingAgentRuntimeComposition,
	type CodingAgentRuntimeCompositionOptions,
	type CodingAgentRuntimeSessionOptions,
	createCodingAgentCodingToolResultPolicy,
	createCodingAgentMemoryRolloverRuntime,
	createCodingAgentRuntimeComposition,
	createCodingAgentSessionSetupSeedInitializer,
} from "@vetta/coding-agent/composition";
import { getKnowledgeDir, getVettaHomePath } from "@vetta/coding-agent/config";
import {
	createCodingAgentMcpRuntimeToolSource,
	createCodingAgentNodeToolEnvironment,
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
import { InitializationRollbackScope, type RuntimeSession, type RuntimeSessionCatalog } from "@vetta/runtime-core";
import { createMcpToolResultPolicy } from "@vetta/runtime-mcp";
import {
	createFileConversationPersistence,
	FileConversationOwnershipManager,
	type FileConversationOwnershipManagerOptions,
	resolveConversationFilePath,
	resolveSessionIdFromPath,
} from "@vetta/runtime-node/conversation";
import {
	createNodeKnowledgeRuntime,
	createNodeResultArtifactStorage,
	NodeTextFileStorage,
} from "@vetta/runtime-node/host";

export const CLI_RUNTIME_HOST_STARTUP_FAILURE = "CLI Runtime startup and cleanup failed";

export interface CliSessionAssemblyOptions {
	readonly bootstrap: CodingAgentBootstrap;
	readonly conversationDir: string;
	readonly sessionCatalog: RuntimeSessionCatalog;
	readonly sessionId: string;
	readonly sessionPath?: string;
	readonly initialModel: CodingAgentRuntimeCompositionOptions["initialModel"];
	readonly initialThinkingLevel: CodingAgentRuntimeCompositionOptions["initialThinkingLevel"];
	readonly backend: "rpc" | "im";
	readonly intent: "rpc" | "print";
	readonly createSessionId: () => string;
	readonly ownership?: FileConversationOwnershipManagerOptions;
	readonly createPluginRuntime?: CodingAgentRuntimeCompositionOptions["createPluginRuntime"];
}

function createCliMemoryRolloverRuntime(options: CodingAgentMemoryRuntimeFactoryOptions) {
	const memoryFile = options.memoryFile ?? join(options.cwd, "MEMORY.md");
	return createCodingAgentMemoryRolloverRuntime({
		cwd: options.cwd,
		memoryFile,
		memoryCharLimit: options.memoryCharLimit,
		memoryStorage: new NodeTextFileStorage(memoryFile),
		journalStorage: new NodeTextFileStorage(join(options.cwd, "JOURNAL.md")),
	});
}

export interface CliSessionAssembly {
	readonly runtime: CodingAgentRuntimeComposition;
	readonly sessionHost: CodingAgentProcessSessionHost;
	readonly extensionSessionHost: CodingAgentRuntimeExtensionSessionHost;
	dispose(): Promise<void>;
}

export async function createCliSessionAssembly(options: CliSessionAssemblyOptions): Promise<CliSessionAssembly> {
	const { bootstrap } = options;
	const { parsed } = bootstrap;
	const mcpDebug = bootstrap.settingsManager.getMcpDebug();
	const resultArtifacts = createNodeResultArtifactStorage({
		codingRoot: join(bootstrap.agentDir, "tool-results"),
		mcpRoot: join(bootstrap.agentDir, "mcp-results"),
	});
	const codingToolResultPolicy = createCodingAgentCodingToolResultPolicy({ artifactStore: resultArtifacts.coding });
	const mcpToolResultPolicy = createMcpToolResultPolicy({ artifactStore: resultArtifacts.mcp });
	const managedMcpSource = await createCodingAgentMcpRuntimeToolSource({
		projectRoot: bootstrap.cwd,
		agentDir: bootstrap.agentDir,
		debug: mcpDebug,
		enabled: true,
		resultPolicy: mcpToolResultPolicy,
	});
	const rollback = new InitializationRollbackScope();
	const dismissMcpRollback = rollback.defer({
		id: "managed-mcp-source",
		rollback: () => managedMcpSource.dispose(),
	});

	let runtime: CodingAgentRuntimeComposition | undefined;
	let extensionSessionHost: CodingAgentRuntimeExtensionSessionHost | undefined;
	let dismissRuntimeRollback: (() => void) | undefined;
	let dismissSessionRollback: (() => void) | undefined;
	let dismissExtensionRollback: (() => void) | undefined;
	let dismissActiveSessionRollback: (() => void) | undefined;
	try {
		runtime = await createCodingAgentRuntimeComposition({
			conversationDir: options.conversationDir,
			createConversationPersistence: () => createFileConversationPersistence(options.conversationDir),
			createToolEnvironment: createCodingAgentNodeToolEnvironment,
			codingToolResultPolicy,
			modelRegistry: bootstrap.modelRegistry,
			initialModel: options.initialModel,
			initialThinkingLevel: options.initialThinkingLevel,
			cwd: bootstrap.cwd,
			agentDir: bootstrap.agentDir,
			knowledgeRuntime:
				process.env.VETTA_KNOWLEDGE_DISABLED === "1" ? undefined : createNodeKnowledgeRuntime(getKnowledgeDir()),
			createMemoryRolloverRuntime: createCliMemoryRolloverRuntime,
			hookConfigLayers: buildDefaultHookConfigLayers({
				cwd: bootstrap.cwd,
				vettaHome: getVettaHomePath(),
			}),
			scenario: options.backend === "im" ? "im-claw" : (parsed.scenario ?? "cli"),
			activation:
				parsed.noTools || parsed.tools
					? { mode: "explicit", toolNames: parsed.tools ?? [] }
					: {
							mode: "scope",
							scope: options.backend === "im" ? "im-claw" : (parsed.scenario ?? "cli"),
						},
			enableSubagents: options.backend !== "im" && options.intent === "rpc",
			systemPromptAdvertisedToolNames:
				options.backend === "im" && !parsed.noTools && !parsed.tools
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
			createPluginMcpRuntime: ({ agentDir }) =>
				createCodingAgentPluginMcpRuntime({ agentDir, debug: mcpDebug, resultPolicy: mcpToolResultPolicy }),
			conversationOwnershipManager: new FileConversationOwnershipManager(options.ownership),
		});
		const acquiredRuntime = runtime;
		dismissRuntimeRollback = rollback.defer({
			id: "runtime-composition",
			rollback: () => acquiredRuntime.dispose(),
		});
		const sessionOptions: CodingAgentRuntimeSessionOptions = {
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
			targetSession: RuntimeSession,
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
		const activeSessionHost = new CodingAgentActiveSessionHost({
			runtime,
			initialSession: session,
			sessionOptions,
			conversationDir: options.conversationDir,
			defaultCwd: bootstrap.cwd,
			sessionCatalog: options.sessionCatalog,
			createSessionId: options.createSessionId,
			resolveSessionId: (path) => resolveSessionIdFromPath(options.conversationDir, path),
			resolveSessionPath: (sessionId) => resolveConversationFilePath(options.conversationDir, sessionId),
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
		return rollback.rollback(error, CLI_RUNTIME_HOST_STARTUP_FAILURE);
	}
}
