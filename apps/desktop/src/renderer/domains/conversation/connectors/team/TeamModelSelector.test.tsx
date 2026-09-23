// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createInstance } from "i18next";
import { createStore, Provider } from "jotai";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localModelsConfigAtom, teamMemberModelsAtom } from "@shared/store/atoms";
import type {
	TeamMemberModelPreference,
	TeamMemberModelSelection,
} from "../../../../../shared/agent-team-member-model";
import teams from "../../../../../shared/i18n/locales/zh/agent-teams.json";
import common from "../../../../../shared/i18n/locales/zh/common.json";
import { TeamModelSelector } from "./TeamModelSelector";
import type { TeamComposerViewModel } from "./teamChatModel";

const i18n = createInstance();
await i18n.init({
	lng: "zh",
	resources: { zh: { "agent-teams": teams, common } },
	interpolation: { escapeValue: false },
});
const config = {
	providers: {
		provider: {
			models: [
				{ id: "a", name: "Model A", reasoning: true, reasoningLevels: ["low", "high"], defaultReasoningLevel: "low" },
				{ id: "b", name: "Model B", reasoning: true, reasoningLevels: ["low", "high"], defaultReasoningLevel: "high" },
				{ id: "c", name: "Model C" },
			],
		},
	},
};
const members: TeamComposerViewModel["members"] = [
	{
		id: "leader",
		kind: "agent",
		name: "负责人",
		avatar: "/leader.webp",
		handle: "leader",
		blueprintId: "builder",
		selected: false,
		status: "working",
	},
	{
		id: "builder",
		kind: "agent",
		name: "开发者",
		avatar: "/builder.webp",
		handle: "builder",
		blueprintId: "builder",
		selected: false,
		status: "idle",
	},
];
const baseModel: TeamComposerViewModel = {
	teamId: "team",
	activeSessionId: "session",
	members,
	draft: "",
	history: [],
	attachments: [],
	canSend: false,
	editorEnabled: true,
	workspace: null,
	status: "ready",
	modelKey: "provider/a",
	reasoning: "low",
	labels: { leaderRoute: "", memberRoleFallback: "", placeholder: "", attachFile: "", attachImage: "" },
};
let saved: Readonly<Record<string, TeamMemberModelPreference>>;
let listeners: Set<(teamId: string) => void>;
const list = vi.fn(async () => ({ ...saved }));
const save = vi.fn(async (_teamId: string, memberId: string, selection: TeamMemberModelSelection | null) => {
	const next = { ...saved };
	if (selection) next[memberId] = { ...selection, agentProfileId: memberId };
	else delete next[memberId];
	saved = next;
	for (const listener of listeners) listener("team");
	return next;
});

