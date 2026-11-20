// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { activeSessionAtom, contextUsageAtom, isCompactingAtom } from "@shared/store/atoms";
import { messageQueueBySessionAtom } from "@shared/store/message-queue-atoms";
import { dismissToast, toastsAtom } from "@shared/store/toast-atoms";
import { getDefaultStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@shared/i18n";
import { useShortcutScope } from "@shared/shortcuts";
import { useCommandPanelModel } from "./useCommandPanelModel";
import { useAddPanelAbilityEntries } from "./useAddPanelAbilityEntries";
import { useSkillList } from "./useSkillList";
import type { SkillInfo } from "@preload/api";

vi.mock("./useSkillList", () => ({ useSkillList: vi.fn(() => ({ items: [] })) }));
vi.mock("./useAddPanelAbilityEntries", () => ({ useAddPanelAbilityEntries: vi.fn(() => []) }));
vi.mock("./useConnectorGrid", () => ({ useConnectorGrid: () => ({ items: [], columns: 4 }) }));
vi.mock("./useSkillIconMap", () => ({ useSkillIconMap: () => new Map(), skillIconOf: () => undefined }));
vi.mock("../components/useInputActionBarModel", () => ({
	useInputActionBarModel: () => ({ builtins: [], items: [], actions: { toggleItem: vi.fn() } }),
}));
vi.mock("@shared/shortcuts", () => ({ useShortcutScope: vi.fn() }));

initI18n();

function keyEvent(key: string): React.KeyboardEvent<HTMLElement> {
	return {
		key,
		preventDefault: () => undefined,
		stopPropagation: () => undefined,
	} as unknown as React.KeyboardEvent<HTMLElement>;
}

describe("useCommandPanelModel context compaction", () => {
	beforeEach(() => {
		const store = getDefaultStore();
		store.set(activeSessionAtom, { cwd: "C:/workspace", runtimeId: "session-1", sessionPath: "C:/session.jsonl" });
		store.set(contextUsageAtom, { percent: 60, contextTokens: 60_000, contextWindow: 100_000 });
		store.set(isCompactingAtom, false);
		store.set(messageQueueBySessionAtom, new Map());
	});

	it("显示真实上下文占比，并从正常命令入口加入压缩队列", async () => {
		const queueContextCompaction = vi.fn(async () => ({
			status: "queued" as const,
			id: "compact-1",
			pendingCount: 1,
		}));
		Object.defineProperty(window, "astravia", {
			configurable: true,
			value: { session: { queueContextCompaction } },
		});
		const onClose = vi.fn();
		const { result } = renderHook(() =>
			useCommandPanelModel({
				open: true,
				onClose,
				onSelect: vi.fn(),
				onSelectConnector: vi.fn(),
				filter: "/",
			}),
		);

		expect(result.current.viewProps.operation?.description).toContain("60%");
		expect(result.current.viewProps.operation?.disabled).toBe(false);
		await act(async () => result.current.viewProps.operation?.onSelect());

		expect(queueContextCompaction).toHaveBeenCalledWith("session-1");
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("压缩上下文在「操作」分类里：切过去后按 Enter 才触发", async () => {
		const queueContextCompaction = vi.fn(async () => ({
			status: "queued" as const,
			id: "compact-1",
			pendingCount: 1,
		}));
		Object.defineProperty(window, "astravia", {
			configurable: true,
			value: { session: { queueContextCompaction } },
		});
		const onClose = vi.fn();
		const { result } = renderHook(() =>
			useCommandPanelModel({
				open: true,
				onClose,
				onSelect: vi.fn(),
				onSelectConnector: vi.fn(),
				filter: "/",
			}),
		);

		// 回归：默认分类是「全部」，且没有高亮项；此时 Enter 不该做任何事。
		expect(result.current.viewProps.tab).toBe("all");
		expect(result.current.viewProps.activeKey).toBeNull();
		act(() => result.current.viewProps.onPanelKeyDown(keyEvent("Enter")));
		expect(queueContextCompaction).not.toHaveBeenCalled();

		// 切到「操作」：压缩上下文是这里的唯一一行，按下 Enter 触发。
		act(() => result.current.viewProps.onSelectTab("operations"));
		act(() =>
			result.current.viewProps.onPanelKeyDown({
				key: "ArrowDown",
				preventDefault: () => undefined,
				stopPropagation: () => undefined,
			} as unknown as React.KeyboardEvent<HTMLElement>),
		);
		act(() =>
			result.current.viewProps.onPanelKeyDown({
				key: "Enter",
				preventDefault: () => undefined,
				stopPropagation: () => undefined,
			} as unknown as React.KeyboardEvent<HTMLElement>),
		);
		await vi.waitFor(() => expect(queueContextCompaction).toHaveBeenCalledWith("session-1"));

		expect(onClose).toHaveBeenCalledOnce();
	});

	it("未绑定 Runtime 时不显示会话级压缩操作", () => {
		const { result } = renderHook(() =>
			useCommandPanelModel({
				open: true,
				onClose: vi.fn(),
				onSelect: vi.fn(),
				onSelectConnector: vi.fn(),
				filter: "/",
				allowCompaction: false,
			}),
		);

		expect(result.current.viewProps.operation).toBeUndefined();
	});

	it("复用输入框装配的动作，让目标模式与计划模式出现在同一动作区", () => {
		const onToggleGoal = vi.fn();
		const { result } = renderHook(() =>
			useCommandPanelModel({
				inputActions: {
					actions: { toggleItem: vi.fn() },
					builtins: [
						{
							id: "plan",
							label: "计划模式",
							iconClass: "plan-icon",
							active: false,
							onToggle: vi.fn(),
						},
						{
							id: "goal",
							label: "目标模式",
							iconClass: "goal-icon",
							active: true,
							onToggle: onToggleGoal,
						},
					],
					items: [],
					visible: true,
				},
				open: true,
				onClose: vi.fn(),
				onSelect: vi.fn(),
				onSelectConnector: vi.fn(),
				filter: "/",
				allowCompaction: false,
			}),
		);

		expect(result.current.viewProps.actions.map(({ label }) => label)).toEqual([
			"计划模式",
			"目标模式",
		]);
		act(() => result.current.viewProps.actions[1]?.onToggle());
		expect(onToggleGoal).toHaveBeenCalledOnce();
	});

	it("新会话没有可压缩上下文时不展示压缩操作", () => {
		const store = getDefaultStore();
		store.set(activeSessionAtom, null);
		store.set(contextUsageAtom, null);

		const { result } = renderHook(() =>
			useCommandPanelModel({
				open: true,
				onClose: vi.fn(),
				onSelect: vi.fn(),
				onSelectConnector: vi.fn(),
				filter: "/",
			}),
		);

		expect(result.current.viewProps.operation).toBeUndefined();
	});

	it("已有压缩条目时禁用操作，避免连续点击重复排队", () => {
		getDefaultStore().set(
			messageQueueBySessionAtom,
			new Map([
				[
					"session-1",
					[{ id: "compact-1", behavior: "followUp", kind: "context_compaction", displayText: "context.compact" }],
				],
			]),
		);
		const { result } = renderHook(() =>
			useCommandPanelModel({
				open: true,
				onClose: vi.fn(),
				onSelect: vi.fn(),
				onSelectConnector: vi.fn(),
				filter: "/",
			}),
		);

		expect(result.current.viewProps.operation?.disabled).toBe(true);
		expect(result.current.viewProps.operation?.description).toMatch(/Queued|队列/);
	});

	it("加入压缩队列失败时关闭面板并显示错误提示", async () => {
		const store = getDefaultStore();
		store.set(toastsAtom, []);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const queueContextCompaction = vi.fn(async () => {
			throw new Error("queue unavailable");
		});
		Object.defineProperty(window, "astravia", {
			configurable: true,
			value: { session: { queueContextCompaction } },
		});
		const onClose = vi.fn();
		const { result } = renderHook(() =>
			useCommandPanelModel({
				open: true,
				onClose,
				onSelect: vi.fn(),
				onSelectConnector: vi.fn(),
				filter: "/compact",
			}),
		);

		act(() => result.current.viewProps.operation?.onSelect());
		await vi.waitFor(() => expect(store.get(toastsAtom)).toHaveLength(1));

		expect(onClose).toHaveBeenCalledOnce();
		const toast = store.get(toastsAtom)[0];
		expect(toast).toMatchObject({ variant: "error", message: "queue unavailable" });
		if (toast) dismissToast(toast.id);
		warn.mockRestore();
	});
});

describe("useCommandPanelModel skill insertion", () => {
	beforeEach(() => {
		vi.mocked(useSkillList).mockReturnValue({ items: [], loading: false });
		vi.mocked(useAddPanelAbilityEntries).mockReturnValue([]);
	});

	it("点击技能行按能力 id 的末段 slug 匹配原始技能并插入", () => {
		const skill: SkillInfo = { name: "my-skill", type: "skill", description: "", source: "user" };
		vi.mocked(useSkillList).mockReturnValue({ items: [skill], loading: false });
		vi.mocked(useAddPanelAbilityEntries).mockReturnValue([
			{
				category: "skill",
				id: "local:local:skill:my-skill",
				key: "skills:local:local:skill:my-skill",
				label: "My Skill",
				groupId: "mine",
				searchable: true,
				fallbackIcon: "icon-[solar--code-linear]",
				kind: "skill",
				insertable: true,
			},
		]);

		const onSelect = vi.fn();
		const { result } = renderHook(() =>
			useCommandPanelModel({
				open: true,
				onClose: vi.fn(),
				onSelect,
				onSelectConnector: vi.fn(),
				filter: "/",
			}),
		);

		act(() => result.current.viewProps.onActivateEntry("skills:local:local:skill:my-skill"));

		expect(onSelect).toHaveBeenCalledWith(skill, undefined);
	});

	// 回归：插件自身不产出文本，点它插入的是它贡献的第一个可见技能（见 ADR-0183）。
	// 此前插件行走 `default` 分支只开预览，于是「点插件什么都不进输入框」。
	it("点击插件行插入它贡献的第一个技能", () => {
		const first: SkillInfo = {
			name: "alpha",
			alias: "Alpha",
			type: "skill",
			description: "",
			source: "plugin",
			sourcePluginId: "demo-plugin",
			// 插件贡献的技能默认隐藏，插件必须显式声明它在命令区可见才可插入。
			presentation: { surfaces: { commandPalette: "visible" } },
		};
		const second: SkillInfo = {
			name: "beta",
			alias: "Beta",
			type: "skill",
			description: "",
			source: "plugin",
			sourcePluginId: "demo-plugin",
			// 插件贡献的技能默认隐藏，插件必须显式声明它在命令区可见才可插入。
			presentation: { surfaces: { commandPalette: "visible" } },
		};
		vi.mocked(useSkillList).mockReturnValue({ items: [second, first], loading: false });
		vi.mocked(useAddPanelAbilityEntries).mockReturnValue([
			{
				category: "plugin",
				id: "github:astravia-official:plugin:demo-plugin",
				key: "plugin:github:astravia-official:plugin:demo-plugin",
				label: "Demo Plugin",
				groupId: "market",
				searchable: true,
				fallbackIcon: "icon-[solar--box-linear]",
				kind: "plugin",
				insertable: true,
			},
		]);

		const onSelect = vi.fn();
		const { result } = renderHook(() =>
			useCommandPanelModel({
				open: true,
				onClose: vi.fn(),
				onSelect,
				onSelectConnector: vi.fn(),
				filter: "/",
			}),
		);

		act(() => result.current.viewProps.onActivateEntry("plugin:github:astravia-official:plugin:demo-plugin"));

		expect(onSelect).toHaveBeenCalledWith(first, undefined);
	});

	// 回归：内置能力对话里本就可用，行只做展示；点击/回车都不该往输入框插东西，
	// 方向键也不该停在它上面（停上去按回车没反应，比直接跳过更像坏了）。
	it("内置能力行不可插入，键盘导航也跳过它", () => {
		const builtin: SkillInfo = { name: "builtin-skill", type: "skill", description: "", source: "builtin" };
		const mine: SkillInfo = { name: "my-skill", type: "skill", description: "", source: "user" };
		vi.mocked(useSkillList).mockReturnValue({ items: [builtin, mine], loading: false });
		const base = {
			searchable: true,
			fallbackIcon: "icon-[solar--code-linear]",
			kind: "skill" as const,
		};
		vi.mocked(useAddPanelAbilityEntries).mockReturnValue([
			{
				...base,
				category: "skill",
				id: "builtin:builtin:skill:builtin-skill",
				key: "skills:builtin:builtin:skill:builtin-skill",
				label: "Builtin Skill",
				groupId: "builtin",
				insertable: false,
			},
			{
				...base,
				category: "skill",
				id: "local:local:skill:my-skill",
				key: "skills:local:local:skill:my-skill",
				label: "My Skill",
				groupId: "mine",
				insertable: true,
			},
		]);

		const onSelect = vi.fn();
		const { result } = renderHook(() =>
			useCommandPanelModel({
				open: true,
				onClose: vi.fn(),
				onSelect,
				onSelectConnector: vi.fn(),
				filter: "/",
			}),
		);

		// 鼠标点上来也不插入。
		act(() => result.current.viewProps.onActivateEntry("skills:builtin:builtin:skill:builtin-skill"));
		expect(onSelect).not.toHaveBeenCalled();

		// 方向键第一格落在唯一可插入的那条上。
		act(() => {
			result.current.viewProps.onPanelKeyDown({
				key: "ArrowDown",
				preventDefault: vi.fn(),
				stopPropagation: vi.fn(),
			} as unknown as React.KeyboardEvent<HTMLElement>);
		});
		expect(result.current.viewProps.activeKey).toBe("skills:local:local:skill:my-skill");
	});
});
