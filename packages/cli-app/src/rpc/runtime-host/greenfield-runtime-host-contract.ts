import type {
	CodingAgentExtensionCompatibilityAssessment,
	CodingAgentHostBootstrap,
	CodingAgentHostBootstrapOptions,
} from "@vetta/coding-agent/bootstrap";
import type {
	CodingAgentRuntimeComposition as GreenfieldRuntimeComposition,
	CodingAgentRuntimeCompositionOptions as GreenfieldRuntimeCompositionOptions,
} from "@vetta/coding-agent/composition";
import type { CodingAgentHtmlExportRuntime } from "@vetta/coding-agent/export-html";
import type { RpcRuntimeDecision, RpcSessionCapabilities } from "@vetta/coding-agent/rpc";
import type { GreenfieldRuntimeSession, RuntimeSessionCatalog } from "@vetta/runtime-core";
import type { FileConversationOwnershipManagerOptions } from "@vetta/runtime-storage/conversation";
import type { GreenfieldPrintSessionAdapter } from "../../greenfield-print-session-adapter.js";
import type { GreenfieldImLegacySessionMigrationIncompatible } from "../greenfield-im-legacy-session-migration.js";

export interface GreenfieldRpcRuntimeHostExtensionIncompatible {
	readonly kind: "extension-incompatible";
	readonly bootstrap: CodingAgentHostBootstrap;
	readonly sessionPath: string | undefined;
	readonly extensionCompatibility: CodingAgentExtensionCompatibilityAssessment;
}

export interface GreenfieldRpcRuntimeHostSessionIncompatible {
	readonly kind: "session-incompatible";
	readonly bootstrap: CodingAgentHostBootstrap;
	readonly sessionPath: string;
	readonly sessionCompatibility: GreenfieldImLegacySessionMigrationIncompatible;
}

export interface GreenfieldRpcRuntimeHostReady {
	readonly kind: "greenfield";
	readonly bootstrap: CodingAgentHostBootstrap;
	readonly session: GreenfieldRuntimeSession;
	readonly runtime: GreenfieldRuntimeComposition;
	readonly capabilities: RpcSessionCapabilities;
	readonly runtimeDecision: RpcRuntimeDecision;
}

export type GreenfieldRpcRuntimeHostPreparation =
	| GreenfieldRpcRuntimeHostExtensionIncompatible
	| GreenfieldRpcRuntimeHostSessionIncompatible
	| GreenfieldRpcRuntimeHostReady;

export interface GreenfieldPrintRuntimeHostReady {
	readonly kind: "greenfield-print";
	readonly bootstrap: CodingAgentHostBootstrap;
	readonly session: GreenfieldRuntimeSession;
	readonly runtime: GreenfieldRuntimeComposition;
	readonly printSession: GreenfieldPrintSessionAdapter;
	readonly runtimeDecision: RpcRuntimeDecision;
}

export type GreenfieldPrintRuntimeHostPreparation =
	| GreenfieldRpcRuntimeHostExtensionIncompatible
	| GreenfieldRpcRuntimeHostSessionIncompatible
	| GreenfieldPrintRuntimeHostReady;

export interface PrepareGreenfieldRuntimeHostOptions {
	readonly bootstrap: CodingAgentHostBootstrap;
	readonly conversationDir: string;
	readonly sessionCatalog: RuntimeSessionCatalog;
	readonly requestedBackend?: RpcRuntimeDecision["requestedBackend"];
	readonly htmlExporter?: CodingAgentHtmlExportRuntime;
	readonly createSessionId?: () => string;
	readonly ownership?: FileConversationOwnershipManagerOptions;
	readonly createPluginRuntime?: GreenfieldRuntimeCompositionOptions["createPluginRuntime"];
}

export interface CreateGreenfieldImRuntimeHostOptions
	extends Omit<PrepareGreenfieldRuntimeHostOptions, "bootstrap">,
		CodingAgentHostBootstrapOptions {}
