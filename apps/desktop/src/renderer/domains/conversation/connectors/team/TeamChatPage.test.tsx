// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TeamChatViewModel } from "./teamChatModel";
import { TeamChatPage } from "./TeamChatPage";

const captured = vi.hoisted(() => ({
	right: null as ReactNode,
	viewProps: null as {
		onBackToTeam: () => void;
		onOpenSettings: () => void;
		workSurface?: { key: string; cwd: string | null } | null;
		exportState?: { title: string };
	} | null,
	title: null as string | null,
	navigate: vi.fn(),
	openTerminal: vi.fn(),
	toggleBottomPanel: vi.fn(),
	togglePin: vi.fn(async () => {}),
	terminalScope: null as { key: string; cwd: string | null } | null,
	bottomPanelScope: null as { key: string; cwd: string | null } | null,
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
vi.mock("@domains/bottom-panel/hooks/useOpenTerminal", () => ({
	useOpenTerminal: (scope: { key: string; cwd: string | null } | null) => {
		captured.terminalScope = scope;
		return { available: true, focused: false, open: captured.openTerminal };
	},
}));
vi.mock("@domains/bottom-panel/hooks/useBottomPanelToggle", () => ({
	useBottomPanelToggle: (scope: { key: string; cwd: string | null } | null) => {
		captured.bottomPanelScope = scope;
		return { open: false, toggle: captured.toggleBottomPanel };
	},
}));
vi.mock("../../hooks/useWindowPinAction", () => ({
	useWindowPinAction: () => ({ pinned: false, toggle: captured.togglePin }),
}));
vi.mock("../../components/BackgroundTasksBadge", () => ({
	BackgroundTasksBadge: () => <span>background-tasks</span>,
}));
vi.mock("../../components/SandboxGrantsBadge", () => ({
	SandboxGrantsBadge: () => <span>sandbox-grants</span>,
}));
vi.mock("@vetta-org/theme-ui/chat", () => ({
	AgentAvatarView: ({ name }: { name: string }) => <span data-testid={`avatar-${name}`}>{name}</span>,
	ChatHeaderActions: {
		Export: ({ title, onClick }: { title: string; onClick: () => void }) => <button onClick={onClick}>{title}</button>,
		Pin: ({ title, onClick }: { title: string; onClick: () => void }) => <button onClick={onClick}>{title}</button>,
		Terminal: ({ title, onClick }: { title: string; onClick: () => void }) => <button onClick={onClick}>{title}</button>,
		BottomPanel: ({ title, onClick }: { title: string; onClick: () => void }) => <button onClick={onClick}>{title}</button>,
		Panel: ({ title, onClick }: { title: string; onClick: () => void }) => <button onClick={onClick}>{title}</button>,
	},
}));
vi.mock("./useTeamChatModel", () => ({
	useTeamChatModel: () => ({
		model: {
			teamId: "team-1",
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
			workspace: { id: "team-workspace", cwd: "/workspace", runtimeIds: ["coordination", "research-runtime"] },
			pluginScenario: "project",
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
	TeamChatView: (props: {
		onBackToTeam: () => void;
		onOpenSettings: () => void;
		workSurface?: { key: string; cwd: string | null } | null;
		exportState?: { title: string };
	}) => {
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
	captured.openTerminal.mockReset();
	captured.toggleBottomPanel.mockReset();
	captured.togglePin.mockReset();
	captured.terminalScope = null;
	captured.bottomPanelScope = null;
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

	it("composes header capabilities from Team scopes without writing an active Conversation", async () => {
		render(<TeamChatPage />);
		render(<>{captured.right}</>);

		expect(screen.getByText("background-tasks")).toBeTruthy();
		expect(screen.getByText("sandbox-grants")).toBeTruthy();
		expect(captured.terminalScope).toEqual({
			key: "agent-team:session-1",
			cwd: "/workspace",
			scenario: "project",
		});
		expect(captured.bottomPanelScope).toEqual(captured.terminalScope);

		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: "chat:chatView.pinButton.unpinned" }));
		await user.click(screen.getByRole("button", { name: "chat:chatView.terminalButton.open" }));
		await user.click(screen.getByRole("button", { name: "chat:chatView.bottomPanelButton.closed" }));
		await user.click(screen.getByRole("button", { name: "chat:chatView.exportButton.title" }));

		expect(captured.togglePin).toHaveBeenCalledOnce();
		expect(captured.openTerminal).toHaveBeenCalledOnce();
		expect(captured.toggleBottomPanel).toHaveBeenCalledOnce();
		expect(captured.viewProps).toMatchObject({
			workSurface: { key: "agent-team:session-1", cwd: "/workspace", scenario: "project" },
			exportState: { title: "Team" },
		});
	});
});
