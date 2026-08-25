import { describe, expect, it, vi } from "vitest";
import { setupHttpProxy } from "../src/utils/http-proxy-setup.js";

describe("http-proxy (undici load failure)", () => {
	it("warns and resolves without leaking the loader rejection", async () => {
		const warn = vi.fn();
		const failure = Object.assign(new Error("No such built-in module: node:sqlite"), {
			code: "ERR_UNKNOWN_BUILTIN_MODULE",
		});

		await expect(setupHttpProxy(async () => Promise.reject(failure), warn)).resolves.toBeUndefined();
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("HTTP proxy support disabled"));
	});
});
