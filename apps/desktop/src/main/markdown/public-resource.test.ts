import { EventEmitter } from "node:events";
import type { IncomingMessage, RequestOptions } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { readPublicResource } from "./public-resource.js";

const transport = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: transport.lookup }));
vi.mock("node:http", () => ({ request: transport.request }));
vi.mock("node:https", () => ({ request: transport.request }));
afterEach(() => {
	transport.lookup.mockReset();
	transport.request.mockReset();
});

class Response extends EventEmitter {
	statusCode = 200;
	headers: Record<string, string> = { "content-type": "image/png" };
	destroy(error?: Error) {
		if (error) this.emit("error", error);
	}
}

function serve(create: (url: URL) => Response, content = "icon") {
	transport.request.mockImplementation(
		(url: URL, _options: RequestOptions, receive: (response: IncomingMessage) => void) => {
			const request = new EventEmitter();
			return Object.assign(request, {
				end: () =>
					queueMicrotask(() => {
						const response = create(url);
						receive(response as unknown as IncomingMessage);
						response.emit("data", Buffer.from(content));
						response.emit("end");
					}),
			});
		},
	);
}

it("pins a validated public DNS result and sends no cookies, authorization or referring page", async () => {
	transport.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
	serve(() => new Response());
	const result = await readPublicResource(new URL("https://example.test/icon"), 100, new AbortController().signal);
	expect(result.body.toString()).toBe("icon");
	const options = transport.request.mock.calls[0][1] as RequestOptions;
	const resolved = vi.fn();
	options.lookup?.("example.test", {}, resolved);
	expect(resolved).toHaveBeenCalledWith(null, "8.8.8.8", 4);
	expect(transport.lookup).toHaveBeenCalledTimes(1);
	expect(options.headers).toEqual({ Accept: "text/html,image/*", "Accept-Encoding": "identity" });
});

it("revalidates redirects and refuses a private redirect before opening its socket", async () => {
	transport.lookup
		.mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }])
		.mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
	serve(() => Object.assign(new Response(), { statusCode: 302, headers: { location: "http://127.0.0.1/secret" } }));
	await expect(readPublicResource(new URL("https://example.test"), 100, new AbortController().signal)).rejects.toThrow(
		"Non-public",
	);
	expect(transport.request).toHaveBeenCalledTimes(1);
});

it("bounds response bytes and aborts even while DNS is pending", async () => {
	transport.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
	serve(() => new Response(), "too large");
	await expect(readPublicResource(new URL("https://example.test"), 3, new AbortController().signal)).rejects.toThrow(
		"too large",
	);
	transport.lookup.mockImplementation(() => new Promise(() => {}));
	const controller = new AbortController();
	const pending = readPublicResource(new URL("https://example.test"), 100, controller.signal);
	controller.abort();
	await expect(pending).rejects.toThrow("cancelled");
});
