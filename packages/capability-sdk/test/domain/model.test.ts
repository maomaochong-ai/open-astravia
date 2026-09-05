import { describe, expect, it } from "vitest";
import { CAPABILITY_ERROR_CODES, CAPABILITY_PREFIXES } from "../../src/contracts.js";
import { DOMAIN_MODEL_CAPABILITIES, DOMAIN_MODEL_CAPABILITY_CATALOG } from "../../src/domain.js";

describe("model domain capabilities", () => {
	it("uses one stable id per model operation", () => {
		expect(Object.values(DOMAIN_MODEL_CAPABILITIES).map((capability) => capability.id)).toEqual([
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}model.list`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}model.config.get`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}model.provider.get`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}model.probe`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}model.key.validate`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}model.default.set`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}model.provider.upsert`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}model.provider.remove`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}model.owned-providers.replace`,
		]);
	});

	it("validates sanitized model snapshots and provider mutations", () => {
		expect(
			DOMAIN_MODEL_CAPABILITIES.LIST.parseOutput({
				defaultModel: "openai/gpt-5",
				providers: [
					{
						id: "openai",
						displayName: "OpenAI",
						hasApiKey: true,
						modelCount: 1,
						models: [{ id: "gpt-5", reasoning: true, ignored: true }],
						ignored: true,
					},
				],
				ignored: true,
			}),
		).toHaveProperty("providers.0.models.0.id", "gpt-5");
		const config = DOMAIN_MODEL_CAPABILITIES.GET_CONFIG.parseOutput({
			defaultModel: "openai/gpt-5",
			providers: {
				openai: {
					apiKey: "***",
					headers: { Authorization: "***" },
					models: [
						{
							id: "gpt-5",
							reasoningLevels: ["low", "high"],
							cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1.5, ignored: true },
							ignored: true,
						},
					],
					ignored: true,
				},
			},
			ignored: true,
		});
		expect(config).toHaveProperty("providers.openai.apiKey", "***");
		expect(config).not.toHaveProperty("providers.openai.ignored");
		expect(config).not.toHaveProperty("providers.openai.models.0.ignored");
		expect(config).not.toHaveProperty("providers.openai.models.0.cost.ignored");
		expect(
			DOMAIN_MODEL_CAPABILITIES.UPSERT_PROVIDER.parseInput({
				provider: "openai",
				data: { apiKey: "", models: [{ id: "gpt-5", reasoning: true, ignored: true }], ignored: true },
				ignored: true,
			}),
		).toEqual({
			provider: "openai",
			data: { apiKey: "", models: [{ id: "gpt-5", reasoning: true }] },
		});
		expect(() => DOMAIN_MODEL_CAPABILITIES.VALIDATE_KEY.parseInput({ modelKey: "invalid" })).not.toThrow();
		expect(
			DOMAIN_MODEL_CAPABILITIES.REPLACE_OWNED_PROVIDERS.parseInput({
				owner: "cli-proxy-api",
				providers: { google: { models: [{ id: "gemini-test" }] } },
			}),
		).toEqual({
			owner: "cli-proxy-api",
			providers: { google: { models: [{ id: "gemini-test" }] } },
		});
		expect(() =>
			DOMAIN_MODEL_CAPABILITIES.UPSERT_PROVIDER.parseInput({
				provider: "openai",
				data: { models: [{ id: "" }] },
			}),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }));
	});

	it("rejects invalid nested model values with stable error codes", () => {
		expect(() =>
			DOMAIN_MODEL_CAPABILITIES.GET_CONFIG.parseOutput({
				providers: {
					openai: {
						models: [{ id: "gpt-5", contextWindow: Number.POSITIVE_INFINITY }],
					},
				},
			}),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_OUTPUT }));
		expect(() =>
			DOMAIN_MODEL_CAPABILITIES.UPSERT_PROVIDER.parseInput({
				provider: "openai",
				data: { headers: { Authorization: true } },
			}),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }));
		expect(() => DOMAIN_MODEL_CAPABILITIES.PROBE.parseInput({ provider: " ", model: "gpt-5" })).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }),
		);
	});

	it("publishes provider configuration and mutation schemas", () => {
		expect(DOMAIN_MODEL_CAPABILITY_CATALOG).toHaveLength(9);
		expect(DOMAIN_MODEL_CAPABILITY_CATALOG[1]?.outputSchema).toMatchObject({
			type: "object",
			required: ["providers"],
			properties: {
				providers: {
					type: "object",
					patternProperties: {
						"^(.*)$": {
							type: "object",
							properties: {
								headers: { type: "object" },
								models: {
									type: "array",
									items: {
										type: "object",
										required: ["id"],
										properties: {
											cost: {
												type: "object",
												required: ["input", "output", "cacheRead", "cacheWrite"],
											},
										},
									},
								},
							},
						},
					},
				},
			},
		});
		expect(DOMAIN_MODEL_CAPABILITY_CATALOG[6]?.inputSchema).toMatchObject({
			type: "object",
			required: ["provider", "data"],
			properties: {
				provider: { type: "string", pattern: "\\S" },
				data: {
					type: "object",
					properties: {
						models: {
							type: "array",
							items: {
								type: "object",
								required: ["id"],
								properties: { id: { type: "string", pattern: "\\S" } },
							},
						},
					},
				},
			},
		});
		expect(() => JSON.stringify(DOMAIN_MODEL_CAPABILITY_CATALOG)).not.toThrow();
	});
});
