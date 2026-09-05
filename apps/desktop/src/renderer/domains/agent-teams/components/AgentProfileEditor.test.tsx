// @vitest-environment jsdom

import type { AgentProfile, AgentProfileUpdateImpact } from "@vetta/agent-team";
import type { ReactNode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentProfileEditor } from "./AgentProfileEditor";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: Record<string, unknown>) => `${key}${options?.count ?? options?.index ?? ""}`,
	}),
}));
vi.mock("@vetta/ui", () => ({
	Button: ({ children, ...props }: { children: ReactNode } & Record<string, unknown>) => (
		<button {...props}>{children}</button>
	),
	cn: (...values: readonly unknown[]) => values.filter(Boolean).join(" "),
	Input: (props: Record<string, unknown>) => <input {...props} />,
	Switch: ({
		checked,
		onCheckedChange,
		...props
	}: {
		checked: boolean;
		onCheckedChange: () => void;
	} & Record<string, unknown>) => (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			onClick={onCheckedChange}
			{...props}
		/>
	),
}));
vi.mock("react-virtuoso", () => ({
	GroupedVirtuoso: ({
		groupCounts,
		groupContent,
		itemContent,
	}: {
		groupCounts: readonly number[];
		groupContent: (index: number) => ReactNode;
		itemContent: (index: number) => ReactNode;
	}) => (
		<div>
			{groupCounts.map((count, groupIndex) => (
				<div key={groupIndex}>
					{groupContent(groupIndex)}
					{Array.from({ length: count }, (_, itemIndex) => {
						const offset = groupCounts
							.slice(0, groupIndex)
							.reduce((sum, value) => sum + value, 0);
						return <div key={itemIndex}>{itemContent(offset + itemIndex)}</div>;
					})}
				</div>
			))}
		</div>
	),
}));

const agent: AgentProfile = {
	id: "agent-1",
	revision: 2,
	name: "Researcher",
	description: "Find evidence",
	mentionHandle: "researcher",
	blueprintId: "researcher",
	abilities: { skills: [], mcpServers: [], plugins: [] },
	scope: { kind: "library" },
	createdAt: 0,
	updatedAt: 0,
};

const impact: AgentProfileUpdateImpact = {
	agentProfileId: agent.id,
	teamIds: ["team-a", "team-b"],
	teamNames: ["A", "B"],
};

afterEach(cleanup);

