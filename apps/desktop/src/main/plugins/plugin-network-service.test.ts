import { afterEach, describe, expect, it, vi } from "vitest";
import { isPluginNetworkHostAllowed, requestForPlugin } from "./plugin-network-service.js";

const unrestrictedPolicy = {
	id: "unrestricted-plugin",
	allowedNetworkHosts: ["*"],
};

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("plugin network host policy", () => {
	it("allows declared private IPs and localhost", () => {
		const policy = {
			id: "local-plugin",
			allowedNetworkHosts: ["localhost", "192.168.50.50", "::1"],
		};

		expect(isPluginNetworkHostAllowed(policy, "localhost")).toBe(true);
		expect(isPluginNetworkHostAllowed(policy, "192.168.50.50")).toBe(true);
		expect(isPluginNetworkHostAllowed(policy, "[::1]")).toBe(true);
		expect(isPluginNetworkHostAllowed(policy, "127.0.0.1")).toBe(false);
	});

	it("honors an explicit unrestricted wildcard", () => {
		expect(isPluginNetworkHostAllowed(unrestrictedPolicy, "anything.example")).toBe(true);
	});

	it("matches wildcard subdomains without matching the root domain", () => {
		const policy = {
			id: "community-plugin",
			allowedNetworkHosts: ["*.cdn.example.com"],
		};

		expect(isPluginNetworkHostAllowed(policy, "images.cdn.example.com")).toBe(true);
		expect(isPluginNetworkHostAllowed(policy, "cdn.example.com")).toBe(false);
		expect(isPluginNetworkHostAllowed(policy, "notcdn.example.com")).toBe(false);
	});

	it("rejects undeclared hosts before fetch", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			requestForPlugin(
				{ id: "local-plugin", allowedNetworkHosts: ["example.com"] },
				{ url: "http://127.0.0.1:8188", responseType: "text" },
			),
		).rejects.toThrow("Plugin network host is not declared: 127.0.0.1");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("revalidates redirect hosts", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(null, {
				status: 302,
				headers: { location: "http://127.0.0.1:8188/private" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			requestForPlugin(
				{ id: "local-plugin", allowedNetworkHosts: ["example.com"] },
				{ url: "https://example.com/start", responseType: "text" },
			),
		).rejects.toThrow("Plugin network host is not declared: 127.0.0.1");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("follows allowed redirects and strips credentials across origins", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(null, {
					status: 302,
					headers: { location: "https://downloads.example.com/runtime.zip" },
				}),
			)
			.mockResolvedValueOnce(new Response("runtime", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			requestForPlugin(
				{ id: "runtime-plugin", allowedNetworkHosts: ["example.com", "downloads.example.com"] },
				{
					url: "https://example.com/runtime.zip",
					headers: { authorization: "Bearer secret", cookie: "session=secret", "x-request": "kept" },
					responseType: "text",
				},
			),
		).resolves.toMatchObject({ ok: true, status: 200, body: "runtime" });

		const redirectedInit = fetchMock.mock.calls[1]?.[1];
		const redirectedHeaders = new Headers(redirectedInit?.headers);
		expect(fetchMock.mock.calls[1]?.[0].toString()).toBe("https://downloads.example.com/runtime.zip");
		expect(redirectedHeaders.has("authorization")).toBe(false);
		expect(redirectedHeaders.has("cookie")).toBe(false);
		expect(redirectedHeaders.get("x-request")).toBe("kept");
	});

	it("retains transport diagnostics while exposing only a safe network failure", async () => {
		const transportError = Object.assign(new Error("request to https://example.com/?token=secret failed"), {
			code: "ERR_CONNECTION_RESET",
		});
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(transportError));

		const failure = await requestForPlugin(
			{ id: "safe-plugin", allowedNetworkHosts: ["example.com"] },
			{ url: "https://example.com/data", responseType: "text" },
		).catch((error: unknown) => error);

		expect(failure).toMatchObject({
			message: "Plugin network request failed (ERR_CONNECTION_RESET)",
			reason: "transport-failed",
			cause: transportError,
		});
		expect(String(failure)).not.toContain("token=secret");
	});
});
