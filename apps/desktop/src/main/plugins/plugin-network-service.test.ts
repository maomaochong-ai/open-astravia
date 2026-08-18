import { afterEach, describe, expect, it, vi } from "vitest";
import { isPluginNetworkHostAllowed, requestForPlugin } from "./plugin-network-service.js";

const officialPolicy = {
	id: "official-plugin",
	trustLevel: "official" as const,
	allowedNetworkHosts: ["*"],
};

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("plugin network host policy", () => {
	it("allows declared private IPs and localhost", () => {
		const policy = {
			id: "local-plugin",
			trustLevel: "local" as const,
			allowedNetworkHosts: ["localhost", "192.168.50.50", "::1"],
		};

		expect(isPluginNetworkHostAllowed(policy, "localhost")).toBe(true);
		expect(isPluginNetworkHostAllowed(policy, "192.168.50.50")).toBe(true);
		expect(isPluginNetworkHostAllowed(policy, "[::1]")).toBe(true);
		expect(isPluginNetworkHostAllowed(policy, "127.0.0.1")).toBe(false);
	});

	it("limits unrestricted wildcard access to official plugins", () => {
		expect(isPluginNetworkHostAllowed(officialPolicy, "anything.example")).toBe(true);
		expect(
			isPluginNetworkHostAllowed(
				{ ...officialPolicy, id: "community-plugin", trustLevel: "community" },
				"anything.example",
			),
		).toBe(false);
	});

	it("matches wildcard subdomains without matching the root domain", () => {
		const policy = {
			id: "community-plugin",
			trustLevel: "community" as const,
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
				{ id: "local-plugin", trustLevel: "local", allowedNetworkHosts: ["example.com"] },
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
				{ id: "local-plugin", trustLevel: "local", allowedNetworkHosts: ["example.com"] },
				{ url: "https://example.com/start", responseType: "text" },
			),
		).rejects.toThrow("Plugin network host is not declared: 127.0.0.1");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
