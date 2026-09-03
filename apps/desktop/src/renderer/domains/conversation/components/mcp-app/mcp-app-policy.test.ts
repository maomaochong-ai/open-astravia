import { describe, expect, it } from "vitest";
import { buildMcpAppAllow, buildMcpAppCsp } from "./mcp-app-policy";

describe("MCP App sandbox policy", () => {
	it("builds a restrictive CSP from canonical declared origins", () => {
		const policy = buildMcpAppCsp({
			connectDomains: ["https://api.example.test", "wss://socket.example.test", "https://bad.test/path"],
			resourceDomains: ["https://cdn.example.test", "https://*.assets.example.test"],
			frameDomains: ["javascript:alert(1)"],
		});

		expect(policy).toContain("default-src 'none'");
		expect(policy).toContain("object-src 'none'");
		expect(policy).toContain("connect-src https://api.example.test wss://socket.example.test");
		expect(policy).toContain("https://*.assets.example.test");
		expect(policy).toContain("frame-src 'none'");
		expect(policy).not.toContain("bad.test/path");
		expect(policy).not.toContain("javascript:");
	});

	it("grants no browser permission unless both server and host allow it", () => {
		const meta = { permissions: { camera: {}, microphone: {} } };
		expect(buildMcpAppAllow(meta)).toBeUndefined();
		expect(buildMcpAppAllow(meta, ["microphone"])).toBe("microphone");
	});
});
