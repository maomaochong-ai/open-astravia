/**
 * 位图 → 活体的交接时机。
 *
 * 复现的 bug：选中一个画框时闪一下白（有时连闪）。paintTick 来自 iframe 自己的渲染
 * 进程（engine 的 FramePainted），父进程此刻还没拿到跨源子帧的合成面；位图一收到信号
 * 就开始淡出，中间那一两帧露出的是容器白底。是竞态，所以时有时无。
 */
import { expect, it, vi } from "vitest";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { BridgeHub } from "../src/canvas/bridge-client";
import { FrameView } from "../src/canvas/FrameView";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bridge = { register: () => {} } as unknown as BridgeHub;

/** 手动驱动的 rAF：交接押的那两帧要能一帧一帧地检查。 */
let rafQueue: Array<() => void> = [];

function installRaf(): void {
	rafQueue = [];
	vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
		rafQueue.push(callback);
		return rafQueue.length;
	});
	vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
		if (rafQueue[handle - 1]) rafQueue[handle - 1] = () => {};
	});
}

/** 走完一帧：只跑当前排队的回调，它们新排的留给下一帧。 */
async function paintFrame(): Promise<void> {
	const due = rafQueue;
	rafQueue = [];
	await act(async () => {
		for (const callback of due) callback();
	});
}

interface Scene {
	live: boolean;
	paintTick: number;
	mounted?: boolean;
}

function mountFrame(scene: Scene): { host: HTMLElement; update(next: Scene): Promise<void>; cleanup(): void } {
	const host = document.createElement("div");
	document.body.appendChild(host);
	let root: Root | null = null;
	const draw = (current: Scene): void => {
		root?.render(
			<FrameView
				frame={{ id: "home", title: "Home", x: 0, y: 0, width: 390, height: 844 }}
				port={5173}
				getZoom={() => 1}
				bridge={bridge}
				selected
				entered={false}
				interactive
				resizable={false}
				mounted={current.mounted ?? true}
				live={current.live}
				raster="data:image/jpeg;base64,shot"
				reloadNonce={0}
				paintTick={current.paintTick}
				moveDelta={null}
				resizeRect={null}
				placement={null}
				activity={undefined}
				buildError={null}
				renaming={false}
				onSelect={() => {}}
				onContextMenu={() => {}}
				onRenameStart={() => {}}
				onRenameCommit={() => {}}
				onRenameCancel={() => {}}
				onDragStart={() => {}}
				onDragDelta={() => {}}
				onDragEnd={() => {}}
			/>,
		);
	};
	act(() => {
		root = createRoot(host);
		draw(scene);
	});
	return {
		host,
		update: async (next: Scene) => {
			await act(async () => draw(next));
		},
		cleanup: () => {
			act(() => root?.unmount());
			host.remove();
			vi.unstubAllGlobals();
		},
	};
}

/** 位图此刻是否还盖着（opacity 1 = 盖着）。 */
function rasterCovers(host: HTMLElement): boolean {
	const img = host.querySelector("img");
	if (!img) throw new Error("raster not rendered");
	return img.style.opacity === "1";
}

it("收到画好的信号后仍多盖两帧，等跨源子帧的合成面提交上来", async () => {
	installRaf();
	const scene = mountFrame({ live: true, paintTick: 0 });
	try {
		expect(rasterCovers(scene.host)).toBe(true);

		// 引擎报「我画完了」——父进程这时候还没拿到子帧的画面，位图不许撤。
		await scene.update({ live: true, paintTick: 1 });
		expect(rasterCovers(scene.host)).toBe(true);

		await paintFrame();
		expect(rasterCovers(scene.host)).toBe(true);

		// 两帧之后才交接。
		await paintFrame();
		expect(rasterCovers(scene.host)).toBe(false);
	} finally {
		scene.cleanup();
	}
});

/**
 * iframe 还挂着、只是被收起来（display:none）的画框重新变活体时没有新的 paintTick——
 * 交接条件里只看 loaded 的话会当场撤掉位图，白闪照旧。
 */
it("iframe 从收起状态重新变活体时，位图同样要盖住这两帧", async () => {
	installRaf();
	// 基线是挂载那一刻的计数，所以要真的自增一次才算「这次挂载后画出来了」。
	const scene = mountFrame({ live: true, paintTick: 0 });
	try {
		await scene.update({ live: true, paintTick: 1 });
		await paintFrame();
		await paintFrame();
		expect(rasterCovers(scene.host)).toBe(false);

		// 取消选中：活体当场收起，位图硬切回来（这个方向本来就该是硬切）。
		await scene.update({ live: false, paintTick: 1 });
		expect(rasterCovers(scene.host)).toBe(true);

		// 再次选中：paintTick 不会再动，位图必须自己撑过这两帧。
		await scene.update({ live: true, paintTick: 1 });
		expect(rasterCovers(scene.host)).toBe(true);
		await paintFrame();
		expect(rasterCovers(scene.host)).toBe(true);
		await paintFrame();
		expect(rasterCovers(scene.host)).toBe(false);
	} finally {
		scene.cleanup();
	}
});
