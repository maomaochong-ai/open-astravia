import { describe, expect, it, vi } from "vitest";
import { setupHttpProxy } from "../src/utils/http-proxy-setup.js";

describe("http-proxy", () => {
	it("installs loaded proxy support", async () => {
		const install = vi.fn();

		await setupHttpProxy(async () => ({ install }));

		expect(install).toHaveBeenCalledOnce();
	});
});
