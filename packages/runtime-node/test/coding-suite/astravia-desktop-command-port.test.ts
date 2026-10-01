import nodePath from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createNodeAstraviaDesktopCommandPort } from "../../src/coding/host/astravia-desktop-command-port.js";
import { NodeCommandProcessAbortedError } from "../../src/coding/host/command-process.js";
import { type CommandProcessPort, DesktopCommandAbortedError } from "../../src/coding/shared/desktop-command.js";

describe("Node Astravia Desktop command port", () => {
	it("prefers the explicit environment executable without reading configuration", async () => {
		const readTextFile = vi.fn<() => Promise<string>>();
		const port = createNodeAstraviaDesktopCommandPort({
			environment: { ASTRAVIA_DESKTOP_EXE: "C:\\tools\\Astravia.exe" },
			fileExists: async (filePath) => filePath === "C:\\tools\\Astravia.exe",
			readTextFile,
		});

		await expect(port.locate()).resolves.toEqual({ path: "C:\\tools\\Astravia.exe" });
		expect(readTextFile).not.toHaveBeenCalled();
	});

	it("uses a valid configured executable before platform defaults", async () => {
		const requestedFiles: string[] = [];
		const port = createNodeAstraviaDesktopCommandPort({
			platform: "linux",
			environment: {},
			astraviaHomePath: "/home/test/.astravia",
			fileExists: async (filePath) => filePath === "/opt/astravia/Astravia",
			readTextFile: async (filePath) => {
				requestedFiles.push(filePath);
				return JSON.stringify({ astraviaAppPath: "/opt/astravia/Astravia", ignored: true });
			},
		});

		await expect(port.locate()).resolves.toEqual({ path: "/opt/astravia/Astravia" });
		expect(requestedFiles).toEqual([nodePath.join("/home/test/.astravia", "desktop-config.json")]);
	});

	it("reports a stale configured path when a default executable is available", async () => {
		const port = createNodeAstraviaDesktopCommandPort({
			platform: "darwin",
			environment: {},
			astraviaHomePath: "/home/test/.astravia",
			fileExists: async (filePath) => filePath === "/Applications/Astravia.app/Contents/MacOS/Astravia",
			readTextFile: async () => JSON.stringify({ astraviaAppPath: "/old/Astravia" }),
		});

		await expect(port.locate()).resolves.toEqual({
			path: "/Applications/Astravia.app/Contents/MacOS/Astravia",
			staleConfiguredPath: "/old/Astravia",
		});
	});

	it("includes a stale configured path when no executable can be found", async () => {
		const port = createNodeAstraviaDesktopCommandPort({
			platform: "linux",
			environment: {},
			astraviaHomePath: "/home/test/.astravia",
			fileExists: async () => false,
			readTextFile: async () => JSON.stringify({ astraviaAppPath: "/old/Astravia" }),
		});

		await expect(port.locate()).rejects.toThrow("Configured astraviaAppPath is stale: /old/Astravia");
	});

	it("maps Node process cancellation to the platform-neutral command error", async () => {
		const commandProcess: CommandProcessPort = {
			async run() {
				throw new NodeCommandProcessAbortedError();
			},
		};
		const port = createNodeAstraviaDesktopCommandPort({ commandProcess });

		await expect(port.run("Astravia", [], { timeoutMs: 1 })).rejects.toBeInstanceOf(DesktopCommandAbortedError);
	});
});
