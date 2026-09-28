// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
