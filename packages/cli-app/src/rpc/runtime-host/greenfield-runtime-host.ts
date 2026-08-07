import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import {
	type CodingAgentExtensionEventCompatibilityProfile,
	createCodingAgentHostBootstrap,
	prepareCodingAgentPrintInvocation,
	resolveCodingAgentGreenfieldExtensionCompatibility,
	resolveCodingAgentInitialModel,
	runPrintMode,
} from "@vetta/coding-agent/bootstrap";
import { runRpcModeWithCapabilities } from "@vetta/coding-agent/rpc";
import { InitializationRollbackScope } from "@vetta/runtime-core";
import { resolveSessionIdFromPath } from "@vetta/runtime-storage/conversation";
import { GreenfieldPrintSessionAdapter } from "../../greenfield-print-session-adapter.js";
import { migrateGreenfieldImLegacySession } from "../greenfield-im-legacy-session-migration.js";
import { resolveGreenfieldImSessionPath } from "../greenfield-im-session-selection.js";
import {
	createGreenfieldCliSessionAssembly,
	GREENFIELD_RUNTIME_HOST_STARTUP_FAILURE,
	type GreenfieldCliSessionAssembly,
} from "./greenfield-cli-session-assembly.js";
import { createGreenfieldRpcRuntimeCapabilities } from "./greenfield-rpc-runtime-capabilities.js";
import type {
	CreateGreenfieldImRuntimeHostOptions,
	GreenfieldPrintRuntimeHostPreparation,
	GreenfieldPrintRuntimeHostReady,
	GreenfieldRpcRuntimeHostPreparation,
	GreenfieldRpcRuntimeHostReady,
	PrepareGreenfieldRuntimeHostOptions,
} from "./greenfield-runtime-host-contract.js";

export type {
	CreateGreenfieldImRuntimeHostOptions,
	GreenfieldPrintRuntimeHostPreparation,
	GreenfieldPrintRuntimeHostReady,
	GreenfieldRpcRuntimeHostExtensionIncompatible,
	GreenfieldRpcRuntimeHostPreparation,
	GreenfieldRpcRuntimeHostReady,
	GreenfieldRpcRuntimeHostSessionIncompatible,
	PrepareGreenfieldRuntimeHostOptions,
} from "./greenfield-runtime-host-contract.js";

