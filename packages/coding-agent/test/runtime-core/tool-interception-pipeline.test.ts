import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { describe, expect, it } from "vitest";
import { DynamicContributionCatalog } from "../../src/interception/contribution-catalog.js";
import type { CodingAgentToolInterceptor } from "../../src/interception/tool/contracts.js";
import { wrapRuntimeToolsWithInterceptionPipeline } from "../../src/interception/tool/pipeline.js";

describe("tool interception pipeline", () => {
	it("runs before in catalog order and after in reverse order", async () => {
		const calls: string[] = [];
		const catalog = new DynamicContributionCatalog<CodingAgentToolInterceptor>();
		catalog.register({ sourceId: "outer", localId: "hook", revision: "1", order: 100, value: interceptor("outer") });
		catalog.register({ sourceId: "inner", localId: "hook", revision: "1", order: 200, value: interceptor("inner") });
		const wrapped = wrapRuntimeToolsWithInterceptionPipeline(new Map([["test", tool(calls)]]), catalog).get("test")!;

		const result = await wrapped.execute(request({ value: "initial" }));

		expect(calls).toEqual(["outer.before", "inner.before", "tool:inner", "inner.after", "outer.after"]);
		expect(result.details).toEqual({ value: "outer" });

		function interceptor(id: string): CodingAgentToolInterceptor {
			return {
				before: async ({ input }) => {
					calls.push(`${id}.before`);
					return { input: { ...input, value: id } };
				},
				after: async ({ result }) => {
					calls.push(`${id}.after`);
					return { result: { ...result, details: { value: id } } };
				},
			};
		}
	});

	it("short-circuits a blocking before handler", async () => {
		const calls: string[] = [];
		const catalog = new DynamicContributionCatalog<CodingAgentToolInterceptor>();
		catalog.register({
			sourceId: "guard",
			localId: "hook",
			revision: "1",
			order: 1,
			value: { before: async () => ({ block: { reason: "blocked" } }) },
		});
		catalog.register({
			sourceId: "later",
			localId: "hook",
			revision: "1",
			order: 2,
			value: { before: async () => void calls.push("later") },
		});
		const wrapped = wrapRuntimeToolsWithInterceptionPipeline(new Map([["test", tool(calls)]]), catalog).get("test")!;

		await expect(wrapped.execute(request({}))).rejects.toThrow("blocked");
		expect(calls).toEqual([]);
	});

	it("lets outer error handlers observe failures and replace the error", async () => {
		const calls: string[] = [];
		const catalog = new DynamicContributionCatalog<CodingAgentToolInterceptor>();
		catalog.register({
			sourceId: "outer",
			localId: "hook",
			revision: "1",
			order: 1,
			value: {
				onError: async ({ error }) => {
					calls.push(`outer.error:${error instanceof Error ? error.message : String(error)}`);
					return { error: new Error("replaced") };
				},
			},
		});
		catalog.register({
			sourceId: "inner",
			localId: "hook",
			revision: "1",
			order: 2,
			value: { before: async () => ({ block: { reason: "inner blocked" } }) },
		});
		const wrapped = wrapRuntimeToolsWithInterceptionPipeline(new Map([["test", tool(calls)]]), catalog).get("test")!;

		await expect(wrapped.execute(request({}))).rejects.toThrow("replaced");
		expect(calls).toEqual(["outer.error:inner blocked"]);
	});

	it("uses one catalog snapshot for the whole tool execution", async () => {
		const calls: string[] = [];
		const catalog = new DynamicContributionCatalog<CodingAgentToolInterceptor>();
		const release = catalog.register({
			sourceId: "plugin",
			localId: "hook",
			revision: "1",
			order: 1,
			value: {
				before: async () => {
					calls.push("old.before");
					release.release();
					catalog.register({
						sourceId: "plugin",
						localId: "hook",
						revision: "2",
						order: 1,
						value: {
							before: async () => {
								calls.push("new.before");
								return undefined;
							},
						},
					});
					return undefined;
				},
				after: async () => {
					calls.push("old.after");
					return undefined;
				},
			},
		});
		const wrapped = wrapRuntimeToolsWithInterceptionPipeline(new Map([["test", tool(calls)]]), catalog).get("test")!;

		await wrapped.execute(request({}));
		await wrapped.execute(request({}));
		expect(calls).toEqual(["old.before", "tool:undefined", "old.after", "new.before", "tool:undefined"]);
	});
});

function tool(calls: string[]): RuntimeToolDefinition {
	return {
		name: "test",
		label: "test",
		description: "test",
		inputSchema: { type: "object" },
		execute: async ({ input }) => {
			calls.push(`tool:${String(input.value)}`);
			return { content: [{ type: "text", text: "ok" }], details: input };
		},
	};
}

function request(input: Readonly<Record<string, unknown>>) {
	return {
		sessionId: "session",
		turnId: "turn",
		toolCallId: "call",
		input,
		signal: new AbortController().signal,
	};
}
