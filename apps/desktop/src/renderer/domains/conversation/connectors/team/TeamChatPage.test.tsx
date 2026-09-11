// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TeamChatViewModel } from "./teamChatModel";
import { TeamChatPage } from "./TeamChatPage";

const captured = vi.hoisted(() => ({
	right: null as ReactNode,
	viewProps: null as { onBackToTeam: () => void; onOpenSettings: () => void } | null,
	title: null as string | null,
	navigate: vi.fn(),
	params: { teamId: "team-1", sessionId: "session-1", memberId: undefined as string | undefined },
}));

vi.mock("@shared/store/atoms", () => ({
	activityPanelOpenAtom: "activity",
	pageHeaderRightSlotAtom: "right",
	pageHeaderTitleAtom: "title",
}));
vi.mock("jotai", () => ({
	useAtom: () => [false, vi.fn()],
	useSetAtom: (atom: string) => (value: ReactNode) => {
		if (atom === "right") captured.right = value;
		if (atom === "title") captured.title = typeof value === "string" ? value : null;
	},
}));
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => captured.navigate,
	useParams: () => captured.params,
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
			pluginScenario: "conversation",
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
	TeamChatView: (props: { onBackToTeam: () => void; onOpenSettings: () => void }) => {
		captured.viewProps = props;
		return <div data-testid="team-chat-view" />;
	},
}));

afterEach(() => {
	cleanup();
	captured.right = null;
	captured.viewProps = null;
	captured.title = null;
	captured.navigate.mockReset();
	captured.params.memberId = undefined;
});

describe("TeamChatPage navigation", () => {
	it("returns to the Team conversation from a member view", () => {
		captured.params.memberId = "member-1";
		render(<TeamChatPage />);

		captured.viewProps?.onBackToTeam();

		expect(captured.navigate).toHaveBeenCalledWith({
			to: "/agent-teams/$teamId/sessions/$sessionId",
			params: { teamId: "team-1", sessionId: "session-1" },
		});
	});

	it("opens Team settings from the roster action", () => {
		render(<TeamChatPage />);

		captured.viewProps?.onOpenSettings();

		expect(captured.navigate).toHaveBeenCalledWith({
			to: "/agent-teams/$teamId/settings",
			params: { teamId: "team-1" },
		});
	});
});
