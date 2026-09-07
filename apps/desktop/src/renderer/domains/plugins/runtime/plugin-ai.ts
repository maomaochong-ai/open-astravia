import type { PluginAiApi, PluginPermissionApi } from "@vetta-org/plugin-sdk";

export function createPluginAiApi(permissions: PluginPermissionApi, capabilitySessionId: string): PluginAiApi {
	const ai = window.vetta.plugins.internalCapabilities.ai;
	return {
		listModels: () => {
			permissions.require("ai.models.list");
			return ai.listModels(capabilitySessionId);
		},
		complete: (request) => {
			permissions.require("ai.complete");
			return ai.complete(capabilitySessionId, request);
		},
		stream: async (request, options = {}) => {
			permissions.require("ai.complete");
			if (options.signal?.aborted) throw abortError();
			const requestId = crypto.randomUUID();
			let text = "";
			let rejectListenerFailure: (error: unknown) => void = () => undefined;
			const listenerFailure = new Promise<never>((_resolve, reject) => {
				rejectListenerFailure = reject;
			});
			const unsubscribe = ai.onStreamEvent((payload) => {
				if (payload.sessionId !== capabilitySessionId || payload.requestId !== requestId) return;
				text += payload.event.delta;
				try {
					options.onTextDelta?.({ delta: payload.event.delta, text });
				} catch (error) {
					void ai.cancelStream(capabilitySessionId, requestId).catch(() => undefined);
					rejectListenerFailure(error);
				}
			});
			const cancel = (): void => {
				void ai.cancelStream(capabilitySessionId, requestId).catch(() => undefined);
			};
			options.signal?.addEventListener("abort", cancel, { once: true });
			try {
				return await Promise.race([ai.stream(capabilitySessionId, requestId, request), listenerFailure]);
			} finally {
				options.signal?.removeEventListener("abort", cancel);
				unsubscribe();
			}
		},
		chat: (request) => {
			permissions.require("ai.complete");
			return ai.chat(capabilitySessionId, request);
		},
	};
}

function abortError(): Error {
	const error = new Error("AI stream was aborted");
	error.name = "AbortError";
	return error;
}
