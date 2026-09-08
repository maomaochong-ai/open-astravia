// @vitest-environment jsdom
import { Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SidebarConversationInfo } from "../services/sidebar-conversation-projection";
import { useDefaultSessionListModel } from "./useDefaultSessionListModel";
import { useProjectGroupModel } from "./useProjectGroupModel";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { language: "zh" } }),
}));

const ordinarySession: SidebarConversationInfo = {
	kind: "conversation",
	id: "ordinary-session",
	path: "C:/sessions/ordinary.jsonl",
	cwd: "C:/project",
	firstMessage: "Continue unfinished work",
	modifiedAt: 2,
};

const teamSession: SidebarConversationInfo = {
	kind: "agent-team",
	id: "team-session",
	path: "C:/sessions/team.jsonl",
	cwd: "C:/project",
	firstMessage: "Team task",
	modifiedAt: 3,
	teamId: "team",
	teamSessionId: "team-session",
	memberAvatarUrls: [],
	sessionTitle: "Team task",
};

const sessions = [ordinarySession, teamSession];
const noop = (): void => {};
const wrapper = ({ children }: PropsWithChildren): JSX.Element => <Provider>{children}</Provider>;

describe("sidebar conversation selection", () => {
	it("selects only the Team conversation in the default conversation list when an ordinary path is stale", () => {
		const { result } = renderHook(
			() =>
				useDefaultSessionListModel({
					activeSessionPath: ordinarySession.path,
					activeTeamSessionId: teamSession.teamSessionId,
					cwd: ordinarySession.cwd,
					filter: "conversation",
					onRenameSession: noop,
					onSelectSession: noop,
					sessions,
				}),
			{ wrapper },
		);

		expect(result.current.sessions.filter((session) => session.active).map((session) => session.key)).toEqual([
			"agent-team:team-session",
		]);
	});

	it("selects only the Team conversation inside a project when an ordinary path is stale", () => {
		const { result } = renderHook(
			() =>
				useProjectGroupModel({
					activeSessionPath: ordinarySession.path,
					activeTeamSessionId: teamSession.teamSessionId,
					isExpanded: true,
					onCollapse: noop,
					onExpand: noop,
					onNavigateProject: noop,
					onNewSession: noop,
					onRenameSession: noop,
					onSelectSession: noop,
					project: { cwd: ordinarySession.cwd, name: "OpenVetta", sessionCount: sessions.length, type: "normal" },
					sessions,
				}),
			{ wrapper },
		);

		expect(result.current.sessionViews.filter((session) => session.active).map((session) => session.key)).toEqual([
			"agent-team:team-session",
		]);
	});
});
