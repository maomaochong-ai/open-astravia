import { join } from "node:path";
import type { ProjectInfo, RuntimeSessionCatalog, SessionHistoryInfo } from "@vetta/runtime-core";
import { describe, expect, it, vi } from "vitest";
import { isSessionPathInDirectory, PathFilteredRuntimeSessionCatalog } from "./session-catalog.js";

describe("PathFilteredRuntimeSessionCatalog", () => {
	it("keeps IM ownership separate from Desktop Runtime ownership", async () => {
		const catalog = alwaysOwnedCatalog();
		const sessionDir = join(process.cwd(), "vetta", "im", ".vetta", "sessions");
		const imCatalog = new PathFilteredRuntimeSessionCatalog(catalog, (path) =>
			isSessionPathInDirectory(path, sessionDir),
		);
		const desktopCatalog = new PathFilteredRuntimeSessionCatalog(
			catalog,
			(path) => !isSessionPathInDirectory(path, sessionDir),
		);
		const imSession = join(sessionDir, "im.conversation.jsonl");
		const projectSession = join(process.cwd(), "project", ".vetta", "sessions", "project.conversation.jsonl");

		await expect(imCatalog.ownsSession(imSession)).resolves.toBe(true);
		await expect(desktopCatalog.ownsSession(imSession)).resolves.toBe(false);
		await expect(imCatalog.ownsSession(projectSession)).resolves.toBe(false);
		await expect(desktopCatalog.ownsSession(projectSession)).resolves.toBe(true);
	});
});

function alwaysOwnedCatalog(): RuntimeSessionCatalog {
	return {
		ownsSession: vi.fn(async () => true),
		listProjects: vi.fn(async (): Promise<ProjectInfo[]> => []),
		listSessions: vi.fn(async (): Promise<SessionHistoryInfo[]> => []),
		renameSession: vi.fn(async () => {}),
		deleteSessionArtifacts: vi.fn(async () => {}),
	};
}
