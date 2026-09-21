import { describe, expect, it, vi } from "vitest";
import { resolveCloseDecision } from "./resolve-close-decision";
import type { BottomPanelCloseConfirm } from "./types";

const fallbackConfirm: BottomPanelCloseConfirm = { title: "关闭这个面板？", message: "可能会中断工作。" };

/** 立即触发的超时，用来断言「等不到裁决」这条路径而不真的等 3 秒。 */
const immediateTimeout = async () => {};

describe("resolveCloseDecision", () => {
	it("没有守卫时直接关", async () => {
		const outcome = await resolveCloseDecision({
			guard: undefined,
			tabId: "t1",
			reason: "user-close-tab",
			fallbackConfirm,
		});

		expect(outcome).toEqual({ kind: "close" });
	});

	it("守卫返回 true 直接关，false 取消", async () => {
		const closed = await resolveCloseDecision({
			guard: async () => true,
			tabId: "t1",
			reason: "user-close-tab",
			fallbackConfirm,
		});
		const cancelled = await resolveCloseDecision({
			guard: async () => false,
			tabId: "t1",
			reason: "user-close-tab",
			fallbackConfirm,
		});

		expect(closed).toEqual({ kind: "close" });
		expect(cancelled).toEqual({ kind: "cancel" });
	});

	it("守卫返回文案时转成确认请求", async () => {
		const confirm: BottomPanelCloseConfirm = { title: "关闭终端？", message: "vim 还在跑。", destructive: true };

		const outcome = await resolveCloseDecision({
			guard: async () => confirm,
			tabId: "t1",
			reason: "user-close-tab",
			fallbackConfirm,
		});

		expect(outcome).toEqual({ kind: "confirm", confirm });
	});

	it("守卫迟迟不给裁决时按需要确认处理，而不是悄悄关掉", async () => {
		const outcome = await resolveCloseDecision({
			guard: () => new Promise(() => {}),
			tabId: "t1",
			reason: "user-close-tab",
			fallbackConfirm,
			delay: immediateTimeout,
		});

		expect(outcome).toEqual({ kind: "confirm", confirm: fallbackConfirm });
	});

	it("守卫自己抛错时同样走确认", async () => {
		const outcome = await resolveCloseDecision({
			guard: async () => {
				throw new Error("boom");
			},
			tabId: "t1",
			reason: "user-close-tab",
			fallbackConfirm,
		});

		expect(outcome).toEqual({ kind: "confirm", confirm: fallbackConfirm });
	});

	it("切会话与退出应用跳过确认，但仍会调用守卫让它收尾", async () => {
		const guard = vi.fn(async () => ({ title: "别关", message: "还在跑" }));

		for (const reason of ["session-switch", "app-quit"] as const) {
			const outcome = await resolveCloseDecision({ guard, tabId: "t1", reason, fallbackConfirm });
			expect(outcome).toEqual({ kind: "close" });
		}
		expect(guard).toHaveBeenCalledTimes(2);
	});

	it("退出路径上守卫抛错也不会卡住关闭", async () => {
		const outcome = await resolveCloseDecision({
			guard: async () => {
				throw new Error("boom");
			},
			tabId: "t1",
			reason: "app-quit",
			fallbackConfirm,
		});

		expect(outcome).toEqual({ kind: "close" });
	});
});
