import { describe, expect, it } from "vitest";
import { isBooted, parseDeviceList, selectPreferredDevice } from "../src/runtime/device-registry.js";

function device(name: string, state = "Shutdown", udid = name): string {
	return JSON.stringify({ udid, name, state, runtime: "iOS 26.5" });
}

const NDJSON = [device("iPhone 16 Pro"), device("iPhone 17 Pro"), device("iPad Air 11-inch (M3)")].join("\n");

describe("parseDeviceList", () => {
	it("parses newline-delimited json", () => {
		expect(parseDeviceList(NDJSON).map((d) => d.name)).toEqual([
			"iPhone 16 Pro",
			"iPhone 17 Pro",
			"iPad Air 11-inch (M3)",
		]);
	});

	it("skips warnings and malformed lines instead of failing the whole table", () => {
		const noisy = `[baguette] warning: something\n${NDJSON}\n\nnot json`;
		expect(parseDeviceList(noisy)).toHaveLength(3);
	});

	it("rejects rows missing required fields", () => {
		expect(parseDeviceList('{"udid":"A","name":"n"}')).toEqual([]);
		expect(parseDeviceList('{"udid":"","name":"n","state":"s","runtime":"r"}')).toEqual([]);
		expect(parseDeviceList("[1,2,3]")).toEqual([]);
	});

	it("returns an empty list for empty output", () => {
		expect(parseDeviceList("")).toEqual([]);
	});
});

describe("selectPreferredDevice", () => {
	const devices = parseDeviceList(NDJSON);

	it("honours the udid the user pinned in settings", () => {
		expect(selectPreferredDevice(devices, "iPad Air 11-inch (M3)")?.name).toBe("iPad Air 11-inch (M3)");
	});

	it("ignores a pinned udid that no longer exists", () => {
		expect(selectPreferredDevice(devices, "gone")?.name).toBe("iPhone 17 Pro");
	});

	it("reuses an already booted device over the preferred model", () => {
		// 用户可能正在用那台设备，不要为了机型偏好把画面切走。
		const booted = parseDeviceList([device("iPhone 16 Pro", "Booted"), device("iPhone 17 Pro")].join("\n"));
		expect(selectPreferredDevice(booted, null)?.name).toBe("iPhone 16 Pro");
	});

	it("prefers iPhone 17 Pro when nothing is booted", () => {
		expect(selectPreferredDevice(devices, null)?.name).toBe("iPhone 17 Pro");
	});

	it("falls back through the iPhone 17 family, then any iPhone, then the first device", () => {
		const family = parseDeviceList([device("iPad Pro 13-inch (M4)"), device("iPhone 17 Pro Max")].join("\n"));
		expect(selectPreferredDevice(family, null)?.name).toBe("iPhone 17 Pro Max");

		const older = parseDeviceList([device("iPad mini (A17 Pro)"), device("iPhone 16e")].join("\n"));
		expect(selectPreferredDevice(older, null)?.name).toBe("iPhone 16e");

		const tabletsOnly = parseDeviceList([device("iPad mini (A17 Pro)"), device("iPad (A16)")].join("\n"));
		expect(selectPreferredDevice(tabletsOnly, null)?.name).toBe("iPad mini (A17 Pro)");
	});

	it("returns null with no devices", () => {
		expect(selectPreferredDevice([], "anything")).toBeNull();
	});
});

describe("isBooted", () => {
	it("matches the state string simctl and baguette both use", () => {
		expect(isBooted({ udid: "A", name: "n", state: "Booted", runtime: "r" })).toBe(true);
		expect(isBooted({ udid: "A", name: "n", state: "Booting", runtime: "r" })).toBe(false);
	});
});
