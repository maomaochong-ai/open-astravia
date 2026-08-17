import type { PromptRequest, RuntimePromptAdapter } from "@vetta/runtime-core";
import type {
	RuntimeInputRequestPreparationContext,
	RuntimeInputRequestPreparationResult,
	RuntimeInputRequestPreparer,
	RuntimeSnapshotAcquireContext,
	SessionInputRequest,
} from "@vetta/runtime-core/kernel";
import {
	DefaultCodingAgentPromptRequestRuntime,
	type DefaultCodingAgentPromptRequestRuntimeOptions,
} from "../../model-context/prompt-request-runtime.js";
import type { CodingAgentPromptRequestRuntime } from "../../runtime-contracts/index.js";

export type {
	CodingAgentPromptResourceExpansion,
	CodingAgentPromptResourceResolver,
} from "../../runtime-contracts/index.js";

export type CodingAgentPromptRequestAdapterOptions =
	| DefaultCodingAgentPromptRequestRuntimeOptions
	| { readonly runtime: CodingAgentPromptRequestRuntime };

/** Maps Runtime prompt envelopes to the Coding Agent request policy. */
export class CodingAgentPromptRequestAdapter implements RuntimePromptAdapter, RuntimeInputRequestPreparer {
	private readonly runtime: CodingAgentPromptRequestRuntime;

	constructor(options: CodingAgentPromptRequestAdapterOptions = {}) {
		this.runtime = "runtime" in options ? options.runtime : new DefaultCodingAgentPromptRequestRuntime(options);
	}

	createRequest(request: PromptRequest): SessionInputRequest {
		return Object.freeze({
			payload: structuredClone(request),
			displayText: request.text,
			...(request.modelKey || request.reasoning
				? { model: { key: request.modelKey, reasoning: request.reasoning } }
				: {}),
		});
	}

	async bindForTurn(context: RuntimeSnapshotAcquireContext): Promise<RuntimeInputRequestPreparer> {
		const runtime = (await this.runtime.bindForTurn?.(context)) ?? this.runtime;
		return new CodingAgentPromptRequestAdapter({ runtime });
	}

	releaseTurnBinding(): Promise<void> | void {
		return this.runtime.releaseTurnBinding?.();
	}

	prepare(
		inputRequest: SessionInputRequest,
		context: RuntimeInputRequestPreparationContext,
	): Promise<RuntimeInputRequestPreparationResult> {
		return this.runtime.prepare(readPromptRequest(inputRequest.payload), context);
	}
}

function readPromptRequest(value: unknown): PromptRequest {
	if (typeof value !== "object" || value === null || !("text" in value) || typeof value.text !== "string") {
		throw new Error("Invalid Turn-bound Prompt request");
	}
	return value as PromptRequest;
}
