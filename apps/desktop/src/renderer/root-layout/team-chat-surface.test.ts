import { describe, expect, it } from "vitest";
import { MAX_RESIDENT_TEAM_CHATS, rememberVisitedTeamChat, teamChatSurfaceForPath } from "./team-chat-surface";

describe("teamChatSurfaceForPath", () => {
	it("把团队会话 URL 解析成可保活的 surface，忽略设置和新建重定向", () => {
		expect(teamChatSurfaceForPath("/agent-teams/t1")).toEqual({ teamId: "t1" });
		expect(teamChatSurfaceForPath("/agent-teams/t1/sessions/s1")).toEqual({
			teamId: "t1",
			sessionId: "s1",
		});
		expect(teamChatSurfaceForPath("/agent-teams/t1/sessions/s1/members/m1")).toEqual({
			teamId: "t1",
			sessionId: "s1",
			memberId: "m1",
		});
		expect(teamChatSurfaceForPath("/agent-teams")).toBeNull();
		expect(teamChatSurfaceForPath("/agent-teams/t1/new")).toBeNull();
		expect(teamChatSurfaceForPath("/agent-teams/t1/settings")).toBeNull();
		expect(teamChatSurfaceForPath("/")).toBeNull();
	});
});

describe("rememberVisitedTeamChat", () => {
	it("同一团队更新会话参数，超过上限丢掉最旧的团队", () => {
		const first = teamChatSurfaceForPath("/agent-teams/a/sessions/s1");
		const sameTeam = teamChatSurfaceForPath("/agent-teams/a/sessions/s2");
		const second = teamChatSurfaceForPath("/agent-teams/b/sessions/s3");
		const third = teamChatSurfaceForPath("/agent-teams/c/sessions/s4");
		if (!first || !sameTeam || !second || !third) throw new Error("fixture path");

		const withFirst = rememberVisitedTeamChat([], first);
		expect(rememberVisitedTeamChat(withFirst, first)).toBe(withFirst);
		expect(rememberVisitedTeamChat(withFirst, null)).toBe(withFirst);

		const updated = rememberVisitedTeamChat(withFirst, sameTeam);
		expect(updated).toEqual([sameTeam]);

		const stacked = rememberVisitedTeamChat(rememberVisitedTeamChat(updated, second), third);
		expect(stacked.map((item) => item.teamId)).toEqual(["b", "c"]);
		expect(stacked).toHaveLength(MAX_RESIDENT_TEAM_CHATS);
	});
});
