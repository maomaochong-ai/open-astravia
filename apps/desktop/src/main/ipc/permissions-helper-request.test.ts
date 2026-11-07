import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
const openExternal = vi.fn(async () => undefined);
const requested = new Set<string>();
const requestHelperPermissions = vi.fn(async (service?: string) => {
	if (service) requested.add(service);
	return { accessibility: false, screenRecording: false };
});

vi.mock("electron", () => ({
	ipcMain: {
		handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
			handlers.set(channel, handler);
		},
		removeHandler: (channel: string) => {
			handlers.delete(channel);
		},
	},
	Notification: { isSupported: () => true },
	shell: { openExternal },
}));

vi.mock("../appshot/appshot-service.js", () => ({
	checkHelperPermissions: async () => ({ accessibility: false, screenRecording: false }),
	hasRequestedHelperPermissions: (service?: string) => (service ? requested.has(service) : requested.size > 0),
	requestHelperPermissions,
}));

async function openPane(kind: string): Promise<void> {
	const { registerPermissionsIpc } = await import("./permissions.js");
	registerPermissionsIpc();
	const handler = handlers.get("astravia:permissions:open-pane");
	expect(handler).toBeDefined();
	await handler!({}, kind);
}

describe("permissions open-pane", () => {
	beforeEach(() => {
		handlers.clear();
		requested.clear();
		openExternal.mockClear();
		requestHelperPermissions.mockClear();
		// 权限面板只对 macOS 生效。
		Object.defineProperty(process, "platform", { configurable: true, value: "darwin" });
	});

	it("asks the helper for one service only, so macOS shows a single sheet", async () => {
		await openPane("accessibility");

		// 旧实现无参数调用，helper 会同时请求两项并叠出两个系统授权框。
		expect(requestHelperPermissions).toHaveBeenCalledTimes(1);
		expect(requestHelperPermissions).toHaveBeenCalledWith("accessibility");
		expect(openExternal).toHaveBeenCalledTimes(1);
	});

	it("does not re-prompt when the user clicks the same permission again", async () => {
		await openPane("accessibility");
		await openPane("accessibility");

		// 第二次只打开系统设置：重复请求不会再生成可勾选项，只会再弹一个框。
		expect(requestHelperPermissions).toHaveBeenCalledTimes(1);
		expect(openExternal).toHaveBeenCalledTimes(2);
	});

	it("requests each helper service at most once, independently", async () => {
		await openPane("accessibility");
		await openPane("screen-recording");
		await openPane("screen-recording");

		expect(requestHelperPermissions.mock.calls.map(([service]) => service)).toEqual([
			"accessibility",
			"screen-recording",
		]);
		expect(openExternal).toHaveBeenCalledTimes(3);
	});
});
