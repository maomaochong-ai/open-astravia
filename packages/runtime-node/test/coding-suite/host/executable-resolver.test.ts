import { describe, expect, it } from "vitest";
import { createLocalCodingToolExecutableResolver } from "../../../src/coding/index.js";

describe("coding tool executable resolver", () => {
	it("prefers a managed binary over PATH", async () => {
		const commandLookups: string[] = [];
		const resolver = createLocalCodingToolExecutableResolver({
			binDirectory: "C:/vetta/bin",
			platform: "win32",
			fileExists: (path) => path.replace(/\\/g, "/") === "C:/vetta/bin/rg.exe",
			commandExists: (command) => {
				commandLookups.push(command);
				return true;
			},
		});

		const resolved = await resolver.resolve("rg");
		expect(resolved?.replace(/\\/g, "/")).toBe("C:/vetta/bin/rg.exe");
		expect(commandLookups).toEqual([]);
	});

	it("falls back to a PATH command when no managed binary exists", async () => {
		const commandLookups: string[] = [];
		const resolver = createLocalCodingToolExecutableResolver({
			binDirectory: "C:/vetta/bin",
			platform: "win32",
			fileExists: () => false,
			commandExists: (command) => {
				commandLookups.push(command);
				return command === "fd";
			},
		});

		await expect(resolver.resolve("fd")).resolves.toBe("fd");
		expect(commandLookups).toEqual(["fd"]);
	});

	it("returns undefined when neither managed binary nor PATH command exists", async () => {
		const resolver = createLocalCodingToolExecutableResolver({
			binDirectory: "C:/vetta/bin",
			fileExists: () => false,
			commandExists: () => false,
		});

		await expect(resolver.resolve("rg")).resolves.toBeUndefined();
		await expect(resolver.resolve("fd")).resolves.toBeUndefined();
	});

	it("rechecks managed binaries and PATH on every resolution", async () => {
		let managedAvailable = true;
		let pathAvailable = true;
		const resolver = createLocalCodingToolExecutableResolver({
			binDirectory: "C:/vetta/bin",
			platform: "win32",
			fileExists: () => managedAvailable,
			commandExists: () => pathAvailable,
		});

		const managedPath = await resolver.resolve("rg");
		expect(managedPath?.replace(/\\/g, "/")).toBe("C:/vetta/bin/rg.exe");
		managedAvailable = false;
		await expect(resolver.resolve("rg")).resolves.toBe("rg");
		pathAvailable = false;
		await expect(resolver.resolve("rg")).resolves.toBeUndefined();
	});
});
