import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("electron", () => ({ net: electron }));

import { electronManualRedirectFetch } from "./plugin-network-electron-fetch.js";

class FakeRequest extends EventEmitter {
	readonly abort = vi.fn();
	readonly end = vi.fn();
}

class FakeIncomingMessage extends EventEmitter {
	readonly headers: Record<string, string | string[]>;
	readonly statusCode: number;
	readonly statusMessage: string;

	constructor(statusCode: number, statusMessage: string, headers: Record<string, string | string[]> = {}) {
		super();
		this.statusCode = statusCode;
		this.statusMessage = statusMessage;
		this.headers = headers;
	}
}

afterEach(() => {
	electron.request.mockReset();
});

describe("Electron plugin network fetch adapter", () => {
	it("turns Electron's cancelled manual redirect into an inspectable response", async () => {
		const request = new FakeRequest();
		electron.request.mockReturnValue(request);
		request.end.mockImplementation(() => {
			queueMicrotask(() => {
				request.emit("redirect", 302, "GET", "https://downloads.example/runtime.zip", {
					location: ["https://downloads.example/runtime.zip"],
				});
				request.emit("error", new Error("Redirect was cancelled"));
			});
			return request;
		});

		const response = await electronManualRedirectFetch("https://example.com/runtime.zip", {
			redirect: "manual",
		});

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe("https://downloads.example/runtime.zip");
		expect(electron.request).toHaveBeenCalledWith(
			expect.objectContaining({
				credentials: "omit",
				method: "GET",
				redirect: "manual",
				url: "https://example.com/runtime.zip",
			}),
		);
	});

	it("streams a successful Electron response through the Fetch response contract", async () => {
		const request = new FakeRequest();
		const incoming = new FakeIncomingMessage(200, "OK", { "content-type": "text/plain" });
		electron.request.mockReturnValue(request);
		request.end.mockImplementation(() => {
			queueMicrotask(() => {
				request.emit("response", incoming);
				queueMicrotask(() => {
					incoming.emit("data", Buffer.from("runtime"));
					incoming.emit("end");
				});
			});
			return request;
		});

		const response = await electronManualRedirectFetch("https://example.com/runtime.zip", {
			redirect: "manual",
		});

		expect(response.status).toBe(200);
		await expect(response.text()).resolves.toBe("runtime");
	});
});
