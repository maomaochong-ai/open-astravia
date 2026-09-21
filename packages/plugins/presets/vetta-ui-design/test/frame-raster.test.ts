/**
 * 位图截图队列的竞态回归测试。
 *
 * 复现的 bug：截图从静置到编码可达数秒，期间 agent 改了代码（HMR/文件监听触发
 * invalidate），但截图完成后的 finally 无条件清掉脏标记——这次 invalidate 被吞掉，
 * 旧位图永久留存，直到用户点进 frame 才发现活体和位图对不上。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginContext } from "@vetta-org/plugin-sdk";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BridgeHub } from "../src/canvas/bridge-client";
import { clearFrameErrors, setFrameError } from "../src/canvas/design-runtime";
import { type FrameRasterState, useFrameRasters } from "../src/canvas/frame-raster";
import { setPluginCtx } from "../src/plugin-context";

/** SETTLE_MS 的镜像：测试只需要「大于静置时间」，不必和实现逐字节同步。 */
const SETTLE = 500;

interface PendingCapture {
	frameId: string;
	resolve: (dataUrl: string) => void;
	reject: (error: unknown) => void;
}

interface TestOffscreenContext {
	port: number;
	sizeOf(frameId: string): { width: number; height: number } | null;
	onUnavailable?(error: unknown): void;
}

let captures: PendingCapture[];
let bridge: BridgeHub;
let latest: FrameRasterState;
let root: Root;
let container: HTMLElement;

