import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { processCliFileArguments } from "../src/file-processor.js";

const TINY_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

describe("processCliFileArguments", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `cli-file-processor-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it("processes image arguments independently from model image filtering", async () => {
		const imagePath = join(testDir, "test.png");
		writeFileSync(imagePath, Buffer.from(TINY_PNG_BASE64, "base64"));

		const result = await processCliFileArguments([imagePath], { cwd: testDir });

		expect(result.images).toHaveLength(1);
		expect(result.images[0]?.type).toBe("image");
	});

	it("embeds text files in the initial prompt", async () => {
		const textPath = join(testDir, "test.txt");
		writeFileSync(textPath, "Hello, world!");

		const result = await processCliFileArguments([textPath], { cwd: testDir });

		expect(result.images).toHaveLength(0);
		expect(result.text).toContain("Hello, world!");
	});

	it("reports missing files without terminating the process", async () => {
		await expect(processCliFileArguments(["missing.txt"], { cwd: testDir })).rejects.toThrow(/File not found/);
	});
});
