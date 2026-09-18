import { describe, expect, it } from "vitest";
import { incomingKeepAliveAlreadyMounted } from "./keep-alive-incoming";

const empty = {
	surface: null as string | null,
	visited: new Set<string>(),
	workspace: null as { key: string } | null,
	visitedWorkspaces: [] as { key: string }[],
	teamChat: null as { teamId: string } | null,
	visitedTeamChats: [] as { teamId: string }[],
	detail: null as { key: string } | null,
	visitedDetails: [] as { key: string }[],
};

describe("incomingKeepAliveAlreadyMounted", () => {
	it("切回已经预挂或访问过的能力页视为已挂载", () => {
		expect(
			incomingKeepAliveAlreadyMounted({
				...empty,
				surface: "abilities",
				visited: new Set(["chat", "abilities"]),
			}),
		).toBe(true);
	});

	it("第一次走进尚未挂树的页面视为未挂载", () => {
		expect(
			incomingKeepAliveAlreadyMounted({
				...empty,
				surface: "abilities",
				visited: new Set(["chat"]),
			}),
		).toBe(false);
	});

	it("同一团队会话再走进算已挂载，换团队不算", () => {
		expect(
			incomingKeepAliveAlreadyMounted({
				...empty,
				teamChat: { teamId: "t1" },
				visitedTeamChats: [{ teamId: "t1" }],
			}),
		).toBe(true);
		expect(
			incomingKeepAliveAlreadyMounted({
				...empty,
				teamChat: { teamId: "t2" },
				visitedTeamChats: [{ teamId: "t1" }],
			}),
		).toBe(false);
	});

	it("同一项目详情再走进算已挂载，换查看器不算", () => {
		expect(
			incomingKeepAliveAlreadyMounted({
				...empty,
				detail: { key: "project:/tmp/a" },
				visitedDetails: [{ key: "project:/tmp/a" }],
			}),
		).toBe(true);
		expect(
			incomingKeepAliveAlreadyMounted({
				...empty,
				detail: { key: "viewer:/tmp/b.jsonl" },
				visitedDetails: [{ key: "project:/tmp/a" }],
			}),
		).toBe(false);
	});
});