export const GREENFIELD_IM_EXTENSION_EVENT_PROFILE = {
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

/** 构建显式 opt-in 的 Greenfield IM Runtime Host。 */
export async function createGreenfieldImRuntimeHost(
	options: CreateGreenfieldImRuntimeHostOptions,
): Promise<GreenfieldRpcRuntimeHostPreparation> {
	const bootstrap = await createCodingAgentHostBootstrap(options);
	return prepareGreenfieldImRuntimeHost({ ...options, bootstrap });
}

export async function prepareGreenfieldImRuntimeHost(
	options: PrepareGreenfieldRuntimeHostOptions,
): Promise<GreenfieldRpcRuntimeHostPreparation> {
	return prepareGreenfieldRuntimeHost(options, "greenfield-im", "rpc");
}

export async function prepareGreenfieldRpcRuntimeHost(
	options: PrepareGreenfieldRuntimeHostOptions,
): Promise<GreenfieldRpcRuntimeHostPreparation> {
	return prepareGreenfieldRuntimeHost(options, "greenfield", "rpc");
}

export async function prepareGreenfieldPrintRuntimeHost(
	options: PrepareGreenfieldRuntimeHostOptions,
): Promise<GreenfieldPrintRuntimeHostPreparation> {
	return prepareGreenfieldRuntimeHost(options, "greenfield", "print");
}

async function prepareGreenfieldRuntimeHost(
	options: PrepareGreenfieldRuntimeHostOptions,
	backend: "greenfield-im",
	intent: "rpc",
): Promise<GreenfieldRpcRuntimeHostPreparation>;
async function prepareGreenfieldRuntimeHost(
	options: PrepareGreenfieldRuntimeHostOptions,
	backend: "greenfield",
	intent: "rpc",
): Promise<GreenfieldRpcRuntimeHostPreparation>;
async function prepareGreenfieldRuntimeHost(
	options: PrepareGreenfieldRuntimeHostOptions,
	backend: "greenfield",
	intent: "print",
): Promise<GreenfieldPrintRuntimeHostPreparation>;
async function prepareGreenfieldRuntimeHost(
	options: PrepareGreenfieldRuntimeHostOptions,
	backend: "greenfield" | "greenfield-im",
	intent: "rpc" | "print",
): Promise<GreenfieldRpcRuntimeHostPreparation | GreenfieldPrintRuntimeHostPreparation> {
	const { bootstrap } = options;
	const { parsed } = bootstrap;
	assertGreenfieldInvocation(bootstrap, backend, intent);

	const extensionCompatibility = resolveCodingAgentGreenfieldExtensionCompatibility(bootstrap.extensionCompatibility, {
		actions: true,
		eventProfile: GREENFIELD_IM_EXTENSION_EVENT_PROFILE,
		tools: true,
		commands: true,
		inapplicableRuntimeCapabilities: ["shortcut", "message-renderer"],
	});
	if (extensionCompatibility.requiresLegacyRuntime) {
		return {
			kind: "extension-incompatible",
			bootstrap,
			sessionPath: parsed.session,
			extensionCompatibility,
		};
	}

	let sessionPath = await resolveGreenfieldImSessionPath({
		explicitSessionPath: parsed.session,
		continueSession: parsed.continue === true,
		cwd: bootstrap.cwd,
		sessionDir: options.conversationDir,
		sessionCatalog: options.sessionCatalog,
	});
	let sessionId = resolveSessionId(options.conversationDir, sessionPath, options.createSessionId ?? randomUUID);
	if (!sessionId) {
		if (!sessionPath) throw new Error("Historical session import requires a source path");
		const migration = await migrateGreenfieldImLegacySession(sessionPath, options.conversationDir);
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
	if (!initial.model) throw new Error("No models available for Greenfield Runtime");
	if (parsed.apiKey) bootstrap.authStorage.setRuntimeApiKey(initial.model.provider, parsed.apiKey);

	const assembly = await createGreenfieldCliSessionAssembly({
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
		return createGreenfieldPrintRuntimeHostReady(bootstrap, assembly);
	}
	const capabilities = await createGreenfieldRpcRuntimeCapabilities({
		bootstrap,
		assembly,
		backend,
		htmlExporter: options.htmlExporter,
	});
	return {
		kind: "greenfield",
		bootstrap,
		get session() {
			return assembly.sessionHost.readSession();
		},
		runtime: assembly.runtime,
		capabilities,
	};
}

export async function runGreenfieldImRuntimeHost(prepared: GreenfieldRpcRuntimeHostReady): Promise<never> {
	return runRpcModeWithCapabilities(prepared.capabilities, { enableHostBridge: true });
}

export async function runGreenfieldRpcRuntimeHost(prepared: GreenfieldRpcRuntimeHostReady): Promise<never> {
	return runRpcModeWithCapabilities(prepared.capabilities, {
		enableHostBridge: prepared.bootstrap.parsed.enableHostBridge === true,
	});
}

export async function runGreenfieldPrintRuntimeHost(prepared: GreenfieldPrintRuntimeHostReady): Promise<void> {
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

async function createGreenfieldPrintRuntimeHostReady(
	bootstrap: PrepareGreenfieldRuntimeHostOptions["bootstrap"],
	assembly: GreenfieldCliSessionAssembly,
): Promise<GreenfieldPrintRuntimeHostReady> {
	const rollback = new InitializationRollbackScope();
	const dismissAssemblyRollback = rollback.defer({
		id: "cli-session-assembly",
		rollback: () => assembly.dispose(),
	});
	try {
		const printSession = new GreenfieldPrintSessionAdapter({ sessionHost: assembly.sessionHost });
		dismissAssemblyRollback();
		rollback.commit();
		return {
			kind: "greenfield-print",
			bootstrap,
			get session() {
				return assembly.sessionHost.readSession();
			},
			runtime: assembly.runtime,
			printSession,
		};
	} catch (error) {
		return rollback.rollback(error, GREENFIELD_RUNTIME_HOST_STARTUP_FAILURE);
	}
}

function assertGreenfieldInvocation(
	bootstrap: PrepareGreenfieldRuntimeHostOptions["bootstrap"],
	backend: "greenfield" | "greenfield-im",
	intent: "rpc" | "print",
): void {
	const { parsed } = bootstrap;
	if (intent === "rpc" && parsed.mode !== "rpc") throw new Error("Greenfield Runtime requires --mode rpc");
	if (intent === "print" && parsed.mode === "rpc") throw new Error("Greenfield Print does not support RPC mode");
	if (intent === "print" && backend === "greenfield-im")
		throw new Error("Greenfield IM Runtime only supports RPC mode");
	if (backend === "greenfield-im" && !parsed.enableHostBridge) {
		throw new Error("Greenfield IM Runtime requires --enable-host-bridge");
	}
	if (parsed.resume) throw new Error("--resume is no longer supported; use --continue or --session");
	if (backend === "greenfield-im" && parsed.scenario && parsed.scenario !== "im-claw") {
		throw new Error(`Greenfield IM Runtime requires scenario im-claw, received ${parsed.scenario}`);
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
		throw new Error(`Invalid Greenfield conversation path: ${sessionPath}`);
	}
	if (extname(sessionPath) === ".jsonl") return undefined;
	throw new Error(`Unsupported session path: ${sessionPath}`);
}
