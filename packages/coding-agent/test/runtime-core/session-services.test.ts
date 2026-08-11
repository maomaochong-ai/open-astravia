import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createCodingAgentHistoricalSessionCatalog,
	createCodingAgentHistoricalSessionFileHistoryReader,
} from "@vetta/coding-agent/historical-sessions";
import {
	CatalogRoutedRuntimeSessionAccessResolver,
	CompositeRuntimeSessionCatalog,
	CompositeRuntimeSessionFileHistoryReader,
	RuntimeHost,
	type RuntimeSessionCatalog,
	type RuntimeSessionFileHistoryReader,
} from "@vetta/runtime-core";
import { describe, expect, it, vi } from "vitest";
import {
	type CodingAgentSharedModelSource,
	createCodingAgentSharedModelController,
} from "../../src/public-api/host-services.js";

describe("runtime host process services", () => {
	it("delegates shared model auth refresh and background refresh", async () => {
		const setServerToken = vi.fn();
		const loadRemoteModels = vi.fn(async (): Promise<"unauthorized" | undefined> => undefined);
		const source: CodingAgentSharedModelSource = { setServerToken, loadRemoteModels };
		const controller = createCodingAgentSharedModelController(source);

		await controller.refreshAuth("token");
		controller.refreshInBackground();

		expect(setServerToken).toHaveBeenCalledWith("token");
		expect(loadRemoteModels).toHaveBeenCalledTimes(2);
	});

	it("delegates offline catalog and direct file history operations", async () => {
		const projects = [{ cwd: "C:/workspace", sessionCount: 2 }];
		const sessions = [
			{
				id: "session-1",
				path: "C:/sessions/one.jsonl",
				cwd: "C:/workspace",
				firstMessage: "hello",
				modifiedAt: 1,
			},
		];
		const history = [
			{ type: "message" as const, message: { role: "user" as const, content: "hello", timestamp: 1 } },
		];
		const listProjects = vi.fn(async () => projects);
		const listSessions = vi.fn(async () => sessions);
		const renameSession = vi.fn(async () => {});
		const deleteSessionArtifacts = vi.fn(async () => {});
		const read = vi.fn(() => ({ history }));
		const sessionCatalog: RuntimeSessionCatalog = {
			ownsSession: vi.fn(async () => true),
			listProjects,
			listSessions,
			renameSession,
			deleteSessionArtifacts,
		};
		const sessionFileHistoryReader: RuntimeSessionFileHistoryReader = {
			canRead: vi.fn(() => true),
			read,
		};
		const host = new RuntimeHost({ sessionCatalog, sessionFileHistoryReader });

		expect(await host.listProjects()).toEqual(projects);
		expect(await host.listSessions("C:/workspace", "C:/sessions")).toEqual(sessions);
		expect(host.readSessionHistoryFromFile("C:/sessions/one.jsonl")).toEqual({ history });
		await host.renameSession("C:/sessions/one.jsonl", "renamed");
		await host.deleteSession("C:/sessions/one.jsonl");

		expect(listSessions).toHaveBeenCalledWith("C:/workspace", "C:/sessions");
		expect(read).toHaveBeenCalledWith("C:/sessions/one.jsonl");
		expect(renameSession).toHaveBeenCalledWith("C:/sessions/one.jsonl", "renamed");
		expect(deleteSessionArtifacts).toHaveBeenCalledWith("C:/sessions/one.jsonl");
	});

	it("merges offline catalogs and routes lifecycle operations by file ownership", async () => {
		const legacyRename = vi.fn(async () => {});
		const greenfieldRename = vi.fn(async () => {});
		const greenfieldDelete = vi.fn(async () => {});
		const legacyCatalog: RuntimeSessionCatalog = {
			ownsSession: async (path) => path.endsWith("legacy.jsonl"),
			listProjects: async () => [{ cwd: "C:/workspace", sessionCount: 1 }],
			listSessions: async () => [
				{
					id: "legacy",
					path: "C:/sessions/legacy.jsonl",
					cwd: "C:/workspace",
					firstMessage: "legacy",
					modifiedAt: 1,
				},
			],
			renameSession: legacyRename,
			deleteSessionArtifacts: vi.fn(async () => {}),
		};
		const greenfieldCatalog: RuntimeSessionCatalog = {
			ownsSession: async (path) => path.endsWith("greenfield.conversation.jsonl"),
			listProjects: async () => [
				{ cwd: "C:/workspace", sessionCount: 1 },
				{ cwd: "C:/other", sessionCount: 1 },
			],
			listSessions: async () => [
				{
					id: "greenfield",
					path: "C:/sessions/greenfield.conversation.jsonl",
					cwd: "C:/workspace",
					firstMessage: "greenfield",
					modifiedAt: 2,
				},
			],
			renameSession: greenfieldRename,
			deleteSessionArtifacts: greenfieldDelete,
		};
		const catalog = new CompositeRuntimeSessionCatalog([legacyCatalog, greenfieldCatalog]);
		const accessResolver = new CatalogRoutedRuntimeSessionAccessResolver([
			{
				catalog: legacyCatalog,
				access: { readHistory: true, interactiveResume: true, rename: true, delete: true },
			},
			{
				catalog: greenfieldCatalog,
				access: { readHistory: true, interactiveResume: false, rename: false, delete: true },
			},
		]);
		const host = new RuntimeHost({ sessionCatalog: catalog, sessionAccessResolver: accessResolver });

		expect(await catalog.listProjects()).toEqual([
			{ cwd: "C:/other", sessionCount: 1 },
			{ cwd: "C:/workspace", sessionCount: 2 },
		]);
		expect((await catalog.listSessions("C:/workspace")).map(({ id }) => id)).toEqual(["greenfield", "legacy"]);
		await catalog.renameSession("C:/sessions/greenfield.conversation.jsonl", "renamed");
		await catalog.deleteSessionArtifacts("C:/sessions/greenfield.conversation.jsonl");
		expect(greenfieldRename).toHaveBeenCalledOnce();
		expect(greenfieldDelete).toHaveBeenCalledOnce();
		expect(legacyRename).not.toHaveBeenCalled();
		expect(await host.resolveSessionAccess("C:/sessions/greenfield.conversation.jsonl")).toEqual({
			readHistory: true,
			interactiveResume: false,
			rename: false,
			delete: true,
		});
		await expect(host.renameSession("C:/sessions/greenfield.conversation.jsonl", "blocked")).rejects.toMatchObject({
			code: "INVALID_REQUEST",
		});
		await host.deleteSession("C:/sessions/greenfield.conversation.jsonl");
		expect(greenfieldDelete).toHaveBeenCalledTimes(2);
		expect(await host.resolveSessionAccess("C:/sessions/unknown.data")).toBeUndefined();

		const reader = new CompositeRuntimeSessionFileHistoryReader([
			{ canRead: (path) => path.endsWith("legacy.jsonl"), read: () => ({ history: [] }) },
			{
				canRead: (path) => path.endsWith("greenfield.conversation.jsonl"),
				read: () => ({ history: [{ type: "settings_assist_marker", timestamp: "greenfield" }] }),
			},
		]);
		expect(reader.read("C:/sessions/greenfield.conversation.jsonl").history).toEqual([
			{ type: "settings_assist_marker", timestamp: "greenfield" },
		]);
	});

	it("preserves legacy JSONL listing, history, rename and deletion behavior", async () => {
		const root = await mkdtemp(join(tmpdir(), "vetta-runtime-core-"));
		const sessionDir = join(root, "sessions");
		const sessionPath = join(sessionDir, "legacy-session.jsonl");
		try {
			await mkdir(sessionDir, { recursive: true });
			await writeFile(
				sessionPath,
				`${[
					JSON.stringify({
						type: "session",
						version: 3,
						id: "legacy-session",
						timestamp: "2025-01-01T00:00:00.000Z",
						cwd: root,
					}),
					"{malformed legacy line",
					JSON.stringify({
						type: "message",
						id: "user-1",
						parentId: null,
						timestamp: "2025-01-01T00:00:01.000Z",
						message: { role: "user", content: "hello", timestamp: 1 },
					}),
					JSON.stringify({
						type: "message",
						id: "assistant-1",
						parentId: "user-1",
						timestamp: "2025-01-01T00:00:02.000Z",
						message: {
							role: "assistant",
							content: [{ type: "text", text: "world" }],
							api: "openai-responses",
							provider: "openai",
							model: "test-model",
							usage: {
								input: 1,
								output: 1,
								cacheRead: 0,
								cacheWrite: 0,
								totalTokens: 2,
								cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
							},
							stopReason: "stop",
							timestamp: 2,
						},
					}),
				].join("\n")}\n`,
				"utf8",
			);

			const catalog = createCodingAgentHistoricalSessionCatalog();
			const historyReader = createCodingAgentHistoricalSessionFileHistoryReader();
			const listed = await catalog.listSessions(root, sessionDir);
			expect(listed).toHaveLength(1);
			expect(listed[0]).toMatchObject({ path: sessionPath, cwd: root, firstMessage: "hello" });
			expect(await catalog.ownsSession(sessionPath)).toBe(true);
			expect(historyReader.canRead(sessionPath)).toBe(true);
			expect(historyReader.read(sessionPath).history).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						type: "message",
						message: expect.objectContaining({ role: "user", content: "hello" }),
					}),
				]),
			);

			await catalog.renameSession(sessionPath, "renamed");
			expect((await catalog.listSessions(root, sessionDir))[0]?.name).toBe("renamed");
			expect(existsSync(`${sessionPath}.lock`)).toBe(false);
			await catalog.deleteSessionArtifacts(sessionPath);
			expect(existsSync(sessionPath)).toBe(false);
			expect(existsSync(`${sessionPath}.lock`)).toBe(false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
