// @vitest-environment jsdom
import { confirmDialogAtom } from "@shared/store/atoms";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProjectsPanelModel } from "../components/sidebar/projects/panel/types";
import { useProjectsPanelMenusModel } from "./useProjectsPanelMenusModel";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

const teamSession = {
	kind: "agent-team" as const,
	id: "team-session",
	path: "C:/sessions/team.jsonl",
	cwd: "C:/team-workspaces/team-session",
	firstMessage: "Team task",
	modifiedAt: 1,
	teamId: "team",
	teamSessionId: "team-session",
	sessionTitle: "Team task",
	memberAvatarUrls: [],
};

function model(deleteSession: ReturnType<typeof vi.fn>): ProjectsPanelModel {
	return {
		defaultConversationFilter: "conversation",
		imCwd: "C:/im",
		projectSessions: () => [],
		actions: { deleteSession },
	} as unknown as ProjectsPanelModel;
}

describe("useProjectsPanelMenusModel", () => {
	it("asks for confirmation before deleting a Team session and deletes only after confirmation", () => {
		const store = createStore();
		const deleteSession = vi.fn();
		const wrapper = ({ children }: PropsWithChildren): JSX.Element => <Provider store={store}>{children}</Provider>;
		const { result } = renderHook(() => useProjectsPanelMenusModel(model(deleteSession)), { wrapper });

		act(() => result.current.actions.deleteSession(teamSession));

		const confirmation = store.get(confirmDialogAtom);
		expect(deleteSession).not.toHaveBeenCalled();
		expect(confirmation).toMatchObject({
			title: "sidebar.dialogs.deleteSessionTitle",
			message: "sidebar.dialogs.deleteSessionMessage",
			confirmLabel: "sidebar.dialogs.deleteConfirm",
			variant: "danger",
		});

		act(() => confirmation?.onConfirm(false));
		expect(deleteSession).toHaveBeenCalledWith(teamSession);
	});
});
