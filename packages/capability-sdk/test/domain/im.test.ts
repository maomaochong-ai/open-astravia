import { describe, expect, it } from "vitest";
import { CAPABILITY_ERROR_CODES, CAPABILITY_PREFIXES } from "../../src/contracts.js";
import {
	DOMAIN_IM_CAPABILITIES,
	DOMAIN_IM_CAPABILITY_CATALOG,
	IM_LOG_LEVELS,
	IM_TRANSPORT_STATUSES,
	IM_TRANSPORTS,
} from "../../src/domain.js";

describe("IM domain capabilities", () => {
	it("uses one stable id per IM operation", () => {
		expect(Object.values(DOMAIN_IM_CAPABILITIES).map((capability) => capability.id)).toEqual([
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}im.status.get`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}im.log.list`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}im.enabled.set`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}im.restart`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}im.agent-model.set`,
		]);
	});

	it("validates status, logs, and model settings", () => {
		const runtime = {
			transport: IM_TRANSPORT_STATUSES.ONLINE,
			activeSessions: 2,
			consecutiveStartFailures: 0,
			ignored: true,
		};
		const status = DOMAIN_IM_CAPABILITIES.GET_STATUS.parseOutput({
			enabled: true,
			transport: IM_TRANSPORTS.FEISHU,
			agentModel: { provider: "openai", model: "gpt-5", reasoningLevel: "high", ignored: true },
			wechatBound: false,
			feishuAppId: "app-id",
			runtime,
			ignored: true,
		});
		expect(status).not.toHaveProperty("agentModel.ignored");
		expect(status).not.toHaveProperty("runtime.ignored");
		expect(
			DOMAIN_IM_CAPABILITIES.LIST_LOGS.parseOutput([
				{
					level: IM_LOG_LEVELS.INFO,
					msg: "started",
					time: "2026-07-24T00:00:00.000Z",
					fields: { pid: 1 },
					ignored: true,
				},
			]),
		).toEqual([{ level: IM_LOG_LEVELS.INFO, msg: "started", time: "2026-07-24T00:00:00.000Z", fields: { pid: 1 } }]);
		expect(
			DOMAIN_IM_CAPABILITIES.SET_AGENT_MODEL.parseInput({
				agentModel: { provider: "openai", model: "gpt-5", reasoningLevel: "high", ignored: true },
				ignored: true,
			}),
		).toEqual({ agentModel: { provider: "openai", model: "gpt-5", reasoningLevel: "high" } });
		expect(DOMAIN_IM_CAPABILITIES.SET_AGENT_MODEL.parseInput({ agentModel: null })).toEqual({ agentModel: null });
		expect(() => DOMAIN_IM_CAPABILITIES.LIST_LOGS.parseInput({ limit: -1 })).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }),
		);
		expect(() =>
			DOMAIN_IM_CAPABILITIES.SET_AGENT_MODEL.parseInput({ agentModel: { provider: "openai" } }),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }));
		expect(() =>
			DOMAIN_IM_CAPABILITIES.SET_AGENT_MODEL.parseInput({
				agentModel: { provider: "   ", model: "gpt-5" },
			}),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }));
		expect(() => DOMAIN_IM_CAPABILITIES.LIST_LOGS.parseInput({ limit: 1.5 })).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }),
		);
		expect(() => DOMAIN_IM_CAPABILITIES.RESTART.parseInput({ ignored: true })).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }),
		);
	});

	it("publishes status, log, and model setting schemas", () => {
		expect(DOMAIN_IM_CAPABILITY_CATALOG).toHaveLength(5);
		expect(DOMAIN_IM_CAPABILITY_CATALOG[0]?.outputSchema).toMatchObject({
			type: "object",
			required: ["enabled", "transport", "agentModel", "wechatBound", "feishuAppId", "runtime"],
			properties: {
				agentModel: {
					anyOf: [
						{
							type: "object",
							required: ["provider", "model"],
						},
						{ type: "null" },
					],
				},
				runtime: {
					type: "object",
					required: ["transport", "activeSessions", "consecutiveStartFailures"],
				},
			},
		});
		expect(DOMAIN_IM_CAPABILITY_CATALOG[1]?.inputSchema).toMatchObject({
			properties: { limit: { type: "integer", minimum: 0 } },
			required: ["limit"],
		});
		expect(DOMAIN_IM_CAPABILITY_CATALOG[4]?.inputSchema).toMatchObject({
			properties: {
				agentModel: {
					anyOf: [
						{
							type: "object",
							required: ["provider", "model"],
							properties: {
								provider: { type: "string", pattern: "\\S" },
								model: { type: "string", pattern: "\\S" },
							},
						},
						{ type: "null" },
					],
				},
			},
		});
		expect(() => JSON.stringify(DOMAIN_IM_CAPABILITY_CATALOG)).not.toThrow();
	});
});
