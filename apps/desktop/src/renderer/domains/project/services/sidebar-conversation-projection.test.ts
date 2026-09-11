import type { SessionInfo } from "@shared/store/atoms";
import { describe, expect, it } from "vitest";
import type { DesktopTeamSidebarConversation } from "../../../../shared/sidebar-conversation";
import { projectSidebarConversations, sidebarConversationIdentity } from "./sidebar-conversation-projection";

const ordinary: SessionInfo = {
	id: "ordinary",
	path: "C:/sessions/ordinary.jsonl",
	cwd: "C:/project",
	firstMessage: "Ordinary",
	modifiedAt: 2,
};

function team(overrides: Partial<DesktopTeamSidebarConversation> = {}): DesktopTeamSidebarConversation {
	return {
		kind: "agent-team",
		teamId: "team",
		teamSessionId: "team-session",
		coordinationSessionPath: "C:/sessions/team.jsonl",
		cwd: "C:/team-workspaces/team-session",
		memberAvatarUrls: ["a.webp", "b.webp"],
		sessionTitle: "Team task",
		createdAt: 1,
		updatedAt: 3,
		placement: { kind: "default" },
		...overrides,
	};
}

describe("projectSidebarConversations", () => {
	it("mixes ordinary and Team conversations by product placement instead of storage cwd", () => {
		const result = projectSidebarConversations([ordinary], [team()], { kind: "default" });

		expect(result.map((item) => item.kind)).toEqual(["agent-team", "conversation"]);
		expect(result[0]).toMatchObject({
			cwd: "C:/team-workspaces/team-session",
			memberAvatarUrls: ["a.webp", "b.webp"],
		});
	});

	it("presents the generated task title with a Team icon and trailing member avatars", () => {
		const identity = sidebarConversationIdentity(projectSidebarConversations([], [team()], { kind: "default" })[0]!, {
			untitledTeamLabel: "New team conversation",
		});

		expect(identity).toEqual({
			key: "agent-team:team-session",
			label: "Team task",
			iconClassName: "icon-[solar--users-group-rounded-linear]",
			trailingAvatarUrls: ["a.webp", "b.webp"],
			mutable: true,
		});
	});

	it("uses a localized neutral label before a Team conversation receives its automatic title", () => {
		const identity = sidebarConversationIdentity(
			projectSidebarConversations([], [team({ sessionTitle: "" })], { kind: "default" })[0]!,
			{ untitledTeamLabel: "New team conversation" },
		);

		expect(identity.label).toBe("New team conversation");
	});

	it("places project Team conversations only in their canonical project bucket", () => {
		const projectTeam = team({ placement: { kind: "project", projectPath: "C:/Projects/Vetta" } });

		expect(
			projectSidebarConversations([], [projectTeam], { kind: "project", projectPath: "c:\\projects\\vetta\\" }),
		).toHaveLength(1);
		expect(projectSidebarConversations([], [projectTeam], { kind: "default" })).toHaveLength(0);
	});

	it("defensively removes a raw coordination Conversation duplicate", () => {
		const duplicate = { ...ordinary, path: "c:\\sessions\\team.jsonl" };
		const result = projectSidebarConversations([duplicate], [team()], { kind: "default" });

		expect(result).toHaveLength(1);
		expect(result[0]?.kind).toBe("agent-team");
	});
});
