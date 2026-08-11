import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import {
	type CodingAgentExtensionEventCompatibilityProfile,
	createCodingAgentHostBootstrap,
	prepareCodingAgentPrintInvocation,
	resolveCodingAgentExtensionCompatibility,
	resolveCodingAgentInitialModel,
	runPrintMode,
} from "@vetta/coding-agent/bootstrap";
import { migrateCodingAgentHistoricalSession } from "@vetta/coding-agent/historical-sessions";
import { runRpcModeWithCapabilities } from "@vetta/coding-agent/rpc";
import { InitializationRollbackScope } from "@vetta/runtime-core";
import { resolveSessionIdFromPath } from "@vetta/runtime-storage/conversation";
import { CliPrintSessionAdapter } from "../../print-session-adapter.js";
import { resolveImSessionPath } from "../im-session-selection.js";
import {
	CLI_RUNTIME_HOST_STARTUP_FAILURE,
	type CliSessionAssembly,
	createCliSessionAssembly,
} from "./cli-session-assembly.js";
import { createRpcRuntimeCapabilities } from "./rpc-runtime-capabilities.js";
import type {
	CreateImRuntimeHostOptions,
	PrepareRuntimeHostOptions,
	PrintRuntimeHostPreparation,
	PrintRuntimeHostReady,
	RpcRuntimeHostPreparation,
	RpcRuntimeHostReady,
} from "./runtime-host-contract.js";

export type {
	CreateImRuntimeHostOptions,
	PrepareRuntimeHostOptions,
	PrintRuntimeHostPreparation,
	PrintRuntimeHostReady,
	RpcRuntimeHostExtensionIncompatible,
	RpcRuntimeHostPreparation,
	RpcRuntimeHostReady,
	RpcRuntimeHostSessionIncompatible,
} from "./runtime-host-contract.js";

export const CLI_EXTENSION_EVENT_COMPATIBILITY_PROFILE = {
	input: "supported",
	before_agent_start: "supported",
	resources_discover: "supported",
	session_start: "supported",
	session_shutdown: "supported",
	session_before_switch: "supported",
	session_switch: "supported",
	session_before_fork: "supported",
	session_fork: "supported",
	session_before_tree: "supported",
	session_tree: "supported",
	session_before_compact: "supported",
	session_compact: "supported",
	agent_start: "supported",
	agent_end: "supported",
	turn_start: "supported",
	turn_end: "supported",
	message_start: "supported",
	message_update: "supported",
	message_end: "supported",
	context: "supported",
	tool_call: "supported",
	tool_result: "supported",
	tool_execution_start: "supported",
	tool_execution_update: "supported",
	tool_execution_phase: "supported",
	tool_execution_end: "supported",
	model_select: "supported",
	user_bash: "inapplicable",
} as const satisfies CodingAgentExtensionEventCompatibilityProfile;

/** 构建启用 Host Bridge 的 IM Runtime Host。 */
export async function createImRuntimeHost(options: CreateImRuntimeHostOptions): Promise<RpcRuntimeHostPreparation> {
	const bootstrap = await createCodingAgentHostBootstrap(options);
	return prepareImRuntimeHost({ ...options, bootstrap });
}

export async function prepareImRuntimeHost(options: PrepareRuntimeHostOptions): Promise<RpcRuntimeHostPreparation> {
	return prepareRuntimeHost(options, "im", "rpc");
}

export async function prepareRpcRuntimeHost(options: PrepareRuntimeHostOptions): Promise<RpcRuntimeHostPreparation> {
	return prepareRuntimeHost(options, "rpc", "rpc");
}

export async function preparePrintRuntimeHost(
	options: PrepareRuntimeHostOptions,
): Promise<PrintRuntimeHostPreparation> {
	return prepareRuntimeHost(options, "rpc", "print");
}

