import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import type { CodingAgentBootstrap } from "@vetta/coding-agent/bootstrap";
import {
	type CodingAgentMemoryRuntimeFactoryOptions,
	type CodingAgentRuntimeComposition,
	type CodingAgentRuntimeCompositionOptions,
	type CodingAgentRuntimeSessionOptions,
	createCodingAgentCodingToolResultPolicy,
	createCodingAgentMemoryRolloverRuntime,
	createCodingAgentRuntimeComposition,
	createCodingAgentRuntimeHostSessionConfig,
	createCodingAgentSessionSetupSeedInitializer,
} from "@vetta/coding-agent/composition";
import { getKnowledgeDir, getVettaHomePath } from "@vetta/coding-agent/config";
import {
	createCodingAgentMcpRuntimeToolSource,
	createCodingAgentPluginMcpRuntime,
} from "@vetta/coding-agent/host-services";
import { detectWorkspaceFacts, probeWorkspaceSignals } from "@vetta/coding-agent/model-context";
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
	InitializationRollbackScope,
	RuntimeActiveSessionHost,
	RuntimeHost,
	type RuntimeHostSession,
	type RuntimeSessionCatalog,
} from "@vetta/runtime-core";
import { createMcpToolResultPolicy } from "@vetta/runtime-mcp";
import { nodeModelInputImageProcessor, nodeWorkspaceFactsFileSource } from "@vetta/runtime-node/coding";
import {
	createConversationSeedDraft,
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
import {
	createCliCodingAgentSessionExecutionEnvironmentFactory,
	createCliCodingAgentToolEnvironmentFactory,
} from "./cli-tool-environment.js";
import { CliCodingAgentProcessSessionHost } from "./coding-agent-process-session-host.js";
import { createCliMcpSupervisor } from "./mcp-supervisor.js";

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
	readonly runtimeHost: RuntimeHost;
	readonly sessionHost: CliCodingAgentProcessSessionHost;
	readonly extensionSessionHost: CodingAgentRuntimeExtensionSessionHost;
	dispose(): Promise<void>;
}

