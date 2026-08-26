import { describe, expect, it } from "vitest";
import { shouldUseWindowsCommandShell } from "../../src/mcp/transports/stdio/stdio-shell.js";

describe("Windows MCP stdio process launch", () => {
	it("launches native executables directly so paths and argv bypass cmd.exe", () => {
		expect(shouldUseWindowsCommandShell("C:\\Program Files\\nodejs\\node.exe", "win32")).toBe(false);
		expect(shouldUseWindowsCommandShell("C:\\tools\\server.com", "win32")).toBe(false);
	});

	it("keeps cmd.exe resolution for Windows batch and PATH shims", () => {
		expect(shouldUseWindowsCommandShell("C:\\tools\\server.cmd", "win32")).toBe(true);
		expect(shouldUseWindowsCommandShell("npx", "win32")).toBe(true);
	});

	it("never inserts a shell on Unix platforms", () => {
		expect(shouldUseWindowsCommandShell("node", "linux")).toBe(false);
	});
});