describe("AgentProfileEditor", () => {
	it("keeps profile identity fields editable by default", async () => {
		const user = userEvent.setup();
		render(
			<AgentProfileEditor
				agent={agent}
				capabilities={[]}
				onPreview={vi.fn(async () => ({ ...impact, teamIds: [], teamNames: [] }))}
				onSave={vi.fn(async () => ({ updated: agent, impact }))}
			/>,
		);

		const name = screen.getByDisplayValue(agent.name) as HTMLInputElement;
		const description = screen.getByDisplayValue(agent.description) as HTMLTextAreaElement;
		expect(name.readOnly).toBe(false);
		expect(description.readOnly).toBe(false);
		await user.clear(name);
		await user.type(name, "Updated name");
		expect(name.value).toBe("Updated name");
	});

	it("keeps built-in identity fields editable", async () => {
		const user = userEvent.setup();
		render(
			<AgentProfileEditor
				agent={agent}
				capabilities={[]}
				onPreview={vi.fn(async () => ({ ...impact, teamIds: [], teamNames: [] }))}
				onSave={vi.fn(async () => ({ updated: agent, impact }))}
			/>,
		);

		const name = screen.getByDisplayValue(agent.name) as HTMLInputElement;
		const description = screen.getByDisplayValue(agent.description) as HTMLTextAreaElement;
		expect(name.readOnly).toBe(false);
		expect(description.readOnly).toBe(false);
		await user.clear(name);
		await user.type(name, "Renamed built-in");
		expect(name.value).toBe("Renamed built-in");
		expect((screen.getByLabelText("profile.searchAbilities") as HTMLInputElement).readOnly).toBe(false);
	});

	it("edits and persists the file-backed system prompt", async () => {
		const user = userEvent.setup();
		const onSave = vi.fn(async () => ({ updated: agent, impact }));
		render(
			<AgentProfileEditor
				agent={agent}
				capabilities={[]}
				onPreview={vi.fn(async () => ({ ...impact, teamIds: [], teamNames: [] }))}
				onSave={onSave}
			/>,
		);

		const prompt = screen.getByLabelText("profile.systemPrompt");
		await user.type(prompt, "Use file-backed instructions.");
		await user.click(screen.getByRole("button", { name: "profile.save" }));
		await waitFor(() => expect(onSave).toHaveBeenCalledWith(agent, expect.objectContaining({
			systemPrompt: "Use file-backed instructions.",
		})));
	});

	it("requires confirmation before saving a profile shared by multiple teams", async () => {
		const user = userEvent.setup();
		const onPreview = vi.fn(async () => impact);
		const onSave = vi.fn(async () => ({ updated: agent, impact }));
		render(
			<AgentProfileEditor
				agent={agent}
				capabilities={[]}
				onPreview={onPreview}
				onSave={onSave}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "profile.save" }));
		await waitFor(() => expect(screen.getByText(/profile.sharedImpact2/)).toBeTruthy());
		expect(onSave).not.toHaveBeenCalled();
		await user.click(screen.getByRole("button", { name: "profile.confirmSharedSave" }));
		await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
	});

	it("renders globally disabled capabilities as unavailable", () => {
		render(
			<AgentProfileEditor
				agent={agent}
				capabilities={[
					{
						id: "scene-one",
						kind: "scene",
						title: "Scene One",
						description: "",
						enabledGlobally: false,
					},
				]}
				onPreview={vi.fn(async () => ({ ...impact, teamIds: [], teamNames: [] }))}
				onSave={vi.fn(async () => ({ updated: agent, impact }))}
			/>,
		);
		const abilitySwitch = screen.getByRole("switch") as HTMLButtonElement;
		expect(abilitySwitch.disabled).toBe(true);
	});

	it("filters the ability catalog without rendering native selection controls", async () => {
		const user = userEvent.setup();
		render(
			<AgentProfileEditor
				agent={agent}
				capabilities={[
					{
						id: "research",
						kind: "skill",
						title: "Research",
						description: "Find evidence",
						enabledGlobally: true,
					},
					{
						id: "notion",
						kind: "mcp",
						title: "Notion",
						description: "Read pages",
						enabledGlobally: true,
					},
				]}
				onPreview={vi.fn(async () => ({ ...impact, teamIds: [], teamNames: [] }))}
				onSave={vi.fn(async () => ({ updated: agent, impact }))}
			/>,
		);

		expect(screen.getAllByRole("switch")).toHaveLength(2);
		expect(document.querySelector('input[type="checkbox"], select')).toBeNull();
		await user.type(screen.getByLabelText("profile.searchAbilities"), "notion");
		expect(screen.queryByText("Research")).toBeNull();
		expect(screen.getByText("Notion")).toBeTruthy();
	});

	it("offers every built-in avatar and saves the selected stable asset path", async () => {
		const user = userEvent.setup();
		const onSave = vi.fn(async () => ({ updated: agent, impact }));
		render(
			<AgentProfileEditor
				agent={agent}
				capabilities={[]}
				onPreview={vi.fn(async () => ({ ...impact, teamIds: [], teamNames: [] }))}
				onSave={onSave}
			/>,
		);

		expect(screen.getAllByRole("button", { name: /profile.avatarOption/ })).toHaveLength(9);
		await user.click(screen.getByRole("button", { name: "profile.avatarOption9" }));
		await user.click(screen.getByRole("button", { name: "profile.save" }));
		await waitFor(() =>
			expect(onSave).toHaveBeenCalledWith(
				agent,
				expect.objectContaining({ avatar: "./agent-team-avatars/avatar-09.webp" }),
			),
		);
	});
});
