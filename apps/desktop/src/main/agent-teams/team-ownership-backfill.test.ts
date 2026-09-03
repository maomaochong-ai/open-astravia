import type { TeamSessionDocument } from "@vetta/agent-team";
import { describe, expect, it, vi } from "vitest";
import type {
	ConversationOwnershipCatalogPort,
	ConversationOwnershipRecord,
} from "../conversations/conversation-ownership-catalog.js";
import { ensureLegacyAgentTeamOwnershipCatalog } from "./team-ownership-backfill.js";

function legacySession(): TeamSessionDocument {
	return {
		schemaVersion: 1,
		revision: 0,
		id: "team-session",
		teamId: "team",
		name: "Team session",
		cwd: "C:/workspace",
		leaderMemberId: "leader",
		activeMemberIds: ["leader"],
		memberHandles: { leader: "leader" },
		createdAt: 1,
		updatedAt: 2,
		coordinationRuntime: { sessionId: "coordination", sessionPath: "C:/sessions/coordination.jsonl" },
		events: [],
		memberRuntime: {
			leader: {
				sessionId: "member",
				sessionPath: "C:/sessions/member.jsonl",
				agentProfileRevision: 1,
				deliveredEventIds: [],
			},
		},
	};
}

function catalog(register: ConversationOwnershipCatalogPort["register"]): ConversationOwnershipCatalogPort {
	return {
		register,
		listByTeam: async () => [],
		getOwner: async () => undefined,
		filterUserSessions: async (sessions) => [...sessions],
	};
}

describe("ensureLegacyAgentTeamOwnershipCatalog", () => {
	it("coalesces startup discovery and registers coordination plus member ownership", async () => {
		const registered: ConversationOwnershipRecord[] = [];
		const register = vi.fn(async (records: readonly ConversationOwnershipRecord[]) => {
			registered.push(...records);
		});
		const ownership = catalog(register);
		const list = vi.fn(async () => [legacySession()]);
		const repository = { read: vi.fn(), list };

		await Promise.all([
			ensureLegacyAgentTeamOwnershipCatalog(repository, ownership),
			ensureLegacyAgentTeamOwnershipCatalog(repository, ownership),
		]);

		expect(list).toHaveBeenCalledOnce();
		expect(register).toHaveBeenCalledOnce();
		expect(registered.map((record) => [record.owner.role, record.sessionPath])).toEqual([
			["coordination", "C:/sessions/coordination.jsonl"],
			["member", "C:/sessions/member.jsonl"],
		]);
	});

	it("allows a later call to retry after discovery fails", async () => {
		const ownership = catalog(vi.fn(async () => undefined));
		const list = vi
			.fn<() => Promise<readonly TeamSessionDocument[]>>()
			.mockRejectedValueOnce(new Error("temporary read failure"))
			.mockResolvedValueOnce([]);
		const repository = { read: vi.fn(), list };

		await expect(ensureLegacyAgentTeamOwnershipCatalog(repository, ownership)).rejects.toThrow(
			"temporary read failure",
		);
		await expect(ensureLegacyAgentTeamOwnershipCatalog(repository, ownership)).resolves.toBeUndefined();
		expect(list).toHaveBeenCalledTimes(2);
	});
});
