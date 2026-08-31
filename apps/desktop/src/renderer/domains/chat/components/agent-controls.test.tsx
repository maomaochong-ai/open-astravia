// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { activeSessionAtom } from "@shared/store/atoms";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatHeaderActionsView } from "./chat-view/ChatHeaderActionsView";
import { NewSessionOptionsRow } from "./new-session/NewSessionOptionsRow";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { exists: () => true } }),
}));

beforeEach(() => {
	Object.assign(window, {
		vetta: {
			config: { get: async () => ({ defaultAgentMode: "work", projects: [] }), onProjectsChanged: () => () => {} },
			im: { onSessionChanged: () => () => {} },
			session: {
				listSandboxGrants: async () => [],
				getAgentModes: async () => [{ id: "work", label: "Work", description: "", icon: "" }],
				onAgentModeChanged: () => () => {},
				onSessionsChanged: () => () => {},
			},
		},
	});
});

describe("conversation controls", () => {
	it("keeps header actions available without Agent configuration controls", async () => {
		const store = createStore();
		store.set(activeSessionAtom, { cwd: "/workspace", sessionPath: "/session.json", runtimeId: "session" });
		const actions = {
			finishExport: vi.fn(),
			openExport: vi.fn(),
			togglePanel: vi.fn(),
			togglePin: vi.fn(async () => {}),
		};
		render(
			<Provider store={store}>
				<ChatHeaderActionsView
					actions={actions}
					model={{
						exportDisabled: false,
						exporting: false,
						exportTitle: "Export",
						panelOpen: false,
						panelTitle: "Panel",
						pinTitle: "Pin",
						pinned: false,
					}}
				/>
			</Provider>,
		);
		expect(screen.queryByRole("button", { name: "agentConfiguration.title" })).toBeNull();
		expect(screen.getByRole("button", { name: "agentTraces.title" })).toBeDefined();
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: "Export" }));
		await user.click(screen.getByRole("button", { name: "Panel" }));
		await user.click(screen.getByRole("button", { name: "Pin" }));
		expect(actions.openExport).toHaveBeenCalledOnce();
		expect(actions.togglePanel).toHaveBeenCalledOnce();
		expect(actions.togglePin).toHaveBeenCalledOnce();
	});

	it("offers the existing mode and project controls without a new-session Agent editor", async () => {
		render(
			<Provider store={createStore()}>
				<NewSessionOptionsRow
					selection={null}
					options={[]}
					takenNames={[]}
					creatingProject={false}
					onSelectProject={vi.fn()}
					onSelectPendingProject={vi.fn()}
				/>
			</Provider>,
		);
		expect(await screen.findByRole("button", { name: "agentMode.work" })).toBeDefined();
		expect(screen.getByRole("button", { name: "newSession.projectSelector.triggerTitle" })).toBeDefined();
		expect(screen.queryByRole("button", { name: "agentConfiguration.title" })).toBeNull();
	});
});
