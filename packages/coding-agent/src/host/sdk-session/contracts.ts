import type { CodingAgentAuthRuntime } from "../../auth/index.js";
import type { CodingAgentHtmlExportRuntime } from "../../export-html/index.js";
import type { LoadExtensionsResult } from "../../extensions/index.js";
import type { CodingAgentModelRuntime } from "../../models/index.js";
import type { CodingAgentSession } from "../../public-api/sdk/sdk-session-contract.js";
import type { SettingsRuntime } from "../../settings/index.js";

export const CODING_AGENT_SDK_HOST_ERROR_CODES = {
	NO_MODEL: "coding_agent_sdk_no_model",
} as const;

export type CodingAgentSdkHostErrorCode =
	(typeof CODING_AGENT_SDK_HOST_ERROR_CODES)[keyof typeof CODING_AGENT_SDK_HOST_ERROR_CODES];

export class CodingAgentSdkHostError extends Error {
	constructor(
		readonly code: CodingAgentSdkHostErrorCode,
		message: string,
	) {
		super(message);
		this.name = "CodingAgentSdkHostError";
	}
}

export interface CodingAgentSdkPublicHostContext {
	readonly authStorage?: CodingAgentAuthRuntime;
	readonly htmlExporter?: CodingAgentHtmlExportRuntime;
	readonly modelRegistry?: CodingAgentModelRuntime;
	readonly settingsManager?: SettingsRuntime;
	readonly onSessionClosed?: () => void;
}

export interface CodingAgentSdkSessionCompositionResult {
	readonly session: CodingAgentSession;
	readonly extensionsResult: LoadExtensionsResult;
	readonly modelFallbackMessage?: string;
}
