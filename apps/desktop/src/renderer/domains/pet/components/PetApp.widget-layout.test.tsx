// @vitest-environment jsdom

import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PetCommand } from "../../../../shared/pet-ipc";
import { PetApp } from "./PetApp";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { exists: () => true } }),
}));

class FakeResizeObserver {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

describe("PetApp widget layout", () => {
	beforeEach(() => {
		vi.stubGlobal("ResizeObserver", FakeResizeObserver);
		window.history.replaceState({}, "", "/");
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		delete window.vettaPet;
	});

	function installPetBridge(): { dispatch: (command: PetCommand) => void } {
		let handler: ((command: PetCommand) => void) | undefined;
		window.vettaPet = {
			onCommand: (listener) => {
				handler = listener;
				return () => {
					handler = undefined;
				};
			},
			resizeByWheel: async () => undefined,
			resizeVideoByWheel: async () => undefined,
			beginWindowMove: async () => undefined,
			moveWindow: async () => undefined,
			endWindowMove: async () => undefined,
			beginWindowResize: async () => undefined,
			setWindowSize: async () => undefined,
			setContentSize: async () => undefined,
			endWindowResize: async () => undefined,
			setVideoBaseSize: async () => undefined,
			setMousePassthrough: async () => undefined,
			setVideoHitbox: async () => undefined,
		};
		return {
			dispatch: (command) => {
				handler?.(command);
			},
		};
	}

	it("shifts the sprite inside the window when the main process asks for a horizontal content offset", () => {
		const bridge = installPetBridge();
		const { getByTestId } = render(<PetApp />);
		const slot = getByTestId("pet-video-slot");
		expect(slot.style.transform).toBe("");

		act(() => bridge.dispatch({ type: "set-content-offset", x: 46, y: 1 }));
		expect(slot.style.transform).toBe("translateX(46px)");

		act(() => bridge.dispatch({ type: "set-content-offset", x: 0, y: 1 }));
		expect(slot.style.transform).toBe("");
	});

	it("shrink-wraps to the sprite instead of covering the desktop", () => {
		const { container } = render(<PetApp />);
		const root = container.firstElementChild as HTMLElement | null;
		expect(root?.className).toContain("inline-flex");
		expect(root?.className).toContain("flex-col");
		expect(root?.className).not.toContain("fixed");
		expect(root?.className).not.toContain("inset-0");
	});

	it("applies session state even when idle auto switching is disabled", () => {
		window.history.replaceState({}, "", "?autoMode=false");
		const bridge = installPetBridge();
		const { container } = render(<PetApp />);
		const root = container.firstElementChild as HTMLElement;

		expect(root.dataset.state).toBe("idle");
		act(() =>
			bridge.dispatch({
				type: "set-state",
				state: "working",
				actionId: "stoat_work_laptop_typing_desk_cushion",
			}),
		);

		expect(root.dataset.state).toBe("working");
	});
});
