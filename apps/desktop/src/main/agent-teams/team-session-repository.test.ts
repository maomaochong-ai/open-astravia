import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

import { createTeamSessionRepository } from "./team-session-repository.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
	);
});

describe("createTeamSessionRepository", () => {
	it("encodes opaque member IDs before using them as Windows directory names", async () => {
		const root = await mkdtemp(join(tmpdir(), "vetta-team-session-"));
		temporaryDirectories.push(root);
		const repository = createTeamSessionRepository(root);

		const directory = repository.memberSessionDirectory("session-id", "builtin:member:leader");
		await mkdir(directory, { recursive: true });

		expect(directory).toBe(join(root, "session-id", "member-YnVpbHRpbjptZW1iZXI6bGVhZGVy"));
		expect(basename(directory)).not.toContain(":");
	});

	it("keeps path traversal IDs inside the team session directory", async () => {
		const root = await mkdtemp(join(tmpdir(), "vetta-team-session-"));
		temporaryDirectories.push(root);
		const repository = createTeamSessionRepository(root);

		const directory = repository.memberSessionDirectory("session-id", "..");
		await mkdir(directory, { recursive: true });

		expect(directory.startsWith(join(root, "session-id"))).toBe(true);
		expect(directory).not.toBe(join(root, "session-id", ".."));
	});
});