function Harness(props: {
	frameIds: readonly string[];
	activeFrameId: string | null;
	interacting?: boolean;
	offscreen?: TestOffscreenContext | null;
}): null {
	latest = useFrameRasters({
		bridge,
		cacheKey: "/design/demo.vetd",
		frameIds: props.frameIds,
		activeFrameId: props.activeFrameId,
		interacting: props.interacting ?? false,
		offscreen: props.offscreen ?? null,
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

async function mount(
	frameIds: readonly string[],
	offscreen?: TestOffscreenContext | null,
): Promise<void> {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	await act(async () => {
		root.render(createElement(Harness, { frameIds, activeFrameId: null, offscreen }));
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

/**
 * 离屏模式（宿主 ctx.capture 可用）：截图走主进程隐藏窗口，不再要求 frame 挂活体
 * iframe、也没有 rendered 门禁——冷启动第一轮就能开截。
 */
it("离屏模式下不等 rendered 信号、不要求挂载就开始截图", async () => {
	const offscreenCalls: string[] = [];
	setPluginCtx({
		capture: {
			offscreen: (options: { prepareScript?: string }) => {
				offscreenCalls.push(options.prepareScript ?? "");
				return Promise.resolve({ dataUrl: "data:offscreen", scaleFactor: 2 });
			},
			releaseOffscreen: () => Promise.resolve(),
		},
	} as unknown as PluginContext);
	try {
		await mount(["a"], { port: 5173, sizeOf: () => ({ width: 390, height: 844 }) });

		// 没有任何 rendered 信号，也照样进入截图（宿主侧自己等引擎的就绪标记）。
		await advance(50);
		await flushMicrotasks();
		expect(offscreenCalls.length).toBe(1);
		expect(offscreenCalls[0]).toContain("show-frame");
		// html-to-image 老路一次都不该走。
		expect(captures.length).toBe(0);
		expect(latest.rasterOf("a")).toBe("data:offscreen");
	} finally {
		setPluginCtx(null as unknown as PluginContext);
	}
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

/**
 * 冷启动时二十帧的设计稿如果一张接一张地截，排在后面的十几帧全程只有启动占位——
 * 「每个 frame 都载入得很慢」就是这么来的。离屏窗口不占画布主线程，队列按槽位并发。
 */
it("离屏模式下并发截图，不同帧落在不同的离屏会话上", async () => {
	const pending: { sessionKey: string; resolve: (value: { dataUrl: string; scaleFactor: number }) => void }[] = [];
	setPluginCtx({
		capture: {
			offscreen: (options: { sessionKey?: string }) =>
				new Promise<{ dataUrl: string; scaleFactor: number }>((resolve) => {
					pending.push({ sessionKey: options.sessionKey ?? "", resolve });
				}),
			releaseOffscreen: () => Promise.resolve(),
		},
	} as unknown as PluginContext);
	try {
		await mount(["a", "b", "c", "d"], { port: 5173, sizeOf: () => ({ width: 390, height: 844 }) });
		await advance(50);
		await flushMicrotasks();

		// 三张同时在跑，第四张等空位——上限来自宿主的每插件会话数（留一个给交付物截图）。
		expect(pending.length).toBe(3);
		expect(new Set(pending.map((call) => call.sessionKey)).size).toBe(3);

		pending[0].resolve({ dataUrl: "data:a", scaleFactor: 2 });
		await flushMicrotasks();
		await advance(50);
		await flushMicrotasks();
		expect(pending.length).toBe(4);
		// 空出来的槽位被复用，不会无限开窗口。
		expect(pending[3].sessionKey).toBe(pending[0].sessionKey);
	} finally {
		setPluginCtx(null as unknown as PluginContext);
	}
});

it("预览端口失联时只上报一次并抑制并发槽的重复错误日志", async () => {
	const failure = new Error("ERR_CONNECTION_REFUSED (-102) loading 'http://127.0.0.1:53114/'");
	const onUnavailable = vi.fn();
	const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
	setPluginCtx({
		capture: {
			offscreen: () => Promise.reject(failure),
			releaseOffscreen: () => Promise.resolve(),
		},
	} as unknown as PluginContext);
	try {
		await mount(["a", "b", "c"], {
			port: 53114,
			sizeOf: () => ({ width: 390, height: 844 }),
			onUnavailable,
		});
		await advance(50);
		await flushMicrotasks();

		expect(onUnavailable).toHaveBeenCalledTimes(1);
		expect(onUnavailable).toHaveBeenCalledWith(failure);
		expect(consoleError).toHaveBeenCalledTimes(1);
	} finally {
		consoleError.mockRestore();
		setPluginCtx(null as unknown as PluginContext);
	}
});

/**
 * 复现的 bug：引擎侧的 FramePainted 没有依赖数组，frame 每提交一次就重发一条
 * rendered（engine/src/main.tsx）。画布收到后无条件换掉 dirty 的引用，截图 effect
 * 跟着重跑，cleanup 把还在静置等待的那张作废重来——信号间隔短于静置时间时，这一帧
 * 永远截不出来，整块画布还陪着一轮轮重渲染（肉眼就是画布发闪）。
 */
it("重复的 rendered 不会把还在静置的截图一再作废", async () => {
	await mount(["a"]);

	act(() => latest.notifyRendered("a"));
	// 每隔「短于静置时间」就来一条，模拟 frame 持续提交。
	for (let i = 0; i < 4; i += 1) {
		await advance(SETTLE * 0.6);
		act(() => latest.notifyRendered("a"));
	}

	expect(captures.length).toBeGreaterThan(0);
});

/**
 * 去重不能把构建失败那条恢复路径一起吃掉：错误态存在 design-runtime 的模块级 store
 * 里，不是这个 hook 的依赖，队列唯一的复活输入就是 frame 恢复渲染时那条 rendered。
 */
it("构建失败期间被跳过的 frame，恢复渲染后会重新进队列", async () => {
	await mount(["a"]);

	setFrameError("a", "Unexpected token");
	act(() => latest.notifyRendered("a"));
	await advance(SETTLE * 2);
	expect(captures.length).toBe(0);

	// 改好了：引擎重新渲染、错误清空，随后补上这一帧的 rendered。
	setFrameError("a", null);
	act(() => latest.notifyRendered("a"));
	await advance(SETTLE * 2);
	expect(captures.length).toBe(1);

	clearFrameErrors();
});

/**
 * 离屏模式下「有位图的 frame 一律不挂 iframe」，于是每次选中都要从零新建一个跨源
 * iframe、整页重启引擎，取消选中再销毁。来回点选就是来回重建，每次都重走一遍
 * 「空白 → 位图盖住 → 画出来」，画布跟着闪。刚取消选中的那一帧要留住。
 */
it("刚取消选中的 frame 保持挂载，再次选中时不用重建 iframe", async () => {
	setPluginCtx({
		capture: {
			offscreen: () => Promise.resolve({ dataUrl: "data:offscreen", scaleFactor: 2 }),
			releaseOffscreen: () => Promise.resolve(),
		},
	} as unknown as PluginContext);
	try {
		const offscreen = { port: 5173, sizeOf: () => ({ width: 390, height: 844 }) };
		await mount(["a", "b"], offscreen);
		await advance(50);
		await flushMicrotasks();

		// 两帧都截好了，都退出活体。
		expect(latest.isMounted("a")).toBe(false);

		const render = async (activeFrameId: string | null): Promise<void> => {
			await act(async () => {
				root.render(createElement(Harness, { frameIds: ["a", "b"], activeFrameId, offscreen }));
			});
		};

		await render("a");
		expect(latest.isMounted("a")).toBe(true);
		expect(latest.isLive("a")).toBe(true);

		// 取消选中：位图接管画面，但 iframe 留着，再次选中只翻一个 display。
		await render(null);
		expect(latest.isMounted("a")).toBe(true);
		expect(latest.isLive("a")).toBe(false);

		await render("a");
		expect(latest.isLive("a")).toBe(true);
	} finally {
		setPluginCtx(null as unknown as PluginContext);
	}
});

/**
 * 缩放/平移途中活体 iframe 是最贵的一层：跨源渲染树套在 world 的 scale 底下，缩放每变
 * 一档就得连同它整棵树重新光栅化。有位图的先用位图顶着，iframe 只收起不卸载。
 */
it("交互期把有位图的 frame 降为位图，iframe 收起但不卸载", async () => {
	setPluginCtx({
		capture: {
			offscreen: () => Promise.resolve({ dataUrl: "data:offscreen", scaleFactor: 2 }),
			releaseOffscreen: () => Promise.resolve(),
		},
	} as unknown as PluginContext);
	try {
		const offscreen = { port: 5173, sizeOf: () => ({ width: 390, height: 844 }) };
		await mount(["a", "b"], offscreen);
		await advance(50);
		await flushMicrotasks();

		const render = async (interacting: boolean): Promise<void> => {
			await act(async () => {
				root.render(createElement(Harness, { frameIds: ["a", "b"], activeFrameId: "a", interacting, offscreen }));
			});
		};

		await render(false);
		expect(latest.isMounted("a")).toBe(true);
		expect(latest.isLive("a")).toBe(true);

		// 手势开始：位图顶上，iframe 收起。
		await render(true);
		expect(latest.isLive("a")).toBe(false);
		// 但必须还挂着——卸掉就要整页重新加载，操作结束会看见一轮重启。
		expect(latest.isMounted("a")).toBe(true);

		// 结束后恢复活体。
		await render(false);
		expect(latest.isLive("a")).toBe(true);
	} finally {
		setPluginCtx(null as unknown as PluginContext);
	}
});

/** 还没截到位图的 frame 不能收：那是它此刻唯一有内容的层，收起来就是一片空白。 */
it("交互期没有位图的 frame 仍然保持活体", async () => {
	await mount(["a"]);

	await act(async () => {
		root.render(createElement(Harness, { frameIds: ["a"], activeFrameId: null, interacting: true }));
	});
	expect(latest.rasterOf("a")).toBe(null);
	expect(latest.isLive("a")).toBe(true);
});

/**
 * 用户在一帧里切了主题（写进 localStorage）：这是整个设计共用的状态，所有位图都按旧
 * 状态截的，要全部重截；还挂着的其他 iframe 内存里也是旧状态，要重新加载。来源那一帧
 * 自己已经是新状态，不能打断它。
 */
it("持久化状态变化后全部重截，并重载其他还挂着的 iframe", async () => {
	const pending: { resolve: (value: { dataUrl: string; scaleFactor: number }) => void }[] = [];
	setPluginCtx({
		capture: {
			offscreen: () =>
				new Promise<{ dataUrl: string; scaleFactor: number }>((resolve) => {
					pending.push({ resolve });
				}),
			releaseOffscreen: () => Promise.resolve(),
		},
	} as unknown as PluginContext);
	try {
		const offscreen = { port: 5173, sizeOf: () => ({ width: 390, height: 844 }) };
		await mount(["a", "b", "c"], offscreen);
		// 还没有任何位图：b、c 以活体兜底显示，a 被选中。
		await act(async () => {
			root.render(createElement(Harness, { frameIds: ["a", "b", "c"], activeFrameId: "a", offscreen }));
		});
		await advance(50);
		await flushMicrotasks();
		expect(latest.isMounted("b")).toBe(true);
		expect(latest.isMounted("c")).toBe(true);
		const before = { a: latest.reloadNonceOf("a"), b: latest.reloadNonceOf("b"), c: latest.reloadNonceOf("c") };

		// 截图还在飞的时候，用户在 a 里切了主题。
		act(() => latest.storageChanged("a"));

		// b、c 的 iframe 内存里还是旧状态，重新加载；a 是来源，正在操作，不能打断。
		expect(latest.reloadNonceOf("a")).toBe(before.a);
		expect(latest.reloadNonceOf("b")).toBe(before.b + 1);
		expect(latest.reloadNonceOf("c")).toBe(before.c + 1);

		// 在飞的那几张是按旧状态截的：落地后仍留在队列里重截，而不是就此收工。
		const inFlight = pending.length;
		for (const call of pending.splice(0)) call.resolve({ dataUrl: "data:stale", scaleFactor: 2 });
		await flushMicrotasks();
		await advance(50);
		await flushMicrotasks();
		expect(inFlight).toBeGreaterThan(0);
		expect(pending.length).toBe(inFlight);
	} finally {
		setPluginCtx(null as unknown as PluginContext);
	}
});
