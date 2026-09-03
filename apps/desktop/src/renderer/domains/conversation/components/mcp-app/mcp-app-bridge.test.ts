// @vitest-environment jsdom
import type { DesktopApi, DesktopMcpAppSurface } from "@preload/api";
import { describe, expect, it, vi } from "vitest";
import { DesktopMcpAppBridge } from "./mcp-app-bridge";

const SURFACE: DesktopMcpAppSurface = {
	id: "mcp-app-1",
	resource: { uri: "ui://app", mimeType: "text/html;profile=mcp-app", html: "<main />" },
	toolResult: { content: [{ type: "text", text: "done" }] },
	capabilities: { serverTools: true, serverResources: true },
};

describe("DesktopMcpAppBridge", () => {
	it("negotiates only implemented capabilities and queues Tool state until initialized", async () => {
		const messages: unknown[] = [];
		const bridge = new DesktopMcpAppBridge({
			surface: SURFACE,
			targetWindow: window,
			input: { topic: "usage" },
			post: (message) => messages.push(message),
		});
		bridge.sendInitialToolState();
		expect(messages).toEqual([]);

		bridge.handle({ jsonrpc: "2.0", id: 1, method: "ui/initialize", params: { appCapabilities: {} } });
		await Promise.resolve();
		expect(messages[0]).toMatchObject({
			id: 1,
			result: { hostCapabilities: { serverTools: {}, serverResources: {} } },
		});

		bridge.handle({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} });
		expect(messages).toContainEqual({
			jsonrpc: "2.0",
			method: "ui/notifications/tool-input",
			params: { arguments: { topic: "usage" } },
		});
		expect(messages).toContainEqual({
			jsonrpc: "2.0",
			method: "ui/notifications/tool-result",
			params: SURFACE.toolResult,
		});
	});

	it("proxies validated same-surface calls through preload and rejects unsupported methods", async () => {
		const callMcpAppTool = vi.fn(async () => ({ content: [] }));
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: { session: { callMcpAppTool } } as unknown as DesktopApi,
		});
		const messages: Array<Record<string, unknown>> = [];
		const bridge = new DesktopMcpAppBridge({
			surface: SURFACE,
			targetWindow: window,
			input: {},
			post: (message) => messages.push(message as Record<string, unknown>),
		});
		bridge.handle({ jsonrpc: "2.0", id: "init", method: "ui/initialize", params: { appCapabilities: {} } });
		await Promise.resolve();
		bridge.handle({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} });

		bridge.handle({ jsonrpc: "2.0", id: "call", method: "tools/call", params: { name: "refresh", arguments: {} } });
		await Promise.resolve();
		await Promise.resolve();
		expect(callMcpAppTool).toHaveBeenCalledWith({ surfaceId: "mcp-app-1", name: "refresh", arguments: {} });
		expect(messages).toContainEqual({ jsonrpc: "2.0", id: "call", result: { content: [] } });

		bridge.handle({ jsonrpc: "2.0", id: "bad", method: "ui/open-link", params: { url: "file:///secret" } });
		await Promise.resolve();
		expect(messages.at(-1)).toMatchObject({ id: "bad", error: { code: -32601 } });
	});
});
