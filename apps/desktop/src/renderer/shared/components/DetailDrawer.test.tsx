// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let animationEnd: ((open: boolean) => void) | undefined;
let latestOverlayClassName: string | undefined;

vi.mock("@vetta/ui", () => {
	type DrawerProps = {
		children: ReactNode;
		open: boolean;
		onAnimationEnd?: (open: boolean) => void;
	};
	return {
		Drawer: ({ children, open, onAnimationEnd }: DrawerProps) => {
			animationEnd = onAnimationEnd;
			return (
				<div data-testid="drawer" data-open={String(open)}>
					{children}
				</div>
			);
		},
		DrawerContent: ({ children, overlayClassName }: { children: ReactNode; overlayClassName?: string }) => {
			latestOverlayClassName = overlayClassName;
			return <div>{children}</div>;
		},
		DrawerDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
		DrawerTitle: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
	};
});

const { DetailDrawer } = await import("@vetta/theme-ui/overlays");

/** 能力详情、智能体档案与团队设置共用这枚抽屉壳，生命周期只在这里验证一次。 */
describe("DetailDrawer", () => {
	beforeEach(() => {
		cleanup();
		vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
		animationEnd = undefined;
		latestOverlayClassName = undefined;
	});

	it("先提交抽屉壳与读屏标题，遮罩保持可交互", () => {
		render(
			<DetailDrawer open title="Demo" description="Description" onClose={vi.fn()}>
				<p>body</p>
			</DetailDrawer>,
		);

		expect(screen.getByTestId("drawer").getAttribute("data-open")).toBe("true");
		expect(latestOverlayClassName).toBeUndefined();
		expect(screen.getByRole("heading", { name: "Demo" })).toBeTruthy();
		expect(screen.getByText("body")).toBeTruthy();
	});

	it("关闭时立即让出遮罩并保留内容，退出动画结束后才通知卸载", () => {
		const onExited = vi.fn();
		const view = render(
			<DetailDrawer open title="Demo" onClose={vi.fn()} onExited={onExited}>
				<p>body</p>
			</DetailDrawer>,
		);

		view.rerender(
			<DetailDrawer open={false} title="Demo" onClose={vi.fn()} onExited={onExited}>
				<p>body</p>
			</DetailDrawer>,
		);
		expect(screen.getByTestId("drawer").getAttribute("data-open")).toBe("false");
		expect(latestOverlayClassName).toBe("!pointer-events-none");
		expect(screen.getByText("body")).toBeTruthy();
		expect(onExited).not.toHaveBeenCalled();

		act(() => animationEnd?.(false));
		expect(onExited).toHaveBeenCalledOnce();
	});
});
