import type { CodingAgentExtensionCompatibilityAssessment } from "@vetta/coding-agent/bootstrap";
import type { RpcExtensionIncompatibilityFailure } from "@vetta/coding-agent/rpc";

export class ExtensionCompatibilityError extends Error {
	readonly errorCode = "extension_incompatible";
	readonly unsupportedEvents: readonly string[];
	readonly unmetRuntimeCapabilities: readonly string[];

	constructor(assessment: CodingAgentExtensionCompatibilityAssessment) {
		super("Extension requires events or runtime capabilities that are not supported by this runtime");
		this.name = "ExtensionCompatibilityError";
		this.unsupportedEvents = [...assessment.unsupportedEvents];
		this.unmetRuntimeCapabilities = [...assessment.unmetRuntimeCapabilities];
	}

	toRpcStartupFailure(): RpcExtensionIncompatibilityFailure {
		return {
			type: "response",
			command: "startup",
			success: false,
			errorCode: this.errorCode,
			phase: "startup",
			recoverability: "user_action",
			error: this.message,
			unsupportedEvents: [...this.unsupportedEvents],
			unmetRuntimeCapabilities: [...this.unmetRuntimeCapabilities],
		};
	}
}
