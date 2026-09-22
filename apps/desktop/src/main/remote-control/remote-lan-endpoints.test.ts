import { describe, expect, it } from "vitest";
import { listLanEndpoints } from "./remote-lan-endpoints.js";

describe("listLanEndpoints", () => {
	it("prefers private Wi-Fi style addresses and pushes virtual adapters last", () => {
		const endpoints = listLanEndpoints(43117, {
			lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
			en0: [
				{ address: "192.168.1.20", family: "IPv4", internal: false },
				{ address: "fe80::1", family: "IPv6", internal: false },
			],
			en5: [{ address: "169.254.10.4", family: "IPv4", internal: false }],
			utun3: [{ address: "100.64.0.9", family: "IPv4", internal: false }],
			bridge100: [{ address: "10.211.55.2", family: "IPv4", internal: false }],
			eth1: [{ address: "203.0.113.7", family: 4, internal: false }],
		});
		expect(endpoints).toEqual(["192.168.1.20:43117", "10.211.55.2:43117", "203.0.113.7:43117", "100.64.0.9:43117"]);
	});

	it("returns nothing when only loopback exists", () => {
		expect(listLanEndpoints(1, { lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }] })).toEqual([]);
	});
});
