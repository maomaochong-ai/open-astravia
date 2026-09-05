// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AbilitiesModel, AbilityItem } from "../../types";

let animationEnd: ((open: boolean) => void) | undefined;
let latestOverlayClassName: string | undefined;

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("./ability-detail-modal-guard", () => ({
	shouldCloseAbilityDetailDrawer: () => true,
}));
vi.mock("./loadAbilityDetailView", () => ({
	loadAbilityDetailView: () => new Promise(() => undefined),
}));
vi.mock("@vetta/ui", () => {
	type DrawerProps = {
		children: ReactNode;
		open: boolean;
		onAnimationEnd?: (open: boolean) => void;
	};
	return {
		Drawer: ({ children, open, onAnimationEnd }: DrawerProps) => {
			animationEnd = onAnimationEnd;
			return <div data-testid="drawer" data-open={String(open)}>{children}</div>;
		},
		DrawerContent: ({ children, overlayClassName }: { children: ReactNode; overlayClassName?: string }) => {
			latestOverlayClassName = overlayClassName;
			return <div>{children}</div>;
		},
		DrawerDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
		DrawerTitle: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
	};
});

const { AbilityDetailSheet } = await import("./AbilityDetailSheet.js");

function createItem(): AbilityItem {
	return {
		type: "skill",
		id: "skill:demo",
		slug: "demo",
		title: "Demo",
		description: "Description",
		icon: "",
		tags: [],
	} as unknown as AbilityItem;
}

describe("AbilityDetailSheet loading lifecycle", () => {
	beforeEach(() => {
		cleanup();
		vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
		animationEnd = undefined;
		latestOverlayClassName = undefined;
	});

	it("先显示抽屉壳和基础信息，再等待详情正文", () => {
		const item = createItem();
		const model = { findById: () => item, loading: false } as unknown as AbilitiesModel;
		render(<AbilityDetailSheet detailId={item.id} model={model} onClose={vi.fn()} />);

		expect(screen.getByTestId("drawer").getAttribute("data-open")).toBe("true");
		expect(latestOverlayClassName).toBeUndefined();
		expect(screen.getByRole("heading", { name: item.title })).toBeTruthy();
		expect(screen.getByText("loading")).toBeTruthy();
	});

	it("关闭时保留内容，动画结束后才通知卸载", () => {
		const item = createItem();
		const onExited = vi.fn();
		const model = { findById: () => item, loading: false } as unknown as AbilitiesModel;
		const view = render(<AbilityDetailSheet detailId={item.id} model={model} onClose={vi.fn()} onExited={onExited} />);

		view.rerender(<AbilityDetailSheet detailId={null} model={model} onClose={vi.fn()} onExited={onExited} />);
		expect(screen.getByTestId("drawer").getAttribute("data-open")).toBe("false");
		expect(latestOverlayClassName).toBe("!pointer-events-none");
		expect(screen.getByRole("heading", { name: item.title })).toBeTruthy();
		expect(onExited).not.toHaveBeenCalled();

		act(() => animationEnd?.(false));
		expect(onExited).toHaveBeenCalledOnce();
	});
});
