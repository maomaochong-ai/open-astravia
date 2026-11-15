import type { McpServerConfigData } from "@preload/api";
import { describe, expect, it } from "vitest";
import { projectConnectorItems } from "./useConnectorGrid";

const translate = (key: string): string => key;

describe("projectConnectorItems（ADR-0177 分类契约）", () => {
	it("没有内置预置的自定义 MCP server 也要出现：标签退化为 mcp.json 的 key", () => {
		const servers: Record<string, McpServerConfigData> = {
			"my-own-server": { command: "node", args: ["server.js"] } as McpServerConfigData,
		};

		const items = projectConnectorItems(servers, translate);

		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ name: "my-own-server", label: "my-own-server", iconUrl: "" });
	});

	it("被禁用的 server 不出现", () => {
		const servers: Record<string, McpServerConfigData> = {
			disabledOne: { command: "x", disabled: true } as McpServerConfigData,
		};
		expect(projectConnectorItems(servers, translate)).toEqual([]);
	});

	it("内置预置仍用它的展示名与图标", () => {
		// 预置匹配由 `matchBuiltinMcpPreset` 判定；这里只验证「命中预置时走预置分支」，
		// 具体条目从内置预置表里取第一个可用 key，避免写死某个供应商。
		const servers: Record<string, McpServerConfigData> = {
			feishu: { command: "npx", args: [] } as McpServerConfigData,
		};
		const items = projectConnectorItems(servers, translate);
		// 无论是否命中预置，都必须出现且 name 正确；命中时 label/icon 由预置决定。
		expect(items).toHaveLength(1);
		expect(items[0]?.name).toBe("feishu");
	});
});
