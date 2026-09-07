// @vitest-environment jsdom
import type { PluginPermissionApi } from "@vetta-org/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPluginAiApi } from "./plugin-ai";

describe("createPluginAiApi streaming", () => {
	const requirePermission = vi.fn();
	const listeners = new Set<
		(payload: {
			readonly sessionId: string;
			readonly requestId: string;
			readonly event: { readonly type: "text_delta"; readonly delta: string };
		}) => void
	>();
	const bridge = {
		listModels: vi.fn(),
		complete: vi.fn(),
		chat: vi.fn(),
		cancelStream: vi.fn(async () => undefined),
		onStreamEvent: vi.fn((listener: typeof listeners extends Set<infer Listener> ? Listener : never) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		}),
		stream: vi.fn(async (sessionId: string, requestId: string) => {
			for (const delta of ["Hello", " **world**"]) {
				for (const listener of listeners) {
					listener({ sessionId, requestId, event: { type: "text_delta", delta } });
				}
			}
			return {
				modelKey: "openai/gpt-5",
				text: "Hello **world**",
				stopReason: "stop" as const,
				usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
			};
		}),
	};

	beforeEach(() => {
		listeners.clear();
		requirePermission.mockClear();
		bridge.stream.mockClear();
		bridge.cancelStream.mockClear();
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: { plugins: { internalCapabilities: { ai: bridge } } },
		});
	});

	it("delivers ordered deltas with accumulated text and resolves the final result", async () => {
		const api = createPluginAiApi({ require: requirePermission } as unknown as PluginPermissionApi, "session");
		const updates: Array<{ delta: string; text: string }> = [];

		const result = await api.stream({ prompt: "question" }, { onTextDelta: (event) => updates.push(event) });

		expect(requirePermission).toHaveBeenCalledWith("ai.complete");
		expect(updates).toEqual([
			{ delta: "Hello", text: "Hello" },
			{ delta: " **world**", text: "Hello **world**" },
		]);
		expect(result.text).toBe("Hello **world**");
		expect(listeners.size).toBe(0);
	});

	it("cancels through the bridge when the caller aborts", async () => {
		let resolveStream: (() => void) | undefined;
		bridge.stream.mockImplementationOnce(
			async () =>
				await new Promise((resolve) => {
					resolveStream = () =>
						resolve({
							modelKey: "openai/gpt-5",
							text: "",
							stopReason: "stop" as const,
							usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
						});
				}),
		);
		const api = createPluginAiApi({ require: requirePermission } as unknown as PluginPermissionApi, "session");
		const controller = new AbortController();
		const result = api.stream({ prompt: "question" }, { signal: controller.signal });

		controller.abort();
		expect(bridge.cancelStream).toHaveBeenCalledOnce();
		resolveStream?.();
		await result;
	});
});
