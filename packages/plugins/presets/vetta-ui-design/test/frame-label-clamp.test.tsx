/**
 * 标题栏的宽度上限。缩小画布时相邻 frame 在屏幕上会靠得很近，标题不限宽就会横着
 * 叠到隔壁去（Figma 的做法是裁到 frame 自身宽度、超出的用省略号）。上限写在内联
 * style 里、用 --vetd-lscale 换算，缩放时不重渲染，所以这里断言的就是那条 calc。
 */
import { expect, it, vi } from "vitest";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

import { act } from "react";
import { createRoot } from "react-dom/client";
import type { BridgeHub } from "../src/canvas/bridge-client";
import { FrameView } from "../src/canvas/FrameView";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bridge = { register: () => {} } as unknown as BridgeHub;

function renderFrame(renaming: boolean): { label: HTMLElement; cleanup: () => void } {
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
				selected={false}
				entered={false}
				interactive
				resizable={false}
				mounted={false}
				live={false}
				raster={null}
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
	const label = host.querySelector<HTMLElement>("[data-vetd-frame] > div");
	if (!label) throw new Error("title bar not rendered");
	return {
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
	expect(label.style.maxWidth).toBe("calc(390px / var(--vetd-lscale, 1))");
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
