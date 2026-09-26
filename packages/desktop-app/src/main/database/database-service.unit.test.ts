import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Bug 1 回归：databaseService.removeConnection 的 config 清理必须按 connectionName 做 key。
 *
 * 历史 bug：connectionEnv / prodWriteApproved 两个 product-level 持久化 map 在
 * desktop-config-store 里的 key 是**连接 name**（注释明确「连接名→值」），但旧版本
 * removeConnection 清理时用参数名 `id` 去 delete —— 两边 key 语义错位导致删除后
 * 悬空条目永远留着。addConnection（写）和 listConnections（读）两侧都用 name，
 * 唯独清理用 id，三条腿不齐。
 */

vi.mock("../config/desktop-config-store.js", () => ({
	readConfigSync: vi.fn(() => ({
		database: {
			connectionEnv: { "my-prod-conn": "prod", "other-conn": "dev" },
			prodWriteApproved: { "my-prod-conn": true },
		},
	})),
	writeDesktopConfig: vi.fn(async (cfg: unknown) => cfg),
}));

vi.mock("./dbx-mcp-client.js", () => ({
	getDbxMcpClient: vi.fn(() => ({
		callTool: vi.fn(async () => ({
			isError: false,
			content: [{ type: "text", text: "Connection removed" }],
		})),
	})),
	disposeDbxMcpClient: vi.fn(),
}));

vi.mock("../logger.js", () => ({
	getAppLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}));

vi.mock("electron", () => ({ app: { isPackaged: false } }));

describe("databaseService.removeConnection config 清理（Bug 1 回归）", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	it("按 connectionName 清理 connectionEnv 与 prodWriteApproved", async () => {
		const { databaseService } = await import("./database-service.js");
		const result = await databaseService.removeConnection("my-prod-conn");
		if (!result.ok) {
			throw new Error(`removeConnection failed: ${result.error.code} - ${result.error.detail ?? ""}`);
		}
		expect(result.ok).toBe(true);

		const { writeDesktopConfig } = await import("../config/desktop-config-store.js");
		const calls = (writeDesktopConfig as unknown as { mock: { calls: Array<[Record<string, unknown>]> } }).mock.calls;
		expect(calls.length).toBeGreaterThan(0);
		const last = calls.at(-1)![0];
		const db = (last.database ?? {}) as Record<string, Record<string, unknown>>;
		const env: Record<string, unknown> = db.connectionEnv ?? {};
		const approved: Record<string, unknown> = db.prodWriteApproved ?? {};

		expect(env).not.toHaveProperty("my-prod-conn");
		expect(approved).not.toHaveProperty("my-prod-conn");
		expect(env["other-conn"]).toBe("dev");
	});

	it("反例保护：不存在的 connectionName 不影响其他条目", async () => {
		const { databaseService } = await import("./database-service.js");
		const result = await databaseService.removeConnection("totally-nonexistent");
		if (!result.ok) throw new Error(`unexpected fail: ${result.error.code}`);

		const { writeDesktopConfig } = await import("../config/desktop-config-store.js");
		const calls = (writeDesktopConfig as unknown as { mock: { calls: Array<[Record<string, unknown>]> } }).mock.calls;
		const last = calls.at(-1)![0];
		const db = (last.database ?? {}) as Record<string, Record<string, unknown>>;
		const env: Record<string, unknown> = db.connectionEnv ?? {};
		const approved: Record<string, unknown> = db.prodWriteApproved ?? {};

		expect(env["my-prod-conn"]).toBe("prod");
		expect(env["other-conn"]).toBe("dev");
		expect(approved["my-prod-conn"]).toBe(true);
	});

	it("dbx 返回错误时不清理 config（幂等：避免误删）", async () => {
		vi.doMock("./dbx-mcp-client.js", async () => ({
			getDbxMcpClient: vi.fn(() => ({
				callTool: vi.fn(async () => ({
					isError: true,
					content: [{ type: "text", text: "Connection not found" }],
				})),
			})),
			disposeDbxMcpClient: vi.fn(),
		}));

		vi.resetModules();
		const { databaseService } = await import("./database-service.js");
		const result = await databaseService.removeConnection("totally-nonexistent");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("CONNECTION_NOT_FOUND");

		const { writeDesktopConfig } = await import("../config/desktop-config-store.js");
		expect((writeDesktopConfig as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(0);
	});
});
