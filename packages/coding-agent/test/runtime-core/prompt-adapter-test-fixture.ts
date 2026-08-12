import type { PromptRequest } from "@vetta/runtime-core";
import type { RuntimeInputRequestPreparationResult, SessionInput } from "@vetta/runtime-core/kernel";
import type { CodingAgentPromptRequestAdapter } from "../../src/adapters/runtime-core/prompt-request-adapter.js";

export interface PromptAdapterTestContext {
	readonly sessionId: string;
	readonly queueing: boolean;
	readonly turnId?: string;
}

export async function admitPrompt(
	adapter: CodingAgentPromptRequestAdapter,
	request: PromptRequest,
	context: PromptAdapterTestContext,
): Promise<RuntimeInputRequestPreparationResult> {
	return adapter.prepare(adapter.createRequest(request), {
		sessionId: context.sessionId,
		turnId: context.turnId ?? `${context.sessionId}:turn-test`,
		queueing: context.queueing,
		signal: new AbortController().signal,
	});
}

export async function preparePrompt(
	adapter: CodingAgentPromptRequestAdapter,
	request: PromptRequest,
	context: PromptAdapterTestContext,
): Promise<{ readonly input: SessionInput }> {
	const result = await admitPrompt(adapter, request, context);
	if (result.action === "handled") throw new Error("Expected Prompt preparation to continue");
	return { input: result.input };
}
