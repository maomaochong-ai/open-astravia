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

vi.mock("./useSkillList", () => ({ useSkillList: () => ({ items: [] }) }));
vi.mock("./useConnectorGrid", () => ({ useConnectorGrid: () => ({ items: [], columns: 4 }) }));
vi.mock("./useSkillIconMap", () => ({ useSkillIconMap: () => new Map(), skillIconOf: () => undefined }));
vi.mock("../components/useInputActionBarModel", () => ({
	useInputActionBarModel: () => ({ knowledge: undefined, items: [], actions: { toggleItem: vi.fn() } }),
}));
vi.mock("@shared/shortcuts", () => ({ useShortcutScope: vi.fn() }));

initI18n();

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
		Object.defineProperty(window, "vetta", {
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

	it("输入斜杆后可按 Enter 触发顶部压缩操作", async () => {
		const queueContextCompaction = vi.fn(async () => ({
			status: "queued" as const,
			id: "compact-1",
			pendingCount: 1,
		}));
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: { session: { queueContextCompaction } },
		});
		const onClose = vi.fn();
		renderHook(() =>
			useCommandPanelModel({
				open: true,
				onClose,
				onSelect: vi.fn(),
				onSelectConnector: vi.fn(),
				filter: "/",
			}),
		);
		const shortcutOptions = vi.mocked(useShortcutScope).mock.calls.at(-1)?.[0];
		const enter = shortcutOptions?.bindings.find((binding) => binding.key === "enter");
		if (!enter) throw new Error("enter shortcut was not registered");

		act(() => enter.run(new KeyboardEvent("keydown", { key: "Enter" })));
		await vi.waitFor(() => expect(queueContextCompaction).toHaveBeenCalledWith("session-1"));

		expect(onClose).toHaveBeenCalledOnce();
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
		Object.defineProperty(window, "vetta", {
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
