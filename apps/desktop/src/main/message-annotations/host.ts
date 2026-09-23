import { type Message, streamSimple } from "@vetta/ai";
import { getOrCreateSharedModelRuntime } from "../agent-runtime/host-services.js";
import { getSharedRuntime } from "../runtime.js";
import { ANNOTATION_SYSTEM_PROMPT } from "./context.js";
import { MessageAnnotationService } from "./service.js";

let service: MessageAnnotationService | undefined;

export function getMessageAnnotationService(): MessageAnnotationService {
	service ??= new MessageAnnotationService({
		source(runtimeId) {
			const runtime = getSharedRuntime();
			const path = runtime.getSessionPath(runtimeId);
			if (!path) throw new Error("Session is not available");
			const model = runtime.getState(runtimeId).model;
			if (!model) throw new Error("Session model is unavailable");
			return {
				path,
				modelKey: `${model.provider}/${model.id}`,
				get history() {
					return runtime.getFullHistory(runtimeId);
				},
			};
		},
		async complete(note, modelKey, signal, onText) {
			const models = getOrCreateSharedModelRuntime();
			const model = models.getAvailable().find((entry) => `${entry.provider}/${entry.id}` === modelKey);
			if (!model) throw new Error("Annotation model is unavailable");
			const apiKey = await models.getApiKey(model);
			if (!apiKey) throw new Error("Annotation model credentials are unavailable");
			const messages: Message[] = [
				{
					role: "user",
					timestamp: Date.now(),
					content: JSON.stringify({ referenceConversation: note.context, quotedPassage: note.quote }),
				},
			];
			for (const turn of note.turns) {
				messages.push({ role: "user", content: turn.question, timestamp: Date.now() });
				if (turn.answer)
					messages.push({
						role: "assistant",
						content: [{ type: "text", text: turn.answer }],
						api: model.api,
						provider: model.provider,
						model: model.id,
						stopReason: "stop",
						timestamp: Date.now(),
						usage: {
							input: 0,
							output: 0,
							totalTokens: 0,
							cacheRead: 0,
							cacheWrite: 0,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
						},
					});
			}
			const stream = streamSimple(
				model,
				{ systemPrompt: ANNOTATION_SYSTEM_PROMPT, messages },
				{ apiKey, signal: AbortSignal.any([signal, AbortSignal.timeout(180000)]) },
			);
			let answer = "";
			for await (const event of stream) {
				if (event.type !== "text_delta") continue;
				answer += event.delta;
				onText(answer);
			}
			const result = await stream.result();
			if (result.stopReason !== "stop" && result.stopReason !== "length")
				throw new Error("Annotation completion failed");
			return {
				answer: result.content
					.filter((block) => block.type === "text")
					.map((block) => block.text)
					.join(""),
				stopReason: result.stopReason,
				usage: { input: result.usage.input, output: result.usage.output, totalTokens: result.usage.totalTokens },
			};
		},
	});
	return service;
}

export async function forgetMessageAnnotations(sessionPath: string): Promise<void> {
	await getMessageAnnotationService().forget(sessionPath);
}
