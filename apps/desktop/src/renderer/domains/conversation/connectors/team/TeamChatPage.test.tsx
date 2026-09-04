// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TeamChatViewModel } from "./teamChatModel";
import { TeamChatPage } from "./TeamChatPage";

const captured = vi.hoisted(() => ({
	left: null as ReactNode,
	right: null as ReactNode,
	badge: null as ReactNode,
	title: null as string | null,
	navigate: vi.fn(),
	params: { teamId: "team-1", sessionId: "session-1", memberId: undefined as string | undefined },
}));

vi.mock("@shared/components/ui/button", () => ({
	Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
}));
vi.mock("@shared/store/atoms", () => ({
	activityPanelOpenAtom: "activity",
	pageHeaderLeftSlotAtom: "left",
	pageHeaderRightSlotAtom: "right",
	pageHeaderTitleAtom: "title",
	pageHeaderTitleBadgeAtom: "badge",
}));
vi.mock("jotai", () => ({
	useAtom: () => [false, vi.fn()],
	useSetAtom: (atom: string) => (value: ReactNode) => {
		if (atom === "left") captured.left = value;
		if (atom === "right") captured.right = value;
		if (atom === "badge") captured.badge = value;
		if (atom === "title") captured.title = typeof value === "string" ? value : null;
	},
}));
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => captured.navigate,
	useParams: () => captured.params,
}));
vi.mock("@shared/agent-teams/useAgentTeamSidebarSelection", () => ({
	useAgentTeamSidebarSelection: () => undefined,
}));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: { name?: string }) => (values?.name ? `${key}:${values.name}` : key),
	}),
}));
vi.mock("@vetta/theme-ui/chat", () => ({
	AgentAvatarView: ({ name }: { name: string }) => <span data-testid={`avatar-${name}`}>{name}</span>,
	ChatHeaderActions: { Panel: () => null },
}));
vi.mock("./useTeamChatModel", () => ({
	useTeamChatModel: () => ({
		model: {
			feedKey: "session-1",
			members: [
				{
					id: "member-1",
					kind: "agent",
					name: "Research",
					handle: "research",
					blueprintId: "researcher",
					avatar: "/research.webp",
					selected: false,
					status: "idle",
				},
			],
			memberRuntimeIds: { "member-1": "research-runtime" },
			feedItems: [],
			draft: "",
			history: [],
			attachments: [],
			sessions: [],
			title: "Team",
			activeSessionId: "session-1",
			status: "ready",
			editorEnabled: true,
			canSend: false,
			workspace: null,
			sessionActionsDisabled: false,
			modelKey: null,
			labels: {
				leaderRoute: "Lead",
				memberRoleFallback: "Member",
				placeholder: "Ask the team",
				attachFile: "Add file",
				attachImage: "Add image",
			},
		} satisfies TeamChatViewModel,
		actions: {},
	}),
}));
vi.mock("./TeamChatView", () => ({
	TeamChatView: () => <div data-testid="team-chat-view" />,
}));

afterEach(() => {
	cleanup();
	captured.left = null;
	captured.right = null;
	captured.badge = null;
	captured.title = null;
	captured.navigate.mockReset();
	captured.params.memberId = undefined;
});

describe("TeamChatPage member header", () => {
	it("opens the Team member view for the clicked member", () => {
		render(<TeamChatPage />);
		render(<>{captured.badge}</>);

		fireEvent.click(screen.getByRole("button", { name: "chat.memberSession:Research" }));

		expect(captured.navigate).toHaveBeenCalledWith({
			to: "/agent-teams/$teamId/sessions/$sessionId/members/$memberId",
			params: { teamId: "team-1", sessionId: "session-1", memberId: "member-1" },
		});
	});

	it("returns to the Team conversation from a member view", () => {
		captured.params.memberId = "member-1";
		render(<TeamChatPage />);
		render(<>{captured.left}</>);

		fireEvent.click(screen.getByRole("button", { name: "chat.backToTeam" }));

		expect(captured.navigate).toHaveBeenCalledWith({
			to: "/agent-teams/$teamId/sessions/$sessionId",
			params: { teamId: "team-1", sessionId: "session-1" },
		});
	});
});
