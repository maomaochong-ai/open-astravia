import {
	ConverseStreamCommand,
	type ConverseStreamCommandInput,
	type ConverseStreamCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";
import {
	AIAbortedError,
	type AssistantMessage,
	createAssistantMessage as createProtocolAssistantMessage,
} from "../../protocol/index.js";
import { EmptyProviderStreamError, normalizeProviderError, validateWirePayload } from "../../provider-kit/index.js";
import {
	failLanguageModelStream,
	type LanguageModelAdapter,
	LanguageModelStream,
	type ModelCallRequest,
	type ModelStreamResponse,
} from "../../runtime/language-model-adapter.js";
import { createModelCallMetadataFromMessage } from "../../runtime/model-call-result.js";
import type { Model } from "../../types.js";
import { createBedrockClient } from "./client.js";
import { BedrockEventReducer } from "./events.js";
import type { BedrockOptions } from "./options.js";
import { buildBedrockCommandInput } from "./request.js";
import { bedrockConverseStreamEventSchema } from "./response-schema.js";

export type BedrockCommandSender = (
	input: ConverseStreamCommandInput,
	options: BedrockOptions,
) => Promise<Pick<ConverseStreamCommandOutput, "stream">>;

export interface BedrockAdapterDependencies {
	readonly send?: BedrockCommandSender;
}

export const bedrockAdapter = createBedrockAdapter();

export function createBedrockAdapter(
	dependencies: BedrockAdapterDependencies = {},
): LanguageModelAdapter<"bedrock-converse-stream", BedrockOptions> {
	return {
		api: "bedrock-converse-stream",
		capabilities: {
			streaming: true,
			tools: true,
			structuredOutput: false,
			reasoning: true,
			parallelToolCalls: true,
		},
		async stream(request) {
			return createBedrockModelStream(request, dependencies.send ?? sendBedrockCommand);
		},
	};
}

function createBedrockModelStream(
	request: ModelCallRequest<"bedrock-converse-stream", BedrockOptions>,
	send: BedrockCommandSender,
): ModelStreamResponse {
	const stream = new LanguageModelStream();
	void produceBedrockStream(request, send, stream);
	const result = stream.result();
	return { events: stream, result, metadata: result.then(createModelCallMetadataFromMessage, () => ({})) };
}

async function produceBedrockStream(
	request: ModelCallRequest<"bedrock-converse-stream", BedrockOptions>,
	send: BedrockCommandSender,
	stream: LanguageModelStream,
): Promise<void> {
	const { model, context, options = {} } = request;
	const output = createAssistantMessage(model);
	try {
		if (options.signal?.aborted) throw new AIAbortedError();
		const commandInput = buildBedrockCommandInput(model, context, options);
		options.onPayload?.(commandInput);
		const response = await send(commandInput, options);
		if (!response.stream) throw new EmptyProviderStreamError();
		const reducer = new BedrockEventReducer(output, stream, model);
		let receivedProviderEvent = false;
		for await (const item of response.stream) {
			receivedProviderEvent = true;
			validateWirePayload(bedrockConverseStreamEventSchema, item, {
				provider: model.provider,
				payloadType: "Amazon Bedrock Converse stream event",
			});
			reducer.consume(item);
		}
		if (!receivedProviderEvent) throw new EmptyProviderStreamError();
		reducer.finish();
		if (options.signal?.aborted) throw new AIAbortedError();
		if (output.stopReason === "error" || output.stopReason === "aborted") {
			throw new Error("Amazon Bedrock returned a failed response status");
		}
		stream.push({ type: "done", reason: output.stopReason, message: output });
	} catch (error) {
		failLanguageModelStream(
			stream,
			model,
			options.signal?.aborted
				? new AIAbortedError(undefined, { provider: model.provider, modelId: model.id, cause: error })
				: normalizeProviderError(error, model),
			options.signal?.aborted ? "aborted" : "error",
			{
				...output,
				stopReason: options.signal?.aborted ? "aborted" : "error",
				errorMessage: error instanceof Error ? error.message : String(error),
			},
		);
	}
}

async function sendBedrockCommand(
	input: ConverseStreamCommandInput,
	options: BedrockOptions,
): Promise<Pick<ConverseStreamCommandOutput, "stream">> {
	const client = await createBedrockClient(options);
	return await client.send(new ConverseStreamCommand(input), { abortSignal: options.signal });
}

function createAssistantMessage(model: Model<"bedrock-converse-stream">): AssistantMessage {
	return createProtocolAssistantMessage({ api: model.api, provider: model.provider, model: model.id });
}
