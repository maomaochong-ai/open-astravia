import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createDesktopRuntimeHostPlatformServices } from "./runtime-host-platform.js";

describe("Desktop RuntimeHost platform services", () => {
	it("provides one coherent Node host capability bundle", () => {
		const services = createDesktopRuntimeHostPlatformServices();

		expect(services.pathServices.normalize("relative/session.jsonl")).toBe(resolve("relative/session.jsonl"));
		expect(services.sandboxGrantStore.list("unknown-session")).toEqual([]);
		expect(services.sandboxGrantStore.revoke("unknown-session", "unknown-grant")).toBe(false);
	});
});
