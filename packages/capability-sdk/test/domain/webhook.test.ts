import { describe, expect, it } from "vitest";
import { CAPABILITY_ERROR_CODES, CAPABILITY_PREFIXES } from "../../src/contracts.js";
import {
	DOMAIN_WEBHOOK_CAPABILITIES,
	DOMAIN_WEBHOOK_CAPABILITY_CATALOG,
	WEBHOOK_KINDS,
	WEBHOOK_MESSAGE_LEVELS,
} from "../../src/domain.js";

describe("webhook domain capabilities", () => {
	it("uses one stable id per webhook operation", () => {
		expect(Object.values(DOMAIN_WEBHOOK_CAPABILITIES).map((capability) => capability.id)).toEqual([
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}webhook.endpoint.list`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}webhook.provider.list`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}webhook.endpoint.create`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}webhook.endpoint.update`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}webhook.endpoint.delete`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}webhook.endpoint.set-enabled`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}webhook.endpoint.test`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}webhook.endpoint.send`,
		]);
	});

	it("validates webhook input and preserves an explicit secret clear", () => {
		expect(
			DOMAIN_WEBHOOK_CAPABILITIES.CREATE_ENDPOINT.parseInput({
				data: {
					kind: WEBHOOK_KINDS.FEISHU,
					name: "",
					webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/example",
				},
			}),
		).toEqual({
			data: {
				kind: WEBHOOK_KINDS.FEISHU,
				name: "",
				webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/example",
			},
		});
		const update = DOMAIN_WEBHOOK_CAPABILITIES.UPDATE_ENDPOINT.parseInput({
			id: "endpoint",
			data: { name: undefined, signSecret: "" },
		});
		expect(update.data).not.toHaveProperty("name");
		expect(update.data).toHaveProperty("signSecret", "");
		expect(
			DOMAIN_WEBHOOK_CAPABILITIES.LIST_ENDPOINTS.parseOutput([
				{
					id: "endpoint",
					kind: WEBHOOK_KINDS.DINGTALK,
					name: "alerts",
					enabled: true,
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-02T00:00:00.000Z",
					urlMask: "https://oapi.dingtalk.com/***",
					hasSignSecret: true,
					dingtalk: { mentionAll: false, atMobiles: ["13800000000"], keyword: "alert" },
					ignored: true,
				},
			]),
		).toEqual([
			{
				id: "endpoint",
				kind: WEBHOOK_KINDS.DINGTALK,
				name: "alerts",
				enabled: true,
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-02T00:00:00.000Z",
				urlMask: "https://oapi.dingtalk.com/***",
				hasSignSecret: true,
				dingtalk: { mentionAll: false, atMobiles: ["13800000000"], keyword: "alert" },
			},
		]);
		expect(
			DOMAIN_WEBHOOK_CAPABILITIES.SEND_MESSAGE.parseInput({
				id: "endpoint",
				message: { text: "hello", level: WEBHOOK_MESSAGE_LEVELS.INFO, ignored: true },
				ignored: true,
			}),
		).toEqual({
			id: "endpoint",
			message: { text: "hello", level: WEBHOOK_MESSAGE_LEVELS.INFO },
		});
		expect(() =>
			DOMAIN_WEBHOOK_CAPABILITIES.SEND_MESSAGE.parseInput({
				id: "endpoint",
				message: { text: "hello", level: "unknown" },
			}),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }));
		expect(() =>
			DOMAIN_WEBHOOK_CAPABILITIES.UPDATE_ENDPOINT.parseInput({
				id: "endpoint",
				data: {},
			}),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }));
		expect(() =>
			DOMAIN_WEBHOOK_CAPABILITIES.CREATE_ENDPOINT.parseInput({
				data: {
					kind: WEBHOOK_KINDS.FEISHU,
					name: "bot",
					webhookUrl: "   ",
				},
			}),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }));
	});

	it("publishes webhook endpoint and message schemas in its catalog", () => {
		expect(DOMAIN_WEBHOOK_CAPABILITY_CATALOG).toHaveLength(8);
		expect(DOMAIN_WEBHOOK_CAPABILITY_CATALOG[2]?.inputSchema).toMatchObject({
			type: "object",
			required: ["data"],
			properties: {
				data: {
					type: "object",
					required: ["kind", "name", "webhookUrl"],
					properties: {
						kind: {
							anyOf: [{ const: WEBHOOK_KINDS.FEISHU }, { const: WEBHOOK_KINDS.DINGTALK }],
						},
					},
				},
			},
		});
		expect(DOMAIN_WEBHOOK_CAPABILITY_CATALOG[3]?.inputSchema).toMatchObject({
			properties: {
				data: {
					minProperties: 1,
				},
			},
		});
		expect(DOMAIN_WEBHOOK_CAPABILITY_CATALOG[4]?.outputSchema).toBe(false);
		expect(DOMAIN_WEBHOOK_CAPABILITY_CATALOG[7]?.inputSchema).toMatchObject({
			properties: {
				message: {
					required: ["text"],
					properties: {
						level: {
							anyOf: [
								{ const: WEBHOOK_MESSAGE_LEVELS.INFO },
								{ const: WEBHOOK_MESSAGE_LEVELS.WARN },
								{ const: WEBHOOK_MESSAGE_LEVELS.ERROR },
								{ const: WEBHOOK_MESSAGE_LEVELS.SUCCESS },
							],
						},
					},
				},
			},
		});
		expect(() => JSON.stringify(DOMAIN_WEBHOOK_CAPABILITY_CATALOG)).not.toThrow();
	});
});
