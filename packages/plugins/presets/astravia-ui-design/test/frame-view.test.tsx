/**
 * 画框外壳：标题栏限宽、选中时的尺寸标签、还没画出来时的启动占位。
 *
 * 标题栏的宽度上限——缩小画布时相邻 frame 在屏幕上会靠得很近，标题不限宽就会横着
 * 叠到隔壁去（Figma 的做法是裁到 frame 自身宽度、超出的用省略号）。上限写在内联
 * style 里、用 --astd-lscale 换算，缩放时不重渲染，所以这里断言的就是那条 calc。
 */
import { expect, it, vi } from "vitest";

vi.mock("@astravia-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

import { act } from "react";
import { createRoot } from "react-dom/client";
import type { BridgeHub } from "../src/canvas/bridge-client";
import { FrameView } from "../src/canvas/FrameView";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bridge = { register: () => {} } as unknown as BridgeHub;

function renderFrame(
	renaming: boolean,
	selected = false,
	raster: string | null = null,
): { host: HTMLElement; label: HTMLElement; cleanup: () => void } {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = createRoot(host);
	act(() => {
		root.render(
			<FrameView
				frame={{ id: "home", title: "Home dynamics", x: 0, y: 0, width: 390, height: 1046 }}
				port={1234}
				getZoom={() => 1}
				bridge={bridge}
				selected={selected}
				entered={false}
				interactive
				resizable={false}
				mounted={false}
				live={false}
				raster={raster}
				reloadNonce={0}
				paintTick={0}
				moveDelta={null}
				resizeRect={null}
				placement={null}
				activity={undefined}
				buildError={null}
				renaming={renaming}
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
	});
	const label = host.querySelector<HTMLElement>("[data-astd-frame] > div");
	if (!label) throw new Error("title bar not rendered");
	return {
		host,
		label,
		cleanup: () => {
			act(() => root.unmount());
			host.remove();
		},
	};
}

it("clamps the title bar to the frame width and truncates the name", () => {
	const { label, cleanup } = renderFrame(false);
	// 390px / lscale：lscale 是 1/zoom，乘回缩放后正好是 frame 自身的宽度。
	expect(label.style.maxWidth).toBe("calc(390px / var(--astd-lscale, 1))");
	const title = label.querySelector("button");
	expect(title?.className).toContain("truncate");
	// flex item 的 min-width 默认是 auto，不归零 truncate 不会生效。
	expect(title?.className).toContain("min-w-0");
	cleanup();
});

it("drops the clamp while renaming so the input is not cut off", () => {
	const { label, cleanup } = renderFrame(true);
	expect(label.style.maxWidth).toBe("");
	cleanup();
});

it("shows the size badge only while selected, under the frame", () => {
	const idle = renderFrame(false);
	expect(idle.host.textContent).not.toContain("390×1046");
	idle.cleanup();

	const active = renderFrame(false, true);
	const badge = [...active.host.querySelectorAll<HTMLElement>("div")].find(
		(node) => node.textContent === "390×1046",
	);
	expect(badge).toBeDefined();
	expect(badge?.className).toContain("bg-primary");
	// frame 底边下方、水平居中，且跟着 --astd-lscale 反向缩放。
	expect(badge?.style.top).toBe("100%");
	expect(badge?.style.transform).toBe("translateX(-50%) scale(var(--astd-lscale, 1))");
	active.cleanup();
});

it("covers a frame that has nothing painted yet with the loading overlay", () => {
	const pending = renderFrame(false);
	// 通用 spinner 换成了活动态同款的流体 + 头像（见 FrameLoadingOverlay）。
	expect(pending.host.querySelector(".astd-fluid")).not.toBeNull();
	expect(pending.host.querySelector(".astd-bot-think")).not.toBeNull();
	pending.cleanup();

	// 有位图就说明这一帧已经画得出来了，占位不该再出现（位图自己盖在上面）。
	const painted = renderFrame(false, false, "data:image/png;base64,AAAA");
	expect(painted.host.querySelector(".astd-fluid")).toBeNull();
	painted.cleanup();
});
