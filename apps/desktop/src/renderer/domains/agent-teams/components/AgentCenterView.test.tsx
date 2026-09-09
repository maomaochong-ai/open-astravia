// @vitest-environment jsdom

import type { AgentProfile } from "@vetta/agent-team";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AgentCenterModel } from "../hooks/useAgentCenterModel";
import { AgentCenterView } from "./AgentCenterView";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: Record<string, string | number>) =>
			values ? `${key}:${Object.values(values).join(":")}` : key,
	}),
}));
vi.mock("@vetta/ui", () => ({
	Button: ({ children, variant: _variant, size: _size, ...props }: { children: ReactNode } & Record<string, unknown>) => (
		<button type="button" {...props}>
			{children}
		</button>
	),
	Input: (props: Record<string, unknown>) => <input {...props} />,
	cn: (...values: readonly unknown[]) => values.filter(Boolean).join(" "),
}));
vi.mock("./AgentProfileSheet", () => ({ AgentProfileSheet: () => <div>sheet</div> }));

function agent(id: string): AgentProfile {
	return {
		id,
		revision: 1,
		name: id,
		description: `${id} description`,
		mentionHandle: id,
		blueprintId: "builder",
		abilities: { skills: [], mcpServers: [], plugins: [] },
		scope: { kind: "library" },
		createdAt: 1,
		updatedAt: 1,
	};
}

function buildModel(overrides: Partial<AgentCenterModel> = {}): AgentCenterModel {
	const agents = [agent("alpha"), agent("beta")];
	return {
		loading: false,
		error: undefined,
		document: undefined,
		blueprints: [],
		capabilities: [],
		agents,
		agentsById: new Map(agents.map((item) => [item.id, item])),
		teams: [],
		teamsExpanded: false,
		selectedTeam: undefined,
		assembly: undefined,
		assemblyLeaderId: undefined,
		assemblySubmittable: false,
		sheet: undefined,
		sheetAgent: undefined,
		actions: {
			createAgent: vi.fn(),
			previewAgent: vi.fn(),
			previewAgentDelete: vi.fn(),
			saveAgent: vi.fn(),
			deleteAgent: vi.fn(),
			deleteTeam: vi.fn(),
			setTeamsExpanded: vi.fn(),
			selectTeam: vi.fn(),
			startCreateTeam: vi.fn(),
			startEditTeam: vi.fn(),
			cancelAssembly: vi.fn(),
			renameAssembly: vi.fn(),
			promoteAssemblyLeader: vi.fn(),
			submitAssembly: vi.fn(),
			recruitAgent: vi.fn(),
			saveTeam: vi.fn(),
			createAgentFromDraft: vi.fn(),
		},
		...overrides,
	} as unknown as AgentCenterModel;
}

function team(id: string) {
	return {
		id,
		revision: 1,
		name: id,
		description: `${id} description`,
		leaderMemberId: `${id}:member`,
		members: [
			{ id: `${id}:member`, handle: "alpha", binding: { kind: "reference", agentProfileId: "alpha" } },
		],
		orchestrationPolicyId: "leader-delegates-v1",
		contextPolicyId: "public-results-v1",
		createdAt: 1,
		updatedAt: 1,
	};
}

function renderView(
	model: AgentCenterModel,
	onOpenAgent = vi.fn(),
	handlers: { onDeleteTeam?: () => void; onOpenTeamSettings?: () => void } = {},
) {
	return render(
		<AgentCenterView
			model={model}
			onOpenTeamChat={vi.fn()}
			onOpenTeamSettings={handlers.onOpenTeamSettings ?? vi.fn()}
			onSubmitAssembly={vi.fn()}
			onDeleteTeam={handlers.onDeleteTeam ?? vi.fn()}
			onOpenAgent={onOpenAgent}
			onCreateAgent={vi.fn()}
		/>,
	);
}

