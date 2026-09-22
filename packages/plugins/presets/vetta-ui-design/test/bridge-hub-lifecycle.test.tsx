/**
 * 画布的 bridge 回调随状态换引用（frameIds 随视口裁剪重排 → refreshAll → storageChanged）。
 * 以前每换一次就 stop/start 一轮：stop 清掉所有 frame 的 iframe 登记，而 FrameView 的
 * 注册 effect 不会因此重跑。于是元素选中的消息认不出来源（选不中元素），截图报
 * `frame not mounted`。回调换引用只能换回调，登记与挂起的截图都得留着。
 */
import { afterEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { BridgeHub, type BridgeHubEvents } from "../src/canvas/bridge-client";
import { useBridgeEvents } from "../src/canvas/use-bridge-events";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function events(overrides: Partial<BridgeHubEvents> = {}): BridgeHubEvents {
	const noop = () => {};
	return {
		onSelected: noop,
		onExitInspect: noop,
		onHmrUpdated: noop,
		onRendered: noop,
		onFrameError: noop,
		onFrameContextMenu: noop,
		onFrameWheel: noop,
		onFrameSpace: noop,
		onStorage: noop,
		...overrides,
	};
}

function Harness({ bridge, handlers }: { bridge: BridgeHub; handlers: BridgeHubEvents }) {
	useBridgeEvents(bridge, handlers);
	return null;
}

function fromFrame(iframe: HTMLIFrameElement, data: Record<string, unknown>): void {
	window.dispatchEvent(new MessageEvent("message", { data: { vetd: true, ...data }, source: iframe.contentWindow }));
}

afterEach(() => {
	document.body.innerHTML = "";
});

it("keeps frame registrations and in-flight captures when the callbacks change", async () => {
	const bridge = new BridgeHub();
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	const first = vi.fn();
	act(() => root.render(<Harness bridge={bridge} handlers={events({ onSelected: first })} />));

	const iframe = document.createElement("iframe");
	document.body.append(iframe);
	bridge.register("home", iframe);
	fromFrame(iframe, { type: "ready", frameId: "home" });
	const pending = bridge.capture("home", { timeoutMs: 5_000 });
	const requestId = await new Promise<string>((resolve) => {
		iframe.contentWindow?.addEventListener("message", (event) => resolve((event.data as { requestId: string }).requestId));
	});

	// 画布状态一变，回调换了一份新引用。
	const second = vi.fn();
	act(() => root.render(<Harness bridge={bridge} handlers={events({ onSelected: second })} />));

	fromFrame(iframe, { type: "selected", payload: null });
	expect(first).not.toHaveBeenCalled();
	expect(second).toHaveBeenCalledWith("home", null);

	fromFrame(iframe, { type: "captured", requestId, dataUrl: "data:image/png;base64,AA==" });
	await expect(pending).resolves.toBe("data:image/png;base64,AA==");

	act(() => root.unmount());
	// 卸载才真正停：之后的消息不再派发。
	fromFrame(iframe, { type: "selected", payload: null });
	expect(second).toHaveBeenCalledTimes(1);
});
