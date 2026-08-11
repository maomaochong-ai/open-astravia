import { afterEach, describe, expect, test, vi } from "vitest";
import { RpcExtensionUIBridge } from "../../src/modes/rpc/rpc-extension-ui-bridge.js";
import { RpcHostBridge } from "../../src/modes/rpc/rpc-host-bridge.js";
import type { RpcExtensionUIRequest, RpcHostRequest } from "../../src/modes/rpc/rpc-types.js";

afterEach(() => {
	vi.useRealTimers();
});

describe("RPC extension UI bridge", () => {
	test("correlates dialog responses and keeps notification requests fire-and-forget", async () => {
		const requests: RpcExtensionUIRequest[] = [];
		const bridge = new RpcExtensionUIBridge((request) => requests.push(request));
		const context = bridge.createContext();

		const confirmation = context.confirm("Confirm", "Continue?");
		const confirmRequest = requests.at(-1);
		expect(confirmRequest).toMatchObject({
			type: "extension_ui_request",
			method: "confirm",
			title: "Confirm",
			message: "Continue?",
		});
		if (!confirmRequest) throw new Error("Expected confirm request");
		expect(
			bridge.handle({
				type: "extension_ui_response",
				id: confirmRequest.id,
				confirmed: true,
			}),
		).toBe(true);
		await expect(confirmation).resolves.toBe(true);

		context.notify("notice", "warning");
		expect(requests.at(-1)).toMatchObject({
			method: "notify",
			message: "notice",
			notifyType: "warning",
		});
		expect(
			bridge.handle({
				type: "extension_ui_response",
				id: "missing",
				cancelled: true,
			}),
		).toBe(false);
	});

	test("settles aborted, timed-out and disposed dialogs without leaking pending requests", async () => {
		vi.useFakeTimers();
		const requests: RpcExtensionUIRequest[] = [];
		const bridge = new RpcExtensionUIBridge((request) => requests.push(request));
		const context = bridge.createContext();
		const controller = new AbortController();

		const input = context.input("Input", "placeholder", { signal: controller.signal });
		controller.abort();
		await expect(input).resolves.toBeUndefined();

		const selection = context.select("Select", ["a"], { timeout: 25 });
		await vi.advanceTimersByTimeAsync(25);
		await expect(selection).resolves.toBeUndefined();

		const editor = context.editor("Editor", "draft");
		const editorRequest = requests.at(-1);
		if (!editorRequest) throw new Error("Expected editor request");
		bridge.dispose();
		await expect(editor).resolves.toBeUndefined();
		expect(bridge.handle({ type: "extension_ui_response", id: editorRequest.id, value: "late response" })).toBe(
			false,
		);
	});
});

describe("RPC host bridge", () => {
	test("correlates success and structured failure responses", async () => {
		const requests: RpcHostRequest[] = [];
		const host = new RpcHostBridge((request) => requests.push(request));
		const bridge = host.createBridge();

		const success = bridge.sendAttachment({ path: "image.png", kind: "image" });
		const successRequest = requests.at(-1);
		if (!successRequest) throw new Error("Expected host request");
		expect(
			host.handle({ type: "host_response", id: successRequest.id, success: true, data: { messageId: "m1" } }),
		).toBe(true);
		await expect(success).resolves.toEqual({ messageId: "m1" });

		const failure = bridge.sendAttachment({ path: "file.txt", kind: "file" });
		const failureRequest = requests.at(-1);
		if (!failureRequest) throw new Error("Expected host request");
		expect(
			host.handle({
				type: "host_response",
				id: failureRequest.id,
				success: false,
				error: "quota exhausted",
				errorCode: "quota_exhausted",
			}),
		).toBe(true);
		await expect(failure).rejects.toThrow("quota exhausted [quota_exhausted]");
		expect(host.handle({ type: "host_response", id: failureRequest.id, success: true })).toBe(false);
	});

	test("rejects timed-out and disposed host requests", async () => {
		vi.useFakeTimers();
		const requests: RpcHostRequest[] = [];
		const host = new RpcHostBridge((request) => requests.push(request), 25);
		const bridge = host.createBridge();

		const timedOut = bridge.sendAttachment({ path: "image.png", kind: "image" });
		const timeoutExpectation = expect(timedOut).rejects.toThrow("did not respond within 25ms");
		await vi.advanceTimersByTimeAsync(25);
		await timeoutExpectation;

		const disposed = bridge.sendAttachment({ path: "file.txt", kind: "file" });
		const disposedRequest = requests.at(-1);
		if (!disposedRequest) throw new Error("Expected disposed host request");
		const disposeExpectation = expect(disposed).rejects.toThrow("transport closed");
		host.dispose("transport closed");
		await disposeExpectation;
		expect(host.handle({ type: "host_response", id: disposedRequest.id, success: true })).toBe(false);
	});
});