describe("AgentCenterView", () => {
	it("opens the profile drawer when a card is clicked outside recruiting mode", async () => {
		const onOpenAgent = vi.fn();
		const user = userEvent.setup();
		renderView(buildModel(), onOpenAgent);

		await user.click(screen.getByRole("button", { name: "alpha" }));
		expect(onOpenAgent).toHaveBeenCalledWith("alpha");
	});

	it("recruits into the draft roster instead of opening the drawer while assembling", async () => {
		const onOpenAgent = vi.fn();
		const model = buildModel({
			assembly: { name: "", memberIds: [], leaderId: undefined },
			assemblySubmittable: false,
		});
		const user = userEvent.setup();
		renderView(model, onOpenAgent);

		await user.click(screen.getByRole("button", { name: "alpha" }));
		expect(model.actions.recruitAgent).toHaveBeenCalledWith(expect.objectContaining({ id: "alpha" }));
		expect(onOpenAgent).not.toHaveBeenCalled();
	});

	it("keeps team actions on the selected card instead of the page header", async () => {
		const onDeleteTeam = vi.fn();
		const onOpenTeamSettings = vi.fn();
		const teams = [team("squad")];
		const model = buildModel({ teams, selectedTeam: teams[0] } as Partial<AgentCenterModel>);
		const user = userEvent.setup();
		renderView(model, vi.fn(), { onDeleteTeam, onOpenTeamSettings });

		await user.click(screen.getByRole("button", { name: "center.teamSettings" }));
		expect(onOpenTeamSettings).toHaveBeenCalledWith("squad");
		await user.click(screen.getByRole("button", { name: "center.deleteTeam" }));
		expect(onDeleteTeam).toHaveBeenCalledWith("squad");
		await user.click(screen.getByRole("button", { name: "center.recruit" }));
		expect(model.actions.startEditTeam).toHaveBeenCalledWith(expect.objectContaining({ id: "squad" }));
	});

	it("hides the card actions until the team is selected", () => {
		const teams = [team("squad")];
		renderView(buildModel({ teams } as Partial<AgentCenterModel>));

		expect(screen.queryByRole("button", { name: "center.deleteTeam" })).toBeNull();
		expect(screen.getByText("center.teamSelectHint")).toBeDefined();
	});

	it("drops the selection when the pointer lands outside every team card", async () => {
		const teams = [team("squad")];
		const model = buildModel({ teams, selectedTeam: teams[0] } as Partial<AgentCenterModel>);
		const user = userEvent.setup();
		renderView(model);

		// 卡片内的点击不能收起选中态，否则刚点开就没了。
		await user.click(screen.getByRole("button", { name: "center.teamSettings" }));
		expect(model.actions.selectTeam).not.toHaveBeenCalledWith(undefined);

		await user.click(screen.getByText("center.agentsSection"));
		expect(model.actions.selectTeam).toHaveBeenCalledWith(undefined);
	});

	it("leaves recruiting mode when the pointer lands outside the assembly regions", async () => {
		const teams = [team("squad")];
		const model = buildModel({
			teams,
			selectedTeam: teams[0],
			assembly: { name: "squad", memberIds: ["alpha"], leaderId: "alpha" },
			assemblyLeaderId: "alpha",
			assemblySubmittable: true,
		} as Partial<AgentCenterModel>);
		const user = userEvent.setup();
		renderView(model);

		// 阵容栏与智能体卡片是组队操作区，点这些不能把人踢出组队模式。
		await user.click(screen.getByText("center.assemblyTitle"));
		await user.click(screen.getByRole("button", { name: "alpha" }));
		expect(model.actions.cancelAssembly).not.toHaveBeenCalled();

		await user.click(screen.getByText("center.agentsSection"));
		expect(model.actions.cancelAssembly).toHaveBeenCalled();
		expect(model.actions.selectTeam).toHaveBeenCalledWith(undefined);
	});

	it("switches recruiting to another team when its card is clicked", async () => {
		const teams = [team("squad"), team("crew")];
		const model = buildModel({
			teams,
			selectedTeam: teams[0],
			assembly: { name: "squad", memberIds: ["alpha"], leaderId: "alpha" },
			assemblyLeaderId: "alpha",
			assemblySubmittable: true,
		} as Partial<AgentCenterModel>);
		const user = userEvent.setup();
		renderView(model);

		await user.click(screen.getByText("crew description"));
		expect(model.actions.startEditTeam).toHaveBeenCalledWith(expect.objectContaining({ id: "crew" }));
		expect(model.actions.cancelAssembly).not.toHaveBeenCalled();
	});

	it("marks recruited members and blocks saving until the team has a name", () => {
		const model = buildModel({
			assembly: { name: "", memberIds: ["alpha"], leaderId: "alpha" },
			assemblyLeaderId: "alpha",
			assemblySubmittable: false,
		});
		renderView(model);

		expect(screen.getByRole("button", { name: "alpha" }).getAttribute("aria-pressed")).toBe("true");
		expect(screen.getByRole("button", { name: "beta" }).getAttribute("aria-pressed")).toBe("false");
		expect((screen.getByRole("button", { name: "center.saveTeam" }) as HTMLButtonElement).disabled).toBe(true);
	});
});
