// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageEditWorkspace } from "../src/image-edit/ImageEditWorkspace";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@vetta/ui", () => ({
	Button: ({ children, ...props }: ComponentProps<"button">) => <button {...props}>{children}</button>,
}));

describe("ImageEditWorkspace", () => {
	afterEach(() => cleanup());

	it("creates a normalized region, supports undo, and applies the document", () => {
		const onApply = vi.fn();
		const canvas = render(
			<ImageEditWorkspace imageUrl="data:image/png;base64,AAAA" regions={[]} onApply={onApply} onClose={vi.fn()} />,
		).getByTestId("image-edit-canvas");
		vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
			left: 10,
			top: 20,
			width: 100,
			height: 100,
			right: 110,
			bottom: 120,
			x: 10,
			y: 20,
			toJSON: () => ({}),
		});

		firePointer(canvas, "pointerdown", 20, 30);
		firePointer(canvas, "pointermove", 70, 80);
		firePointer(canvas, "pointerup", 70, 80);
		const undoButton = screen.getByRole<HTMLButtonElement>("button", { name: "imageEdit.undo" });
		expect(undoButton.disabled).toBe(false);
		fireEvent.click(undoButton);
		expect(undoButton.disabled).toBe(true);

		firePointer(canvas, "pointerdown", 20, 30);
		firePointer(canvas, "pointermove", 70, 80);
		firePointer(canvas, "pointerup", 70, 80);
		fireEvent.click(screen.getByRole("button", { name: "imageEdit.apply" }));
		expect(onApply).toHaveBeenCalledWith([
			expect.objectContaining({
				kind: "rectangle",
				bounds: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
			}),
		]);
	});

	it("closes the user editor when Escape is pressed", () => {
		const onClose = vi.fn();
		render(
			<ImageEditWorkspace imageUrl="data:image/png;base64,AAAA" regions={[]} onApply={vi.fn()} onClose={onClose} />,
		);

		fireEvent.keyDown(window, { key: "Escape" });

		expect(onClose).toHaveBeenCalledOnce();
	});
});

function firePointer(target: Element, type: string, clientX: number, clientY: number): void {
	fireEvent(target, new MouseEvent(type, { bubbles: true, clientX, clientY }));
}
