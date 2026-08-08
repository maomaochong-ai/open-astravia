import type {
	CodingAgentExtensionCompatibilityAssessment,
	CodingAgentHostBootstrap,
	CodingAgentHostBootstrapOptions,
} from "@vetta/coding-agent/bootstrap";
import type {
	CodingAgentRuntimeComposition,
	CodingAgentRuntimeCompositionOptions,
} from "@vetta/coding-agent/composition";
import type { CodingAgentHtmlExportRuntime } from "@vetta/coding-agent/export-html";
import type { CodingAgentHistoricalSessionMigrationIncompatible } from "@vetta/coding-agent/historical-sessions";
import type { RpcSessionCapabilities } from "@vetta/coding-agent/rpc";
import type { RuntimeSession, RuntimeSessionCatalog } from "@vetta/runtime-core";
import type { FileConversationOwnershipManagerOptions } from "@vetta/runtime-storage/conversation";
import type { CliPrintSessionAdapter } from "../../print-session-adapter.js";

export interface RpcRuntimeHostExtensionIncompatible {
	readonly kind: "extension-incompatible";
	readonly bootstrap: CodingAgentHostBootstrap;
	readonly sessionPath: string | undefined;
	readonly extensionCompatibility: CodingAgentExtensionCompatibilityAssessment;
}

export interface RpcRuntimeHostSessionIncompatible {
	readonly kind: "session-incompatible";
	readonly bootstrap: CodingAgentHostBootstrap;
	readonly sessionPath: string;
	readonly sessionCompatibility: CodingAgentHistoricalSessionMigrationIncompatible;
}

export interface RpcRuntimeHostReady {
	readonly kind: "rpc";
	readonly bootstrap: CodingAgentHostBootstrap;
	readonly session: RuntimeSession;
	readonly runtime: CodingAgentRuntimeComposition;
	readonly capabilities: RpcSessionCapabilities;
}

export type RpcRuntimeHostPreparation =
	| RpcRuntimeHostExtensionIncompatible
	| RpcRuntimeHostSessionIncompatible
	| RpcRuntimeHostReady;

export interface PrintRuntimeHostReady {
	readonly kind: "print";
	readonly bootstrap: CodingAgentHostBootstrap;
	readonly session: RuntimeSession;
	readonly runtime: CodingAgentRuntimeComposition;
	readonly printSession: CliPrintSessionAdapter;
}

export type PrintRuntimeHostPreparation =
	| RpcRuntimeHostExtensionIncompatible
	| RpcRuntimeHostSessionIncompatible
	| PrintRuntimeHostReady;

export interface PrepareRuntimeHostOptions {
	readonly bootstrap: CodingAgentHostBootstrap;
	readonly conversationDir: string;
	readonly sessionCatalog: RuntimeSessionCatalog;
	readonly htmlExporter?: CodingAgentHtmlExportRuntime;
	readonly createSessionId?: () => string;
	readonly ownership?: FileConversationOwnershipManagerOptions;
	readonly createPluginRuntime?: CodingAgentRuntimeCompositionOptions["createPluginRuntime"];
}

export interface CreateImRuntimeHostOptions
	extends Omit<PrepareRuntimeHostOptions, "bootstrap">,
		CodingAgentHostBootstrapOptions {}
