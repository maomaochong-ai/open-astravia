// @vitest-environment jsdom

import type { AgentProfile, AgentTeamDocument } from "@vetta/agent-team";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AgentTeamConfigurationResources } from "../services/load-agent-team-resources";
import { TeamSettingsPage } from "./TeamSettingsPage";

const loadResources = vi.fn<() => Promise<AgentTeamConfigurationResources>>();
const translate = (key: string, values?: Record<string, string>) =>
	values ? `${key}:${Object.values(values).join(":")}` : key;

vi.mock("../services/load-agent-team-resources", () => ({
	loadAgentTeamConfigurationResources: () => loadResources(),
}));

vi.mock("@tanstack/react-router", () => ({
	useParams: () => ({ teamId: "team" }),
	useNavigate: () => vi.fn(),
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: translate }),
}));

vi.mock("@vetta/ui", () => ({
	Button: ({ children, variant: _variant, size: _size, ...props }: { children: ReactNode } & Record<string, unknown>) => (
		<button {...props}>{children}</button>
	),
	Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
	DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
	Input: (props: Record<string, unknown>) => <input {...props} />,
	Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectTrigger: ({ children, ...props }: { children: ReactNode } & Record<string, unknown>) => (
		<div {...props}>{children}</div>
	),
	SelectValue: () => <span />,
}));

vi.mock("@vetta/theme-ui/chat", () => ({
	AgentAvatarView: ({ name }: { name: string }) => <span data-testid="avatar">{name}</span>,
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
	it("shows member avatars and manages the roster without exposing handles or binding explanations", async () => {
		loadResources.mockResolvedValue({ document: document(), blueprints: [], capabilities: [] });
		const user = userEvent.setup();
		render(<TeamSettingsPage />);

		expect(await screen.findByText("editor:Shared Agent")).toBeTruthy();
		expect(screen.getAllByTestId("avatar")).toHaveLength(2);
		expect(screen.getByRole("button", { name: "settings.save" })).toHaveProperty("disabled", true);
		expect(screen.queryByRole("button", { name: "profile.save" })).toBeNull();
		expect(screen.queryByText("@shared")).toBeNull();
		expect(screen.queryByText("settings.referenceHint")).toBeNull();
		await user.clear(screen.getByLabelText("teams.name"));
		await user.type(screen.getByLabelText("teams.name"), "Updated Team");
		expect(screen.getByRole("button", { name: "settings.save" })).toHaveProperty("disabled", false);
		await user.click(screen.getByRole("button", { name: "Copied Agent" }));
		expect(await screen.findByText("editor:Copied Agent")).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "teams.removeMember:Copied Agent" }));
		await waitFor(() => expect(screen.queryAllByText("Copied Agent")).toHaveLength(0));
	});
});
