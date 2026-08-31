import { RuntimeAgentRuntime } from "@vetta/runtime-core";
import { PassthroughContextStrategy } from "@vetta/runtime-core/kernel";
import { describe, expect, it, vi } from "vitest";
import { createCodingAgentExecutionRuntimeDefinition } from "../../src/composition/index.js";

describe("Coding Agent execution Definition rollback", () => {
	it.each([false, true])(
		"releases a prepared Plan when transformation fails (cleanup fails: %s)",
		async (cleanupFails) => {
			const runtime = new RuntimeAgentRuntime();
			const onFailure = vi.fn();
			let cleanupBlocked = cleanupFails;
			const dispose = vi.fn(async () => {
				if (cleanupBlocked) throw new Error("cleanup rejected");
			});
			const definition = createCodingAgentExecutionRuntimeDefinition({
				transformSessionDefinition: () => {
					throw new Error("transform rejected");
				},
			});
			runtime.registry.upsert({ source: { id: "test", revision: "1" }, definition });
			const instance = await runtime.createInstance({
				agentId: definition.id,
				configuration: {
					prepareSession: async () => ({
						definition: {
							capabilities: {
								instructions: [],
								features: [],
								contextStrategy: new PassthroughContextStrategy(),
								toolPolicy: { authorize: async () => true },
								tokenBudget: 8_000,
								reservedOutputTokens: 1_000,
							},
						},
						onFailure,
						dispose,
					}),
				},
			});
			try {
				const creation = instance.createSession({
					sessionId: "rejected",
					configuration: { options: { sessionId: "rejected" }, resourceContext: {} },
				});
				if (cleanupFails) {
					await expect(creation).rejects.toMatchObject({
						errors: [
							expect.objectContaining({ message: "transform rejected" }),
							expect.objectContaining({ message: "cleanup rejected" }),
						],
					});
				} else {
					await expect(creation).rejects.toThrow("transform rejected");
				}
				expect(onFailure).toHaveBeenCalledOnce();
				expect(dispose).toHaveBeenCalledOnce();
				expect(runtime.getSession("rejected")).toBeUndefined();
				if (cleanupFails) {
					await expect(instance.close()).rejects.toThrow();
					expect(runtime.snapshot().instances).toHaveLength(1);
				}
			} finally {
				cleanupBlocked = false;
				await runtime.close();
			}
			expect(dispose).toHaveBeenCalledTimes(cleanupFails ? 3 : 1);
			expect(onFailure).toHaveBeenCalledOnce();
			expect(runtime.snapshot().instances).toEqual([]);
		},
	);
});
