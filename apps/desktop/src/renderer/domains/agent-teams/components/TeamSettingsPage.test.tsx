// @vitest-environment jsdom

import type { AgentProfile, AgentTeamDocument } from "@vetta/agent-team";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AgentTeamConfigurationResources } from "../services/load-agent-team-resources";
import { TeamSettingsPage } from "./TeamSettingsPage";

const loadResources = vi.fn<() => Promise<AgentTeamConfigurationResources>>();

vi.mock("../services/load-agent-team-resources", () => ({
	loadAgentTeamConfigurationResources: () => loadResources(),
}));

vi.mock("@tanstack/react-router", () => ({
	useParams: () => ({ teamId: "team" }),
	useNavigate: () => vi.fn(),
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@vetta/ui", () => ({
	Button: ({ children, variant: _variant, size: _size, ...props }: { children: ReactNode } & Record<string, unknown>) => (
		<button {...props}>{children}</button>
	),
}));

vi.mock("./AgentProfileEditor", () => ({
	AgentProfileEditor: ({ agent }: { agent: AgentProfile }) => <div>editor:{agent.name}</div>,
}));

function profile(id: string, name: string, scope: AgentProfile["scope"]): AgentProfile {
	return {
		id,
		revision: 1,
		name,
		description: "",
		mentionHandle: name.toLocaleLowerCase("en-US"),
		blueprintId: "builder",
		abilities: { skills: [], mcpServers: [], plugins: [] },
		scope,
		createdAt: 1,
		updatedAt: 1,
	};
}

function document(): AgentTeamDocument {
	return {
		schemaVersion: 1,
		revision: 1,
		agents: [
			profile("shared", "Shared Agent", { kind: "library" }),
			profile("copied", "Copied Agent", { kind: "team", teamId: "team" }),
		],
		teams: [
			{
				id: "team",
				revision: 1,
				name: "Delivery Team",
				description: "",
				leaderMemberId: "member-shared",
				members: [
					{
						id: "member-shared",
						handle: "shared",
						binding: { kind: "reference", agentProfileId: "shared" },
					},
					{
						id: "member-copied",
						handle: "copied",
						binding: { kind: "copy", agentProfileId: "copied" },
					},
				],
				orchestrationPolicyId: "leader-delegates-v1",
				contextPolicyId: "public-results-v1",
				createdAt: 1,
				updatedAt: 1,
			},
		],
	};
}

describe("TeamSettingsPage", () => {
	it("explains shared and copied bindings while switching member editors", async () => {
		loadResources.mockResolvedValue({ document: document(), blueprints: [], capabilities: [] });
		const user = userEvent.setup();
		render(<TeamSettingsPage />);

		expect(await screen.findByText("editor:Shared Agent")).toBeTruthy();
		expect(screen.getByText("settings.referenceHint")).toBeTruthy();
		await user.click(screen.getByRole("button", { name: /Copied Agent/ }));
		expect(await screen.findByText("editor:Copied Agent")).toBeTruthy();
		expect(screen.getByText("settings.copyHint")).toBeTruthy();
	});
});
