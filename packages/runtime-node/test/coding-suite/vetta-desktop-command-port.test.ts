import nodePath from "node:path";
import { describe, expect, it, vi } from "vitest";
import { NodeCommandProcessAbortedError } from "../../src/coding/host/command-process.js";
import { createNodeVettaDesktopCommandPort } from "../../src/coding/host/vetta-desktop-command-port.js";
import { type CommandProcessPort, DesktopCommandAbortedError } from "../../src/coding/shared/desktop-command.js";

describe("Node Vetta Desktop command port", () => {
	it("prefers the explicit environment executable without reading configuration", async () => {
		const readTextFile = vi.fn<() => Promise<string>>();
		const port = createNodeVettaDesktopCommandPort({
			environment: { VETTA_DESKTOP_EXE: "C:\\tools\\Vetta.exe" },
			fileExists: async (filePath) => filePath === "C:\\tools\\Vetta.exe",
			readTextFile,
		});

		await expect(port.locate()).resolves.toEqual({ path: "C:\\tools\\Vetta.exe" });
		expect(readTextFile).not.toHaveBeenCalled();
	});

	it("uses a valid configured executable before platform defaults", async () => {
		const requestedFiles: string[] = [];
		const port = createNodeVettaDesktopCommandPort({
			platform: "linux",
			environment: {},
			vettaHomePath: "/home/test/.vetta",
			fileExists: async (filePath) => filePath === "/opt/vetta/Vetta",
			readTextFile: async (filePath) => {
				requestedFiles.push(filePath);
				return JSON.stringify({ vettaAppPath: "/opt/vetta/Vetta", ignored: true });
			},
		});

		await expect(port.locate()).resolves.toEqual({ path: "/opt/vetta/Vetta" });
		expect(requestedFiles).toEqual([nodePath.join("/home/test/.vetta", "desktop-config.json")]);
	});

	it("reports a stale configured path when a default executable is available", async () => {
		const port = createNodeVettaDesktopCommandPort({
			platform: "darwin",
			environment: {},
			vettaHomePath: "/home/test/.vetta",
			fileExists: async (filePath) => filePath === "/Applications/Vetta.app/Contents/MacOS/Vetta",
			readTextFile: async () => JSON.stringify({ vettaAppPath: "/old/Vetta" }),
		});

		await expect(port.locate()).resolves.toEqual({
			path: "/Applications/Vetta.app/Contents/MacOS/Vetta",
			staleConfiguredPath: "/old/Vetta",
		});
	});

	it("includes a stale configured path when no executable can be found", async () => {
		const port = createNodeVettaDesktopCommandPort({
			platform: "linux",
			environment: {},
			vettaHomePath: "/home/test/.vetta",
			fileExists: async () => false,
			readTextFile: async () => JSON.stringify({ vettaAppPath: "/old/Vetta" }),
		});

		await expect(port.locate()).rejects.toThrow("Configured vettaAppPath is stale: /old/Vetta");
	});

	it("maps Node process cancellation to the platform-neutral command error", async () => {
		const commandProcess: CommandProcessPort = {
			async run() {
				throw new NodeCommandProcessAbortedError();
			},
		};
		const port = createNodeVettaDesktopCommandPort({ commandProcess });

		await expect(port.run("Vetta", [], { timeoutMs: 1 })).rejects.toBeInstanceOf(DesktopCommandAbortedError);
	});
});