async function prepareRuntimeHost(
	options: PrepareRuntimeHostOptions,
	backend: "im",
	intent: "rpc",
): Promise<RpcRuntimeHostPreparation>;
async function prepareRuntimeHost(
	options: PrepareRuntimeHostOptions,
	backend: "rpc",
	intent: "rpc",
): Promise<RpcRuntimeHostPreparation>;
async function prepareRuntimeHost(
	options: PrepareRuntimeHostOptions,
	backend: "rpc",
	intent: "print",
): Promise<PrintRuntimeHostPreparation>;
async function prepareRuntimeHost(
	options: PrepareRuntimeHostOptions,
	backend: "rpc" | "im",
	intent: "rpc" | "print",
): Promise<RpcRuntimeHostPreparation | PrintRuntimeHostPreparation> {
	const { bootstrap } = options;
	const { parsed } = bootstrap;
	assertRuntimeInvocation(bootstrap, backend, intent);

	const extensionCompatibility = resolveCodingAgentExtensionCompatibility(bootstrap.extensionRequirements, {
		runtimeActions: true,
		eventProfile: CLI_EXTENSION_EVENT_COMPATIBILITY_PROFILE,
		tools: true,
		commands: true,
		inapplicableRuntimeCapabilities: ["shortcut", "message-renderer"],
	});
	if (!extensionCompatibility.compatible) {
		return {
			kind: "extension-incompatible",
			bootstrap,
			sessionPath: parsed.session,
			extensionCompatibility,
		};
	}

	let sessionPath = await resolveImSessionPath({
		explicitSessionPath: parsed.session,
		continueSession: parsed.continue === true,
		cwd: bootstrap.cwd,
		sessionDir: options.conversationDir,
		sessionCatalog: options.sessionCatalog,
	});
	let sessionId = resolveSessionId(options.conversationDir, sessionPath, options.createSessionId ?? randomUUID);
	if (!sessionId) {
		if (!sessionPath) throw new Error("Historical session import requires a source path");
		const migration = await migrateCodingAgentHistoricalSession(sessionPath, options.conversationDir);
		if (migration.kind === "session-incompatible") {
			return {
				kind: "session-incompatible",
				bootstrap,
				sessionPath,
				sessionCompatibility: migration,
			};
		}
		sessionPath = migration.targetPath;
		sessionId = migration.targetSessionId;
	}

	const initial = await resolveCodingAgentInitialModel(bootstrap);
	if (initial.warning) console.warn(initial.warning);
	if (initial.error) throw new Error(initial.error);
	if (!initial.model) throw new Error("No models available for Agent Runtime");
	if (parsed.apiKey) bootstrap.authStorage.setRuntimeApiKey(initial.model.provider, parsed.apiKey);

	const assembly = await createCliSessionAssembly({
		bootstrap,
		conversationDir: options.conversationDir,
		sessionCatalog: options.sessionCatalog,
		sessionId,
		...(sessionPath ? { sessionPath } : {}),
		initialModel: initial.model,
		initialThinkingLevel: initial.thinkingLevel,
		backend,
		intent,
		createSessionId: options.createSessionId ?? randomUUID,
		ownership: options.ownership,
		createPluginRuntime: options.createPluginRuntime,
	});
	if (intent === "print") {
		return createPrintRuntimeHostReady(bootstrap, assembly);
	}
	const capabilities = await createRpcRuntimeCapabilities({
		bootstrap,
		assembly,
		backend,
		htmlExporter: options.htmlExporter,
	});
	return {
		kind: "rpc",
		bootstrap,
		get session() {
			return assembly.sessionHost.readSession();
		},
		runtime: assembly.runtime,
		capabilities,
	};
}

export async function runImRuntimeHost(prepared: RpcRuntimeHostReady): Promise<never> {
	return runRpcModeWithCapabilities(prepared.capabilities, { enableHostBridge: true });
}

export async function runRpcRuntimeHost(prepared: RpcRuntimeHostReady): Promise<never> {
	return runRpcModeWithCapabilities(prepared.capabilities, {
		enableHostBridge: prepared.bootstrap.parsed.enableHostBridge === true,
	});
}

export async function runPrintRuntimeHost(prepared: PrintRuntimeHostReady): Promise<void> {
	try {
		const invocation = await prepareCodingAgentPrintInvocation({
			parsed: prepared.bootstrap.parsed,
			autoResizeImages: prepared.bootstrap.settingsManager.getImageAutoResize(),
		});
		if (invocation.kind === "interactive-unsupported") {
			throw new Error("交互式终端模式已移除。请使用 --print 进行单次执行，或使用 Vetta 桌面应用。");
		}
		await runPrintMode(prepared.printSession, invocation.options);
	} finally {
		await prepared.printSession.dispose();
	}
}

async function createPrintRuntimeHostReady(
	bootstrap: PrepareRuntimeHostOptions["bootstrap"],
	assembly: CliSessionAssembly,
): Promise<PrintRuntimeHostReady> {
	const rollback = new InitializationRollbackScope();
	const dismissAssemblyRollback = rollback.defer({
		id: "cli-session-assembly",
		rollback: () => assembly.dispose(),
	});
	try {
		const printSession = new CliPrintSessionAdapter({ sessionHost: assembly.sessionHost });
		dismissAssemblyRollback();
		rollback.commit();
		return {
			kind: "print",
			bootstrap,
			get session() {
				return assembly.sessionHost.readSession();
			},
			runtime: assembly.runtime,
			printSession,
		};
	} catch (error) {
		return rollback.rollback(error, CLI_RUNTIME_HOST_STARTUP_FAILURE);
	}
}

function assertRuntimeInvocation(
	bootstrap: PrepareRuntimeHostOptions["bootstrap"],
	backend: "rpc" | "im",
	intent: "rpc" | "print",
): void {
	const { parsed } = bootstrap;
	if (intent === "rpc" && parsed.mode !== "rpc") throw new Error("Agent Runtime requires --mode rpc");
	if (intent === "print" && parsed.mode === "rpc") throw new Error("Print Runtime does not support RPC mode");
	if (intent === "print" && backend === "im") throw new Error("IM Runtime only supports RPC mode");
	if (backend === "im" && !parsed.enableHostBridge) {
		throw new Error("IM Runtime requires --enable-host-bridge");
	}
	if (parsed.resume) throw new Error("--resume is no longer supported; use --continue or --session");
	if (backend === "im" && parsed.scenario && parsed.scenario !== "im-claw") {
		throw new Error(`IM Runtime requires scenario im-claw, received ${parsed.scenario}`);
	}
}

function resolveSessionId(
	conversationDir: string,
	sessionPath: string | undefined,
	createSessionId: () => string,
): string | undefined {
	if (!sessionPath) return createSessionId();
	const sessionId = resolveSessionIdFromPath(conversationDir, sessionPath);
	if (sessionId) return sessionId;
	if (sessionPath.endsWith(".conversation.jsonl")) {
		throw new Error(`Invalid Runtime conversation path: ${sessionPath}`);
	}
	if (extname(sessionPath) === ".jsonl") return undefined;
	throw new Error(`Unsupported session path: ${sessionPath}`);
}
