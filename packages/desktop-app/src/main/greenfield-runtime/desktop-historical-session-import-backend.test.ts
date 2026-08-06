import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeHostSessionAssembly, RuntimeSessionCreateRequest } from "@vetta/runtime-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	DesktopHistoricalSessionImportBackend,
	DesktopHistoricalSessionImportError,
} from "./desktop-historical-session-import-backend.js";

const temporaryRoots = new Set<string>();

afterEach(async () => {
	await Promise.all([...temporaryRoots].map((root) => rm(root, { force: true, recursive: true })));
	temporaryRoots.clear();
});

describe("Desktop historical session import backend", () => {
	it("imports supported historical data before opening the production Runtime", async () => {
		const fixture = await createFixture(historicalSession("hello"));
		const sourceContent = await readFile(fixture.sourcePath, "utf8");
		const assembly = {} as RuntimeHostSessionAssembly;
		const createAssembly = vi.fn<(request: RuntimeSessionCreateRequest) => Promise<RuntimeHostSessionAssembly>>();
		createAssembly.mockResolvedValue(assembly);
		const backend = new DesktopHistoricalSessionImportBackend({ createAssembly });

		await expect(backend.createAssembly(createRequest(fixture.sourcePath, fixture.targetRootDir))).resolves.toBe(
			assembly,
		);
		expect(createAssembly).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionDir: fixture.targetRootDir,
				sessionPath: expect.stringMatching(/\.conversation\.jsonl$/),
			}),
		);
		expect(await readFile(fixture.sourcePath, "utf8")).toBe(sourceContent);
	});

	it("rejects incompatible content without invoking the Runtime or creating a target", async () => {
		const fixture = await createFixture(
			jsonLines([
				header(4),
				{
					type: "future_entry",
					id: "future-1",
					parentId: null,
					timestamp: "2026-01-01T00:00:01.000Z",
				},
			]),
		);
		const createAssembly = vi.fn<(request: RuntimeSessionCreateRequest) => Promise<RuntimeHostSessionAssembly>>();
		const backend = new DesktopHistoricalSessionImportBackend({ createAssembly });

		await expect(
			backend.createAssembly(createRequest(fixture.sourcePath, fixture.targetRootDir)),
		).rejects.toMatchObject({
			name: "DesktopHistoricalSessionImportError",
			incompatibility: {
				errorCode: "session_version_unsupported",
				sourceVersion: 4,
			},
		});
		expect(createAssembly).not.toHaveBeenCalled();
		await expect(readFile(fixture.targetRootDir)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("exposes a typed import error", () => {
		const error = new DesktopHistoricalSessionImportError({
			kind: "session-incompatible",
			status: "not-representable",
			sourcePath: "C:/sessions/future.jsonl",
			errorCode: "session_version_unsupported",
			sourceVersion: 4,
		});

		expect(error.message).toContain("session_version_unsupported");
	});
});

async function createFixture(content: string): Promise<{ sourcePath: string; targetRootDir: string }> {
	const root = await mkdtemp(join(tmpdir(), "vetta-desktop-historical-import-"));
	temporaryRoots.add(root);
	const sourcePath = join(root, "historical.jsonl");
	const targetRootDir = join(root, "conversations");
	await writeFile(sourcePath, content, "utf8");
	return { sourcePath, targetRootDir };
}

function createRequest(sourcePath: string, sessionDir: string): RuntimeSessionCreateRequest {
	return {
		sessionPath: sourcePath,
		sessionDir,
		executionMode: "full-access",
		enableSubagents: false,
		getSessionId: () => undefined,
	};
}

function historicalSession(content: string): string {
	return jsonLines([
		header(3),
		{
			type: "message",
			id: "user-1",
			parentId: null,
			timestamp: "2026-01-01T00:00:01.000Z",
			message: { role: "user", content, timestamp: 1 },
		},
	]);
}

function header(version: number) {
	return {
		type: "session",
		version,
		id: "historical-source",
		timestamp: "2026-01-01T00:00:00.000Z",
		cwd: "C:/historical-workspace",
	};
}

function jsonLines(records: readonly unknown[]): string {
	return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}
