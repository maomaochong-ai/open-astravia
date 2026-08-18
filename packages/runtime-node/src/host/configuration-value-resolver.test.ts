import { describe, expect, it } from "vitest";
import { createNodeConfigurationValueResolver } from "./configuration-value-resolver.js";

describe("Node configuration value resolver", () => {
	it("resolves environment names, literals, and headers", () => {
		const resolver = createNodeConfigurationValueResolver({
			environment: { TOKEN: "secret", EMPTY: "" },
		});

		expect(resolver.resolve("TOKEN")).toBe("secret");
		expect(resolver.resolve("literal")).toBe("literal");
		expect(resolver.resolveHeaders({ Authorization: "TOKEN", Empty: "!exit 1" })).toEqual({
			Authorization: "secret",
		});
	});

	it("caches command results until explicitly cleared", () => {
		const resolver = createNodeConfigurationValueResolver();
		const command = `!"${process.execPath}" -e "process.stdout.write(String(Date.now()))"`;
		const first = resolver.resolve(command);

		expect(first).toBeTruthy();
		expect(resolver.resolve(command)).toBe(first);
		resolver.clearCache();
		expect(resolver.resolve(command)).toBeTruthy();
	});
});
