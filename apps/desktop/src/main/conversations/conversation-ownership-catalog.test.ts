import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConversationOwnershipCatalog } from "./conversation-ownership-catalog.js";

describe("ConversationOwnershipCatalog", () => {
	const roots: string[] = [];
	afterEach(async () => {
		await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
	});

	it("projects Team-owned Conversations separately from the ordinary session list", async () => {
		const root = await mkdtemp(join(tmpdir(), "vetta-conversation-owner-"));
		roots.push(root);
		const path = join(root, "owners.json");
		const catalog = new ConversationOwnershipCatalog(path);
		const coordinationPath = join(root, "coordination.conversation.jsonl");
		const memberPath = join(root, "member.conversation.jsonl");
		const ordinaryPath = join(root, "ordinary.conversation.jsonl");

		await catalog.register([
			{
				sessionPath: coordinationPath,
				owner: {
					kind: "agent-team",
					teamId: "team-1",
					teamSessionId: "team-session-1",
					role: "coordination",
				},
				title: "Team",
				createdAt: 1,
				updatedAt: 2,
				workspaceKind: "session",
				workspaceId: "agent-team:team-1:session:workspace-a",
				cwd: join(root, "session-workspaces", "workspace-a"),
			},
			{
				sessionPath: memberPath,
				owner: {
					kind: "agent-team",
					teamId: "team-1",
					teamSessionId: "team-session-1",
					role: "member",
				},
				title: "Team",
				createdAt: 1,
				updatedAt: 2,
			},
		]);

		await expect(
			catalog.filterUserSessions([
				{ id: "coordination", path: coordinationPath },
				{ id: "member", path: memberPath },
				{ id: "ordinary", path: ordinaryPath },
			]),
		).resolves.toEqual([{ id: "ordinary", path: ordinaryPath }]);
		await expect(catalog.listByTeam("team-1")).resolves.toEqual([
			expect.objectContaining({ workspaceKind: "session", workspaceId: "agent-team:team-1:session:workspace-a" }),
			expect.objectContaining({ owner: expect.objectContaining({ role: "member" }) }),
		]);
		await expect(catalog.getOwner(coordinationPath)).resolves.toEqual(
			expect.objectContaining({ teamId: "team-1", teamSessionId: "team-session-1" }),
		);
	});

	it("updates an existing path instead of duplicating its owner record", async () => {
		const root = await mkdtemp(join(tmpdir(), "vetta-conversation-owner-"));
		roots.push(root);
		const catalog = new ConversationOwnershipCatalog(join(root, "owners.json"));
		const sessionPath = join(root, "coordination.conversation.jsonl");
		const record = {
			sessionPath,
			owner: {
				kind: "agent-team" as const,
				teamId: "team-1",
				teamSessionId: "team-session-1",
				role: "coordination" as const,
			},
			title: "Before",
			createdAt: 1,
			updatedAt: 1,
		};
		await catalog.register([record]);
		await catalog.register([{ ...record, title: "After", updatedAt: 3 }]);

		await expect(catalog.listByTeam("team-1")).resolves.toEqual([
			expect.objectContaining({ title: "After", updatedAt: 3 }),
		]);
	});

	it("removes every ownership record for a deleted Team session", async () => {
		const root = await mkdtemp(join(tmpdir(), "vetta-conversation-owner-"));
		roots.push(root);
		const catalog = new ConversationOwnershipCatalog(join(root, "owners.json"));
		await catalog.register([
			{
				sessionPath: join(root, "coordination.jsonl"),
				owner: { kind: "agent-team", teamId: "team-1", teamSessionId: "session-1", role: "coordination" },
				title: "Team",
				createdAt: 1,
				updatedAt: 1,
			},
			{
				sessionPath: join(root, "member.jsonl"),
				owner: { kind: "agent-team", teamId: "team-1", teamSessionId: "session-1", role: "member" },
				title: "Team",
				createdAt: 1,
				updatedAt: 1,
			},
		]);

		await catalog.removeByTeamSession("team-1", "session-1");
		await expect(catalog.listByTeam("team-1")).resolves.toEqual([]);
	});
});
