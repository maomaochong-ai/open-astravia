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
// 插件插入走编辑器句柄（插一枚 `@plugin:` 令牌）；这里只验证「插了什么」。
const { insertPluginToken } = vi.hoisted(() => ({ insertPluginToken: vi.fn() }));
vi.mock("../components/input-bar/editor/inputEditorHandle", async (importOriginal) => ({
	// 只覆盖插件插入用到的两个；其余（removeInputTrigger 等）保持真实导出，
	// 否则压缩相关的用例会因为缺导出而失败。
	...(await importOriginal<typeof import("../components/input-bar/editor/inputEditorHandle")>()),
	focusInputEditor: vi.fn(),
	insertPluginToken,
}));

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

	it("宿主不允许会话级操作时不出现压缩条目", () => {
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

	// 回归：「操作」分类在没有会话时曾整行消失，面板里那格变成空白，用户看到的是
	// 「压缩上下文不见了」。现在给一行禁用的说明，点不动也知道原因。
	it("允许压缩但还没有会话时，仍给出禁用的压缩说明行", () => {
		// 默认 store 会被前面的用例留下会话，这里必须显式清掉才能复现「新会话」。
		getDefaultStore().set(activeSessionAtom, null);
		const { result } = renderHook(() =>
			useCommandPanelModel({
				open: true,
				onClose: vi.fn(),
				onSelect: vi.fn(),
				onSelectConnector: vi.fn(),
				filter: "/",
			}),
		);

		expect(result.current.viewProps.operation).toMatchObject({ disabled: true });
		expect(result.current.viewProps.operation?.description).toBeTruthy();
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

	it("新会话没有可压缩上下文时仍给出禁用的压缩说明行", () => {
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

		// 整行消失会让「操作」分类变成空白格；给一行禁用说明，用户点不动也知道原因。
		expect(result.current.viewProps.operation).toMatchObject({ disabled: true });
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

	// 回归：插件是能力包，不是「挑一个技能顶上来」。点插件插入的是插件引用令牌——
	// 替用户挑第一个技能会让包里其余技能没法用（见 ADR-0183）。
	it("点击插件行插入插件令牌，而不是它旗下的某个技能", () => {
		const first: SkillInfo = {
			name: "alpha",
			alias: "Alpha",
			type: "skill",
			description: "",
			source: "plugin",
			sourcePluginId: "demo-plugin",
			presentation: { surfaces: { commandPalette: "visible" } },
		};
		vi.mocked(useSkillList).mockReturnValue({ items: [first], loading: false });
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

		expect(onSelect).not.toHaveBeenCalled();
		// 插入的是插件本身（slug），不是包里某个技能。
		expect(insertPluginToken).toHaveBeenCalledWith("demo-plugin", "Demo Plugin", undefined, {
			replaceTrigger: true,
		});
	});

	// 回归：内置能力（随 App 分发）与其它条目一样可插入——上游就是这么做的，
	// 用户点「安装技能」这类内置技能要能进输入框，而不是只能看。
	it("内置能力行可插入，并参与键盘导航", () => {
		const builtin: SkillInfo = { name: "builtin-skill", type: "skill", description: "", source: "builtin" };
		vi.mocked(useSkillList).mockReturnValue({ items: [builtin], loading: false });
		const base = { searchable: true, fallbackIcon: "icon-[solar--code-linear]", kind: "skill" as const };
		vi.mocked(useAddPanelAbilityEntries).mockReturnValue([
			{
				...base,
				category: "skill",
				id: "builtin:builtin:skill:builtin-skill",
				key: "skills:builtin:builtin:skill:builtin-skill",
				label: "Builtin Skill",
				groupId: "builtin",
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

		act(() => result.current.viewProps.onActivateEntry("skills:builtin:builtin:skill:builtin-skill"));
		expect(onSelect).toHaveBeenCalledWith(builtin, undefined);
	});
});
