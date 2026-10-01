import { describe, expect, it } from "vitest";
import { CAPABILITY_ERROR_CODES, CAPABILITY_PREFIXES } from "../../src/contracts.js";
import { DOMAIN_MCP_CAPABILITIES, DOMAIN_MCP_CAPABILITY_CATALOG, MCP_SERVER_TYPES } from "../../src/domain.js";

describe("MCP domain capabilities", () => {
	it("uses one stable capability id per MCP server operation", () => {
		expect(Object.values(DOMAIN_MCP_CAPABILITIES).map((capability) => capability.id)).toEqual([
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}mcp.server.list`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}mcp.server.get`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}mcp.server.upsert`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}mcp.server.set-enabled`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}mcp.server.remove`,
		]);
	});

	it("validates MCP server inputs and sanitized outputs", () => {
		expect(
			DOMAIN_MCP_CAPABILITIES.UPSERT_SERVER.parseInput({
				name: "web",
				data: {
					type: MCP_SERVER_TYPES.HTTP,
					url: "https://mcp.example.com",
					headers: { Authorization: "Bearer secret" },
				},
			}),
		).toEqual({
			name: "web",
			data: {
				type: MCP_SERVER_TYPES.HTTP,
				url: "https://mcp.example.com",
				headers: { Authorization: "Bearer secret" },
			},
		});
		expect(
			DOMAIN_MCP_CAPABILITIES.UPSERT_SERVER.parseInput({
				name: "local",
				data: {
					command: "npx",
					args: ["-y", "server"],
					env: { TOKEN: "secret" },
				},
			}),
		).toEqual({
			name: "local",
			data: {
				command: "npx",
				args: ["-y", "server"],
				env: { TOKEN: "secret" },
			},
		});
		expect(
			DOMAIN_MCP_CAPABILITIES.GET_SERVER.parseOutput({
				name: "web",
				type: MCP_SERVER_TYPES.HTTP,
				url: "https://mcp.example.com",
				headers: { Authorization: "***" },
				disabled: false,
				ignored: true,
			}),
		).toEqual({
			name: "web",
			type: MCP_SERVER_TYPES.HTTP,
			url: "https://mcp.example.com",
			headers: { Authorization: "***" },
			disabled: false,
		});
		expect(() =>
			DOMAIN_MCP_CAPABILITIES.UPSERT_SERVER.parseInput({
				name: "web",
				data: { type: MCP_SERVER_TYPES.HTTP, command: "node" },
			}),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }));
		expect(() =>
			DOMAIN_MCP_CAPABILITIES.UPSERT_SERVER.parseInput({
				name: "local",
				data: { type: MCP_SERVER_TYPES.STDIO, url: "https://mcp.example.com" },
			}),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }));
		expect(() => DOMAIN_MCP_CAPABILITIES.SET_SERVER_ENABLED.parseInput({ name: "web", enabled: "yes" })).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }),
		);
		expect(() => DOMAIN_MCP_CAPABILITIES.GET_SERVER.parseInput({ name: "   " })).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }),
		);
		expect(() => DOMAIN_MCP_CAPABILITIES.LIST_SERVERS.parseInput({ ignored: true })).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }),
		);
	});

	it("publishes MCP server schemas in its catalog", () => {
		expect(DOMAIN_MCP_CAPABILITY_CATALOG).toHaveLength(5);
		expect(DOMAIN_MCP_CAPABILITY_CATALOG[0]?.id).toBe(DOMAIN_MCP_CAPABILITIES.LIST_SERVERS.id);
		expect(DOMAIN_MCP_CAPABILITY_CATALOG[2]?.inputSchema).toMatchObject({
			type: "object",
			required: ["name", "data"],
			properties: {
				data: {
					anyOf: [
						{
							type: "object",
							required: ["type"],
							properties: {
								type: { const: MCP_SERVER_TYPES.HTTP },
							},
						},
						{
							type: "object",
							properties: {
								type: { const: MCP_SERVER_TYPES.STDIO },
							},
						},
					],
				},
			},
		});
		expect(DOMAIN_MCP_CAPABILITY_CATALOG[3]?.outputSchema).toBe(false);
		expect(DOMAIN_MCP_CAPABILITY_CATALOG[4]?.outputSchema).toBe(false);
		expect(() => JSON.stringify(DOMAIN_MCP_CAPABILITY_CATALOG)).not.toThrow();
	});
});
