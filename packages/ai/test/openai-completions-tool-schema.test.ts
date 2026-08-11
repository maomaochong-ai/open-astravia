import { describe, expect, it, vi } from "vitest";
import { resolveOpenAICompletionsCompat } from "../src/providers/openai-completions/compatibility.js";
import { convertTools } from "../src/providers/openai-completions/messages.js";
import type { Model, Tool } from "../src/types.js";

const model: Model<"openai-completions"> = {
	id: "gemini-3.6-flash-high",
	name: "gemini-3.6-flash-high",
	api: "openai-completions",
	provider: "cpa",
	baseUrl: "http://127.0.0.1:8317/v1",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1_000,
	maxTokens: 1_000,
};

const compat = resolveOpenAICompletionsCompat(model);

function convert(parameters: unknown, name = "render_chart"): Record<string, unknown> {
	const tool = { name, description: "d", parameters } as unknown as Tool;
	const converted = convertTools([tool], compat)[0];
	if (!converted || converted.type !== "function") throw new Error("expected a function tool");
	return converted.function.parameters as Record<string, unknown>;
}

describe("convertTools tool parameter sanitization", () => {
	it("剔除只带约束、无 type/properties 的 anyOf 分支", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const parameters = convert({
			type: "object",
			properties: { charts: { type: "array" }, type: { type: "string" }, data: { type: "object" } },
			anyOf: [{ required: ["charts"] }, { required: ["type", "data"] }],
			additionalProperties: false,
		});

		expect(parameters.anyOf).toBeUndefined();
		expect(parameters.properties).toEqual({
			charts: { type: "array" },
			type: { type: "string" },
			data: { type: "object" },
		});
		expect(parameters.additionalProperties).toBe(false);
		expect(warn).toHaveBeenCalledOnce();
		warn.mockRestore();
	});

	it("保留可表达成 schema 的分支，只剔除约束分支", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const parameters = convert(
			{
				type: "object",
				properties: { a: { anyOf: [{ type: "string" }, { required: ["b"] }] } },
			},
			"mixed_branches",
		);

		expect((parameters.properties as Record<string, unknown>).a).toEqual({ anyOf: [{ type: "string" }] });
		warn.mockRestore();
	});

	it("没有约束分支时原样透传，不告警", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const original = {
			type: "object",
			properties: { a: { type: "string" }, b: { anyOf: [{ type: "string" }, { type: "number" }] } },
			required: ["a"],
		};

		expect(convert(original, "plain_tool")).toBe(original);
		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();
	});
});
