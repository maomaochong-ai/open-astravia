/**
 * frame 活动态：从会话工具事件（read / edit / write）一路到画布浮层。
 * 这条链跨三个模块（index.tsx 的事件转发 → design-runtime 的状态机 → FrameActivityOverlay
 * 的渲染），任何一段断掉，用户看到的都是「浮层动画没了」，所以在这里整条串起来测。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
	type CanvasController,
	clearFrameActivity,
	type FrameActivity,
	notifyAgentToolArgs,
	notifyAgentToolEnd,
	notifyAgentToolStart,
	onFrameActivity,
	setCanvasController,
} from "../src/canvas/design-runtime";
import { FrameActivityOverlay } from "../src/canvas/FrameActivityOverlay";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DIR = "/w/demo.vetd";

function useFakeController(): void {
	setCanvasController({
		session: { dirPath: DIR, manifest: { frames: [{ id: "home" }, { id: "detail" }] } },
		notes: {},
		port: 1234,
		captureFrame: () => Promise.reject(new Error("n/a")),
		resolveNoteElements: () => Promise.reject(new Error("n/a")),
		openDesign: () => {},
	} as unknown as CanvasController);
}

let seen: ReadonlyMap<string, FrameActivity> = new Map();
let stop: (() => void) | null = null;

beforeEach(() => {
	vi.useFakeTimers();
	useFakeController();
	stop = onFrameActivity((next) => {
		seen = new Map(next);
	});
});

afterEach(() => {
	stop?.();
	clearFrameActivity();
	setCanvasController(null);
	vi.useRealTimers();
});

it("read / edit / write on a frame source map to the three activity kinds", () => {
	notifyAgentToolStart("c1", "read", { file_path: `${DIR}/frames/home.tsx` });
	expect(seen.get("home")).toBe("reading");

	notifyAgentToolStart("c2", "edit", { file_path: `${DIR}/frames/detail.tsx` });
	expect(seen.get("detail")).toBe("modifying");

	notifyAgentToolStart("c3", "write", { file_path: `${DIR}/frames/new.tsx` });
	expect(seen.get("new")).toBe("creating");
});

it("keeps the activity on screen for the minimum dwell even when the tool returns instantly", () => {
	notifyAgentToolStart("c1", "edit", { file_path: `${DIR}/frames/home.tsx` });
	notifyAgentToolEnd("c1", false);
	expect(seen.get("home")).toBe("modifying");
	// 工具几十毫秒就返回，动画全靠这段最短停留撑着；1.2s 减去渐入渐出后不足 0.9s，
	// 肉眼几乎抓不住，所以定在 2.5s。
	act(() => {
		vi.advanceTimersByTime(2_400);
	});
	expect(seen.get("home")).toBe("modifying");
	act(() => {
		vi.advanceTimersByTime(100);
	});
	expect(seen.get("home")).toBe("updated");
});

it("lights up as soon as the streamed arguments reveal the target, not when the tool executes", () => {
	// edit/write 真正耗时的是模型生成参数（一整份文件正文），执行只要几毫秒。
	// 只认 tool-call-start 的话，浮层要等活干完才亮——正是用户看到的现象。
	notifyAgentToolArgs("c1", "edit", { path: `${DIR}/frames/home.tsx` });
	expect(seen.get("home")).toBe("modifying");
});

it("does not restart the dwell when the tool finally executes", () => {
	// 生成阶段已经在计时了；tool-call-start 再刷一次 startedAt 的话，最短停留
	// 会从「活干完」重新算起，等于把提前点亮的收益又还回去。
	notifyAgentToolArgs("c1", "write", { path: `${DIR}/frames/home.tsx` });
	act(() => {
		vi.advanceTimersByTime(9_000);
	});
	notifyAgentToolStart("c1", "write", { path: `${DIR}/frames/home.tsx` });
	expect(seen.get("home")).toBe("creating");
	// 早就超过 2.5s 的最短停留了，收场不该再等。
	notifyAgentToolEnd("c1", false);
	expect(seen.get("home")).toBe("updated");
});

it("ignores streamed arguments that do not resolve to a frame yet", () => {
	// 第一个键还没解析出来时参数是空的；别把它当成「无目标」以外的任何东西。
	notifyAgentToolArgs("c1", "edit", {});
	expect(seen.size).toBe(0);
});

it("lights up every frame when the agent touches shared chrome", () => {
	// components/、theme.css、frames/_layout.tsx 影响的是每一屏，依赖关系无从判断。
	// 新的 .vetd 目录包 + skill 要求「先写共享外壳再逐屏填充」，agent 大部分编辑
	// 都落在这里；只认 frames/*.tsx 的话画布整段时间毫无反应。
	notifyAgentToolStart("c1", "edit", { file_path: `${DIR}/components/Shell.tsx` });
	expect(seen.get("home")).toBe("modifying");
	expect(seen.get("detail")).toBe("modifying");

	notifyAgentToolEnd("c1", false);
	act(() => {
		vi.advanceTimersByTime(2_500);
	});
	expect(seen.get("home")).toBe("updated");
	expect(seen.get("detail")).toBe("updated");
});

it("stays quiet for generated files — screenshots and the manifest are not sources", () => {
	notifyAgentToolStart("c1", "read", { file_path: `${DIR}/.snapshots/home-1.png` });
	notifyAgentToolStart("c2", "read", { file_path: `${DIR}/design.json` });
	notifyAgentToolStart("c3", "read", { file_path: `${DIR}/DESIGN.md` });
	expect(seen.size).toBe(0);
});

it("ignores paths outside the open design", () => {
	notifyAgentToolStart("c1", "edit", { file_path: "/w/other/src/app.tsx" });
	expect(seen.size).toBe(0);
});

it("keeps the overlay alive through a long generation", () => {
	// 活动态现在从「模型开始生成参数」起算，一次 write 整屏内容跑上几十秒很正常。
	// 兜底寿命必须长过它，否则浮层会在 agent 还在干活时自己消失。
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
		cb(0);
		return 1;
	});
	vi.stubGlobal("cancelAnimationFrame", () => {});

	act(() => {
		root.render(<FrameActivityOverlay activity="creating" />);
	});
	act(() => {
		vi.advanceTimersByTime(30_000);
	});
	// 元素留在 DOM 里不算数：渐出只是把 opacity 收到 0，看的是它还亮着没有。
	const overlay = host.querySelector(".vetd-activity-overlay") as HTMLElement | null;
	expect(overlay?.style.opacity).toBe("1");

	act(() => {
		root.unmount();
	});
	host.remove();
	vi.unstubAllGlobals();
});

it("renders the overlay with the per-kind decorations", () => {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	const rafs: FrameRequestCallback[] = [];
	vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
		rafs.push(cb);
		return rafs.length;
	});
	vi.stubGlobal("cancelAnimationFrame", () => {});

	act(() => {
		root.render(<FrameActivityOverlay activity="reading" />);
	});
	act(() => {
		for (const cb of rafs.splice(0)) cb(0);
	});

	const overlay = host.querySelector(".vetd-activity-overlay") as HTMLElement | null;
	expect(overlay).not.toBeNull();
	expect(overlay?.style.opacity).toBe("1");
	expect(host.querySelector(".vetd-fluid-blob")).not.toBeNull();
	expect(host.querySelector(".vetd-scan-beam")).not.toBeNull();
	expect(host.querySelector(".vetd-bot-think")).not.toBeNull();

	act(() => {
		root.render(<FrameActivityOverlay activity="creating" />);
	});
	expect(host.querySelectorAll(".vetd-spark").length).toBe(4);

	act(() => {
		root.unmount();
	});
	host.remove();
	vi.unstubAllGlobals();
});