beforeEach(() => {
	saved = { leader: { modelKey: "provider/b", reasoning: "high", agentProfileId: "leader" } };
	listeners = new Set();
	list.mockClear();
	save.mockClear();
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	HTMLElement.prototype.scrollIntoView = vi.fn();
	Object.defineProperty(window, "vetta", {
		configurable: true,
		value: {
			models: { get: async () => config, fetchRemote: async () => ({ providers: {} }) },
			agentTeams: {
				listMemberModels: list,
				setMemberModel: save,
				onChanged: () => () => undefined,
				onMemberModelsChanged: (listener: (teamId: string) => void) => {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
			},
		},
	});
});
afterEach(() => vi.unstubAllGlobals());

function mount(teamMembers = members) {
	const store = createStore();
	store.set(localModelsConfigAtom, config);
	function Conversation() {
		const [selection, setSelection] = useState({ modelKey: "provider/a", reasoning: "low" });
		return (
			<TeamModelSelector
				model={{ ...baseModel, ...selection, members: teamMembers }}
				actions={{
					selectModel: async (modelKey, reasoning) => {
						setSelection({ modelKey, reasoning: reasoning ?? "" });
					},
					selectReasoning: async (reasoning) => {
						setSelection((current) => ({ ...current, reasoning }));
					},
				}}
			/>
		);
	}
	render(
		<Provider store={store}>
			<I18nextProvider i18n={i18n}>
				<Conversation />
			</I18nextProvider>
		</Provider>,
	);
	return store;
}

async function openPanel() {
	const user = userEvent.setup();
	await user.click(await screen.findByRole("button", { name: /^(选择模型|按成员配置|Model A)$/ }));
	return user;
}

describe("team model configuration", () => {
	it("keeps the composer model trigger concise for shared and per-member selections", async () => {
		saved = {};
		mount();
		expect(await screen.findByRole("button", { name: "Model A" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: /默认模型：|团队模型 ·/ })).toBeNull();
	});

	it("shows every avatar in a single group even when everyone independently pins the same model", async () => {
		const teamMembers = Array.from({ length: 5 }, (_, index) => ({
			...members[0]!,
			id: `member-${index}`,
			name: `Member ${index}`,
			avatar: `/member-${index}.webp`,
		}));
		saved = Object.fromEntries(
			teamMembers.map((member) => [member.id, { agentProfileId: member.id, modelKey: "provider/b" }]),
		);
		mount(teamMembers);
		const user = await openPanel();
		expect(screen.getByRole("button", { name: "按成员配置" })).toBeTruthy();
		expect(screen.getAllByRole("region")).toHaveLength(1);
		expect(screen.getAllByRole("img")).toHaveLength(5);
		expect(screen.queryByRole("group", { name: "Member 0" })).toBeNull();
		expect(screen.getByText("当前没有成员跟随默认模型。")).toBeTruthy();
		expect(screen.queryByText("Model A")).toBeNull();
		await user.click(screen.getByRole("button", { name: "会话默认" }));
		expect(screen.getByRole("button", { name: "Model A" }).getAttribute("aria-pressed")).toBe("true");
		await user.keyboard("{Escape}");
		expect(document.activeElement).toBe(screen.getByRole("button", { name: "会话默认" }));
		expect(screen.getAllByRole("region")).toHaveLength(1);
		const expand = screen.getByRole("button", { name: "按成员设置" });
		expect(expand.getAttribute("aria-expanded")).toBe("false");
		await user.click(expand);
		for (const member of teamMembers) {
			expect(screen.getByRole("group", { name: member.name })).toBeTruthy();
		}
		await user.click(screen.getByRole("button", { name: "合并显示" }));
		expect(screen.queryByRole("group", { name: "Member 0" })).toBeNull();
		expect(screen.getAllByRole("img")).toHaveLength(5);
		await user.click(screen.getByRole("button", { name: "Member 4的模型" }));
		expect(screen.getByRole("img", { name: "Member 4" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Model B" }).getAttribute("aria-pressed")).toBe("true");
	});

	it("puts the default first and gives a single override a named control without an extra expansion", async () => {
		mount();
		const user = await openPanel();
		const regions = screen.getAllByRole("region");
		expect(regions.map((region) => region.getAttribute("aria-label"))).toEqual(["Model A", "Model B"]);
		expect(screen.getAllByRole("button", { name: "会话默认" })).toHaveLength(1);
		expect(screen.getAllByRole("button", { name: "按成员设置" })).toHaveLength(1);
		const member = screen.getByRole("group", { name: "负责人" });
		expect(within(member).getByRole("button", { name: "负责人的模型" }).textContent).toContain("推理：高");
		expect(screen.queryByRole("group", { name: "开发者" })).toBeNull();
		await user.click(screen.getByRole("button", { name: "按成员设置" }));
		expect(screen.getByRole("group", { name: "开发者" })).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "负责人的模型" }));
		await user.keyboard("{Escape}");
		expect(screen.getByRole("button", { name: "合并显示" }).getAttribute("aria-expanded")).toBe("true");
		expect(document.activeElement).toBe(screen.getByRole("button", { name: "负责人的模型" }));
		await user.click(screen.getByRole("button", { name: "合并显示" }));
		expect(screen.queryByRole("group", { name: "开发者" })).toBeNull();
		expect(screen.getByRole("group", { name: "负责人" })).toBeTruthy();
	});

	it("shows pending saves, prevents conflicting selections, and keeps back navigation available", async () => {
		mount();
		const user = await openPanel();
		let finish!: (models: Readonly<Record<string, TeamMemberModelPreference>>) => void;
		save.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		await user.click(screen.getByRole("button", { name: "负责人的模型" }));
		await user.click(screen.getByRole("button", { name: "Model C" }));
		expect(screen.getByRole("status").textContent).toContain("正在保存");
		expect((screen.getByRole("button", { name: "Model A" }) as HTMLButtonElement).disabled).toBe(true);
		await user.click(screen.getByRole("button", { name: "返回团队模型" }));
		expect(screen.getAllByRole("region")).toHaveLength(2);
		await act(async () => {
			saved = { leader: { agentProfileId: "leader", modelKey: "provider/c" } };
			finish(saved);
		});
		expect(screen.queryByRole("status")).toBeNull();
		expect(screen.getByRole("region", { name: "Model C" })).toBeTruthy();
		expect(document.activeElement).toBe(screen.getByRole("button", { name: "负责人的模型" }));
	});

	it("groups everyone, expands individual controls, customizes one member inline and restores inheritance", async () => {
		saved = {};
		const store = mount();
		const user = await openPanel();
		expect(screen.getAllByRole("region")).toHaveLength(1);
		expect(screen.getByRole("img", { name: "负责人" }).getAttribute("src")).toBe("/leader.webp");
		expect(screen.getByRole("img", { name: "开发者" }).getAttribute("src")).toBe("/builder.webp");
		expect(screen.queryByRole("group", { name: "负责人" })).toBeNull();
		await user.click(screen.getByRole("button", { name: "会话默认" }));
		expect(screen.getAllByRole("dialog")).toHaveLength(1);
		expect(screen.queryByRole("menu")).toBeNull();
		await user.click(screen.getByRole("button", { name: "Model C" }));
		await user.click(screen.getByRole("button", { name: "返回团队模型" }));
		expect(screen.getByRole("button", { name: "会话默认" }).textContent).toContain("Model C");
		expect(document.activeElement).toBe(screen.getByRole("button", { name: "会话默认" }));
		await user.click(screen.getByRole("button", { name: "按成员设置" }));
		const member = screen.getByRole("group", { name: "开发者" });
		expect(within(member).getByRole("button").textContent).toBe("跟随会话默认");
		expect(within(member).getByRole("button").getAttribute("aria-description")).toBe("跟随会话默认");
		expect(within(member).getAllByText(/跟随会话默认/)).toHaveLength(1);
		await user.click(within(member).getByRole("button"));
		expect(screen.getByRole("switch", { name: "跟随会话默认" }).getAttribute("aria-checked")).toBe("true");
		expect(screen.getByRole("switch", { name: "跟随会话默认" }).hasAttribute("aria-describedby")).toBe(false);
		await user.click(screen.getByRole("button", { name: "Model A" }));
		await waitFor(() => expect(saved.builder).toMatchObject({ modelKey: "provider/a", reasoning: "low" }));
		expect(screen.getByRole("switch", { name: "跟随会话默认" }).getAttribute("aria-checked")).toBe("false");
		expect(store.get(teamMemberModelsAtom).team?.models?.builder?.modelKey).toBe("provider/a");
		await user.click(screen.getByRole("button", { name: "返回团队模型" }));
		expect(screen.getAllByRole("region")).toHaveLength(2);
		await user.click(screen.getByRole("button", { name: "开发者的模型" }));
		await user.click(screen.getByRole("switch", { name: "跟随会话默认" }));
		await waitFor(() => expect(saved.builder).toBeUndefined());
		expect(screen.getByRole("switch", { name: "跟随会话默认" }).getAttribute("aria-checked")).toBe("true");
		await user.click(screen.getByRole("switch", { name: "跟随会话默认" }));
		await waitFor(() => expect(saved.builder).toMatchObject({ modelKey: "provider/c" }));
		expect(screen.getByRole("switch", { name: "跟随会话默认" }).getAttribute("aria-checked")).toBe("false");
		await user.click(screen.getByRole("switch", { name: "跟随会话默认" }));
		await waitFor(() => expect(saved.builder).toBeUndefined());
		await user.click(screen.getByRole("button", { name: "返回团队模型" }));
		expect(screen.getAllByRole("region")).toHaveLength(1);
		expect(screen.getAllByRole("img")).toHaveLength(2);
		expect(screen.queryByText("生效范围")).toBeNull();
	});

	it("merges fixed and following members on the same model without changing the meaning of the default", async () => {
		saved = { leader: { agentProfileId: "leader", modelKey: "provider/a", reasoning: "high" } };
		mount();
		const user = await openPanel();
		expect(screen.getAllByRole("region")).toHaveLength(1);
		expect(screen.getByText(/不同推理档位/)).toBeTruthy();
		expect(screen.getByText(/切换仅影响跟随默认的 1 位成员/)).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "会话默认" }));
		await user.click(screen.getByRole("button", { name: "Model C" }));
		await user.click(screen.getByRole("button", { name: "返回团队模型" }));
		expect(screen.getAllByRole("region")).toHaveLength(2);
		expect(saved.leader).toMatchObject({ modelKey: "provider/a", reasoning: "high" });
		expect(save).not.toHaveBeenCalled();
	});

	it("changes reasoning inline and supports search, empty results, keyboard choice and back navigation", async () => {
		mount();
		const user = await openPanel();
		await user.click(screen.getByRole("button", { name: "负责人的模型" }));
		await user.click(screen.getByRole("button", { name: "低" }));
		await waitFor(() => expect(saved.leader?.reasoning).toBe("low"));
		const search = screen.getByRole("searchbox");
		await user.type(search, "unmatched");
		expect(screen.getByText(common.modelSelect.noResults)).toBeTruthy();
		await user.click(screen.getByRole("button", { name: common.modelSelect.clearSearch }));
		expect(document.activeElement).toBe(search);
		await user.type(search, "Model C");
		await user.keyboard("{ArrowDown}{Enter}");
		await waitFor(() => expect(saved.leader?.modelKey).toBe("provider/c"));
		await user.keyboard("{Escape}");
		expect(screen.getByRole("dialog")).toBeTruthy();
		expect(document.activeElement).toBe(screen.getByRole("button", { name: "负责人的模型" }));
		expect(screen.getByRole("button", { name: "会话默认" }).textContent).toContain("Model A");
		await user.keyboard("{Escape}");
		expect(screen.queryByRole("dialog")).toBeNull();
		await user.click(screen.getByRole("button", { name: "按成员配置" }));
		expect(screen.queryByRole("searchbox")).toBeNull();
	});

	it("previews reasoning while clicking or dragging the stepped track and saves once on release", async () => {
		vi.stubGlobal(
			"PointerEvent",
			class extends MouseEvent {
				readonly pointerId: number;
				constructor(type: string, init: PointerEventInit) {
					super(type, init);
					this.pointerId = init.pointerId ?? 0;
				}
			},
		);
		mount();
		const user = await openPanel();
		await user.click(screen.getByRole("button", { name: "负责人的模型" }));
		const slider = screen.getByRole("slider", { name: "推理" });
		const track = slider.closest<HTMLElement>('[data-slot="slider"]')!;
		Object.defineProperties(track, {
			getBoundingClientRect: { value: () => ({ left: 0, width: 200 }) },
			setPointerCapture: { value: vi.fn() },
			releasePointerCapture: { value: vi.fn() },
		});
		expect(slider.getAttribute("aria-valuetext")).toBe("高");

		fireEvent.pointerDown(track, { button: 0, pointerId: 1, clientX: 100 });
		expect(slider.getAttribute("aria-valuetext")).toBe("低");
		expect(saved.leader?.reasoning).toBe("high");
		fireEvent.pointerUp(track, { button: 0, pointerId: 1, clientX: 100 });
		await waitFor(() => expect(saved.leader?.reasoning).toBe("low"));
		expect(save).toHaveBeenCalledTimes(1);

		fireEvent.pointerDown(track, { button: 0, pointerId: 2, clientX: 100 });
		fireEvent.pointerMove(track, { button: 0, pointerId: 2, clientX: 200 });
		expect(slider.getAttribute("aria-valuetext")).toBe("高");
		expect(saved.leader?.reasoning).toBe("low");
		fireEvent.pointerUp(track, { button: 0, pointerId: 2, clientX: 200 });
		await waitFor(() => expect(saved.leader?.reasoning).toBe("high"));
		expect(save).toHaveBeenCalledTimes(2);

		slider.focus();
		await user.keyboard("{ArrowLeft}");
		await waitFor(() => expect(saved.leader?.reasoning).toBe("low"));
		expect(slider.getAttribute("aria-valuetext")).toBe("低");
		fireEvent.pointerDown(track, { button: 0, pointerId: 3, clientX: 0 });
		expect(slider.getAttribute("aria-valuetext")).toBe("关闭");
		fireEvent.pointerCancel(track, { pointerId: 3 });
		expect(slider.getAttribute("aria-valuetext")).toBe("低");
		expect(saved.leader?.reasoning).toBe("low");
	});

	it("keeps the reasoning editor steady while saving and confines scrolling to the model list", async () => {
		let finish!: (models: Readonly<Record<string, TeamMemberModelPreference>>) => void;
		save.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		mount();
		const user = await openPanel();
		await user.click(screen.getByRole("button", { name: "负责人的模型" }));
		const dialog = screen.getByRole("dialog", { name: "团队模型" });
		const slider = screen.getByRole("slider", { name: "推理" });
		expect(dialog.className).toContain("overflow-hidden");
		expect(dialog.className).not.toContain("overflow-y-auto");
		expect(screen.getByRole("group", { name: "模型" }).className).toContain("overflow-y-auto");

		await user.click(screen.getByRole("button", { name: "低" }));
		expect(within(dialog).getByRole("status").textContent).toContain("正在保存");
		expect(slider.getAttribute("aria-valuetext")).toBe("低");
		expect(slider.closest('[data-slot="slider"]')?.className).toContain("data-[disabled]:opacity-100");
		expect(screen.getByRole("button", { name: "高" }).className).toContain("disabled:opacity-100");
		expect(screen.getByRole("button", { name: "Model A" }).className).toContain("disabled:opacity-100");
		await act(async () => {
			saved = { leader: { agentProfileId: "leader", modelKey: "provider/b", reasoning: "low" } };
			finish(saved);
		});
		expect(screen.getByRole("slider", { name: "推理" })).toBe(slider);
		expect(slider.getAttribute("aria-valuetext")).toBe("低");
		expect(within(dialog).queryByRole("status")).toBeNull();
	});

	it("restores the selected reasoning step when saving fails", async () => {
		mount();
		const user = await openPanel();
		await user.click(screen.getByRole("button", { name: "负责人的模型" }));
		const slider = screen.getByRole("slider", { name: "推理" });
		save.mockRejectedValueOnce(new Error("disk full"));
		await user.click(screen.getByRole("button", { name: "低" }));
		expect((await screen.findByRole("alert")).textContent).toContain("disk full");
		await waitFor(() => expect(slider.getAttribute("aria-valuetext")).toBe("高"));
		expect(saved.leader?.reasoning).toBe("high");
	});

	it("opens immediately with loading feedback and then shows grouped members", async () => {
		let finish!: (models: Readonly<Record<string, TeamMemberModelPreference>>) => void;
		list.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		mount();
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: "选择模型" }));
		expect(screen.getByRole("status").textContent).toContain("正在读取成员模型");
		expect(screen.queryByRole("region")).toBeNull();
		await act(async () => {
			finish(saved);
		});
		expect(screen.getAllByRole("region")).toHaveLength(2);
	});

	it("retains saved values on failure and reflects external changes in the open picker", async () => {
		mount();
		const user = await openPanel();
		save.mockRejectedValueOnce(new Error("disk full"));
		await user.click(screen.getByRole("button", { name: "负责人的模型" }));
		await user.click(screen.getByRole("button", { name: "Model C" }));
		expect((await screen.findByRole("alert")).textContent).toContain("disk full");
		expect(screen.getByRole("button", { name: "Model B" }).getAttribute("aria-pressed")).toBe("true");
		await user.click(screen.getByRole("button", { name: "重新加载" }));
		await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
		saved = { leader: { agentProfileId: "leader", modelKey: "provider/c" } };
		act(() => {
			for (const listener of listeners) listener("team");
		});
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Model C" }).getAttribute("aria-pressed")).toBe("true"),
		);
	});

	it("retains unavailable models and recovers by following the default inside the picker", async () => {
		saved = { leader: { agentProfileId: "leader", modelKey: "provider/retired" } };
		mount();
		const user = await openPanel();
		expect(screen.getByRole("status").textContent).toContain("provider/retired 当前不可用");
		await user.click(screen.getByRole("button", { name: "负责人的模型" }));
		expect(screen.getByRole("status").textContent).toContain("provider/retired 当前不可用");
		await user.click(screen.getByRole("switch", { name: "跟随会话默认" }));
		await waitFor(() => expect(saved).toEqual({}));
		await user.click(screen.getByRole("button", { name: "返回团队模型" }));
		expect(screen.getAllByRole("region")).toHaveLength(1);
	});
});
