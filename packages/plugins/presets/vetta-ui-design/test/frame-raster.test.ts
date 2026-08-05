/**
 * 位图截图队列的竞态回归测试。
 *
 * 复现的 bug：截图从静置到编码可达数秒，期间 agent 改了代码（HMR/文件监听触发
 * invalidate），但截图完成后的 finally 无条件清掉脏标记——这次 invalidate 被吞掉，
 * 旧位图永久留存，直到用户点进 frame 才发现活体和位图对不上。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BridgeHub } from "../src/canvas/bridge-client";
import { type FrameRasterState, useFrameRasters } from "../src/canvas/frame-raster";

/** SETTLE_MS 的镜像：测试只需要「大于静置时间」，不必和实现逐字节同步。 */
const SETTLE = 500;

interface PendingCapture {
	frameId: string;
	resolve: (dataUrl: string) => void;
	reject: (error: unknown) => void;
}

let captures: PendingCapture[];
let bridge: BridgeHub;
let latest: FrameRasterState;
let root: Root;
let container: HTMLElement;

function Harness(props: { frameIds: readonly string[]; activeFrameId: string | null }): null {
	latest = useFrameRasters({
		bridge,
		cacheKey: "/design/demo.vetd",
		frameIds: props.frameIds,
		activeFrameId: props.activeFrameId,
	});
	return null;
}

/** 让 restore effect 里的 IndexedDB promise 链走完（缓存不可用路径）。 */
async function flushMicrotasks(): Promise<void> {
	await act(async () => {
		for (let i = 0; i < 8; i += 1) await Promise.resolve();
	});
}

async function advance(ms: number): Promise<void> {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(ms);
	});
}

async function mount(frameIds: readonly string[]): Promise<void> {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	await act(async () => {
		root.render(createElement(Harness, { frameIds, activeFrameId: null }));
	});
	await flushMicrotasks();
}

beforeEach(() => {
	vi.useFakeTimers();
	(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
	// 测试环境没有可用的 IndexedDB：raster-cache 会安静地退回「无缓存」路径。
	vi.stubGlobal("indexedDB", undefined);
	// decodeRaster 走 new Image().decode()；给一个立即成功的替身。
	vi.stubGlobal(
		"Image",
		class {
			src = "";
			decode(): Promise<void> {
				return Promise.resolve();
			}
		},
	);
	captures = [];
	bridge = {
		capture: (frameId: string) =>
			new Promise<string>((resolve, reject) => {
				captures.push({ frameId, resolve, reject });
			}),
	} as unknown as BridgeHub;
});

afterEach(async () => {
	await act(async () => {
		root.unmount();
	});
	container.remove();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

it("rendered 信号之前不截图，避免截到未渲染完成的空白", async () => {
	await mount(["a"]);

	// dirty 从冷启动 restore 就有了，但 iframe 首帧还没画出来：不许截。
	await advance(SETTLE * 4);
	expect(captures.length).toBe(0);

	act(() => latest.notifyRendered("a"));
	await advance(SETTLE);
	expect(captures.length).toBe(1);
});

it("截图期间被 invalidate 的 frame 会重新截图，而不是停在旧位图", async () => {
	await mount(["a"]);

	act(() => latest.notifyRendered("a"));
	await advance(SETTLE);
	expect(captures.length).toBe(1);

	// 截图还没回来时 agent 改了代码：HMR / 文件监听触发 invalidate。
	act(() => latest.invalidate("a"));

	// 旧内容的截图此刻才落地。
	captures[0].resolve("data:stale");
	await flushMicrotasks();

	// 脏标记必须还在：重新排队截一张新的。
	await advance(SETTLE);
	expect(captures.length).toBe(2);

	captures[1].resolve("data:fresh");
	await flushMicrotasks();
	expect(latest.rasterOf("a")).toBe("data:fresh");

	// 收敛：没有新的 invalidate 就不再重截。
	await advance(SETTLE * 4);
	expect(captures.length).toBe(2);
});

/**
 * 复现的 bug：vetd_screenshot / 导出走的是另一个截图入口，不经过队列的串行控制，
 * 于是「agent 写完源码（这一帧变脏进队列）→ 立刻截图」会让两次 html-to-image 同时
 * 打同一个 iframe，互相拖慢到双双超时。
 */
it("交付物截图持锁期间，位图队列不会并发截同一帧", async () => {
	await mount(["a"]);

	// vetd_screenshot 先拿到锁。
	const tool = latest.withCaptureLock(() => bridge.capture("a"));
	await flushMicrotasks();
	expect(captures.length).toBe(1);

	// 同一时刻这一帧渲染完成，队列也想截它——必须卡在锁上。
	act(() => latest.notifyRendered("a"));
	await advance(SETTLE * 2);
	expect(captures.length).toBe(1);

	captures[0].resolve("data:tool");
	await act(async () => {
		await tool;
	});
	await flushMicrotasks();
	expect(captures.length).toBe(2);
});

it("没有 invalidate 时只截一次，位图落地后 frame 退出活体", async () => {
	await mount(["a"]);

	act(() => latest.notifyRendered("a"));
	await advance(SETTLE);
	expect(captures.length).toBe(1);

	captures[0].resolve("data:only");
	await flushMicrotasks();
	expect(latest.rasterOf("a")).toBe("data:only");
	expect(latest.isLive("a")).toBe(false);

	await advance(SETTLE * 4);
	expect(captures.length).toBe(1);
});
