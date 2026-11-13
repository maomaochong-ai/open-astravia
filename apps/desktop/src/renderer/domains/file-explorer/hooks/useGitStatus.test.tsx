// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGitStatus } from "./useGitStatus";

const listeners: Array<(dir: string) => void> = [];
const gitStatus = vi.fn();

beforeEach(() => {
	listeners.length = 0;
	gitStatus.mockReset();
	(globalThis as { window?: unknown }).window = window;
	(window as unknown as { astravia: unknown }).astravia = {
		fs: {
			gitStatus,
			onDirChanged: (handler: (dir: string) => void) => {
				listeners.push(handler);
				return () => {
					const index = listeners.indexOf(handler);
					if (index >= 0) listeners.splice(index, 1);
				};
			},
		},
	};
});

afterEach(() => {
	cleanup();
	// 这个桩是整套测试共用的一份 window：不还原会污染同一 worker 里的其它用例
	// （它们会以为已经有一个只实现了 fs 的桥）。
	delete (window as unknown as { astravia?: unknown }).astravia;
});

describe("useGitStatus 刷新时机", () => {
	it("watchKey 变化时重新拉一次状态：Agent 改文件不一定触发 dir-changed", async () => {
		gitStatus.mockResolvedValueOnce({ "src/a.ts": " M" }).mockResolvedValueOnce({ "src/a.ts": " M", "src/b.ts": "??" });

		const { rerender } = renderHook(({ key }: { key: number }) => useGitStatus("/ws", key), {
			initialProps: { key: 0 },
		});
		await waitFor(() => expect(gitStatus).toHaveBeenCalledTimes(1));

		rerender({ key: 7 });
		await waitFor(() => expect(gitStatus).toHaveBeenCalledTimes(2));
	});

	it("watchKey 不变时不会因为父组件重渲染而反复拉取", async () => {
		gitStatus.mockResolvedValue({});
		const { rerender } = renderHook(({ key }: { key: number }) => useGitStatus("/ws", key), {
			initialProps: { key: 3 },
		});
		await waitFor(() => expect(gitStatus).toHaveBeenCalledTimes(1));

		rerender({ key: 3 });
		rerender({ key: 3 });
		// 仍然是 1 次：effect 依赖没有变化
		expect(gitStatus).toHaveBeenCalledTimes(1);
	});

	it("dir-changed 事件依旧触发刷新（原有行为不回退）", async () => {
		vi.useFakeTimers();
		try {
			gitStatus.mockResolvedValue({});
			renderHook(() => useGitStatus("/ws", 0));
			await vi.waitFor(() => expect(gitStatus).toHaveBeenCalledTimes(1));

			listeners.forEach((fn) => fn("/ws/src"));
			await vi.advanceTimersByTimeAsync(600);
			expect(gitStatus).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});
});