export async function createCliSessionAssembly(options: CliSessionAssemblyOptions): Promise<CliSessionAssembly> {
	const { bootstrap } = options;
	const { parsed } = bootstrap;
	const mcpDebug = bootstrap.settingsManager.getMcpDebug();
	const createToolEnvironment = createCliCodingAgentToolEnvironmentFactory({
		agentDir: bootstrap.agentDir,
		settings: bootstrap.settingsManager,
	});
	const createSessionExecutionEnvironment = createCliCodingAgentSessionExecutionEnvironmentFactory({
		agentDir: bootstrap.agentDir,
		settings: bootstrap.settingsManager,
	});
	const resultArtifacts = createNodeResultArtifactStorage({
		codingRoot: join(bootstrap.agentDir, "tool-results"),
		mcpRoot: join(bootstrap.agentDir, "mcp-results"),
	});
	const codingToolResultPolicy = createCodingAgentCodingToolResultPolicy({ artifactStore: resultArtifacts.coding });
	const mcpToolResultPolicy = createMcpToolResultPolicy({ artifactStore: resultArtifacts.mcp });
	const managedMcpSource = await createCodingAgentMcpRuntimeToolSource({
		supervisor: createCliMcpSupervisor({
			projectRoot: bootstrap.cwd,
			agentDir: bootstrap.agentDir,
			debug: mcpDebug,
		}),
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
	let dismissRuntimeHostRollback: (() => void) | undefined;
	let dismissExtensionRollback: (() => void) | undefined;
	let dismissActiveSessionRollback: (() => void) | undefined;
	try {
		const scenario = options.backend === "im" ? "im-claw" : (parsed.scenario ?? "cli");
		runtime = await createCodingAgentRuntimeComposition({
			conversationDir: options.conversationDir,
			createConversationPersistence: () => createFileConversationPersistence(options.conversationDir),
			createToolEnvironment,
			createSessionExecutionEnvironment,
			codingToolResultPolicy,
			modelRegistry: bootstrap.modelRegistry,
			modelInputImageProcessor: nodeModelInputImageProcessor,
			initialModel: options.initialModel,
			initialThinkingLevel: options.initialThinkingLevel,
			ocrMaxConcurrent: resolvePositiveInteger(process.env.VETTA_KB_OCR_CONCURRENCY),
			cwd: bootstrap.cwd,
			workspaceFacts: detectWorkspaceFacts(bootstrap.cwd, (cwd) =>
				probeWorkspaceSignals(cwd, nodeWorkspaceFactsFileSource),
			),
			agentDir: bootstrap.agentDir,
			knowledgeRuntime:
				process.env.VETTA_KNOWLEDGE_DISABLED === "1" ? undefined : createNodeKnowledgeRuntime(getKnowledgeDir()),
			createMemoryRolloverRuntime: createCliMemoryRolloverRuntime,
			hookConfigLayers: buildDefaultHookConfigLayers({
				cwd: bootstrap.cwd,
				vettaHome: getVettaHomePath(),
			}),
			scenario,
			activation:
				parsed.noTools || parsed.tools
					? { mode: "explicit", toolNames: parsed.tools ?? [] }
					: {
							mode: "scope",
							scope: options.backend === "im" ? "im-claw" : (parsed.scenario ?? "cli"),
						},
			enableSubagents: options.backend !== "im" && options.intent === "rpc",
			createSubagentId: randomUUID,
			subagentPathPort: { dirname, join },
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
			createPluginMcpRuntime: ({ cwd, agentDir }) =>
				createCodingAgentPluginMcpRuntime({
					supervisor: createCliMcpSupervisor({
						projectRoot: cwd,
						agentDir: agentDir ?? bootstrap.agentDir,
						debug: mcpDebug,
						dynamicOnly: true,
					}),
					debug: mcpDebug,
					resultPolicy: mcpToolResultPolicy,
				}),
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
		const runtimeHost = new RuntimeHost({
			sessionBackend: runtime.runtimeHostBackend,
			sessionCatalog: options.sessionCatalog,
			observationPublisher: runtime.observations.publisher(),
			// CLI 的历史默认是直接工具执行；Desktop 才从用户设置解析默认 execution mode。
			getDefaultExecutionMode: () => "full-access",
		});
		dismissRuntimeHostRollback = rollback.defer({
			id: "runtime-host",
			rollback: () => runtimeHost.close(),
		});
		const initial = await runtimeHost.createSession(
			toRuntimeHostSessionConfig(runtime, sessionOptions, scenario, options.sessionPath),
		);
		const session = runtimeHost.getSessionView(initial.sessionId);
		runtime.sessionHooks.start(session.sessionId, "resume");
		const createExtensionEventHost = (
			targetSession: RuntimeHostSession,
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
		const activeSessionHost = new RuntimeActiveSessionHost<CodingAgentRuntimeSessionOptions, RuntimeHostSession>({
			runtime: {
				sessions: {
					create: async (nextOptions) => {
						const created = await runtimeHost.createSession(
							toRuntimeHostSessionConfig(runtime!, nextOptions, scenario),
						);
						return runtimeHost.getSessionView(created.sessionId);
					},
					resume: async (nextOptions) => {
						const sessionPath = resolveConversationFilePath(options.conversationDir, nextOptions.sessionId);
						const created = await runtimeHost.createSession(
							toRuntimeHostSessionConfig(runtime!, nextOptions, scenario, sessionPath),
						);
						return runtimeHost.getSessionView(created.sessionId);
					},
				},
				sessionHooks: runtime.sessionHooks,
				quiesceSessionBackgroundCommands: (sessionId) => runtime!.quiesceSessionBackgroundCommands(sessionId),
				preserveSessionExecutionContext: (sourceSessionId, targetSessionId) =>
					runtime!.preserveSessionExecutionContext(sourceSessionId, targetSessionId),
			},
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
			createSessionSetupInitializer: (setup) =>
				createCodingAgentSessionSetupSeedInitializer(setup, {
					createEntryId: randomUUID,
					now: Date.now,
					createSeedDraft: createConversationSeedDraft,
				}),
			fork: (entryId) => activeSessionHost.fork(entryId),
			navigateTree: (targetId, navigateOptions) => branchNavigationHost.navigateTree(targetId, navigateOptions),
			switchSession: (targetPath) => activeSessionHost.switchSession(targetPath),
			reload: () => activeSessionHost.runActiveSessionMutation(() => resourceReloadHost.reload()),
		});
		extensionSessionHost.bindCommandContext(extensionCommandActions);
		const sessionHost = new CliCodingAgentProcessSessionHost({
			runtime,
			runtimeHost,
			activeSessionHost,
			extensionSessionHost,
			mcpSource: managedMcpSource,
			readRetrySettings: () => bootstrap.settingsManager.getRetrySettings(),
			setRetryEnabled: (enabled) => bootstrap.settingsManager.setRetryEnabled(enabled),
		});
		dismissActiveSessionRollback();
		dismissRuntimeHostRollback();
		dismissRuntimeRollback();
		dismissMcpRollback();
		dismissExtensionRollback();
		rollback.commit();
		return {
			runtime,
			runtimeHost,
			sessionHost,
			extensionSessionHost,
			dispose: async () => {
				await sessionHost.dispose();
			},
		};
	} catch (error) {
		return rollback.rollback(error, CLI_RUNTIME_HOST_STARTUP_FAILURE);
	}
}

function toRuntimeHostSessionConfig(
	runtime: CodingAgentRuntimeComposition,
	options: CodingAgentRuntimeSessionOptions,
	scenario: CodingAgentRuntimeComposition["scenario"],
	sessionPath?: string,
) {
	return createCodingAgentRuntimeHostSessionConfig(
		runtime.agentRuntime,
		{ ...options, scenario },
		{
			...(sessionPath ? { sessionPath } : {}),
		},
	);
}

function resolvePositiveInteger(value: string | undefined): number | undefined {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isInteger(parsed) && parsed >= 1 ? parsed : undefined;
}
