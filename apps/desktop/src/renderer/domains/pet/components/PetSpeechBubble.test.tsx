// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PET_BUBBLE_STYLES } from "../../../../shared/pet-bubbles";
import { PetSpeechBubble } from "./PetSpeechBubble";

const EXPECTED_VISUAL_INSET_PX = 40;
const EXPECTED_SURFACE_MAX_WIDTH_PX = 360;

vi.mock("../../../shared/components/pet/PetBubbleFrame", () => ({
	PetBubbleFrame: ({ children }: { children: string }) => <div>{children}</div>,
}));

describe("PetSpeechBubble", () => {
	it("renders the notice in document flow so the widget window can grow around it", () => {
		const { container } = render(
			<PetSpeechBubble
				decorUrl={undefined}
				message={{ text: "正在处理任务" }}
				styleId="default"
			/>,
		);
		const root = container.firstElementChild as HTMLElement | null;
		expect(screen.getByText("正在处理任务")).toBeTruthy();
		expect(root?.className).not.toContain("absolute");
		expect(root?.getAttribute("style") ?? "").not.toContain("50%");
	});

	it("reserves space around the bubble surface for decorations and shadow", () => {
		const { container } = render(
			<PetSpeechBubble
				decorUrl="vetta-media://bubble/decor.png"
				message={{ text: "正在处理任务" }}
				styleId="stoat_spring_festival_corner_border_set"
			/>,
		);
		const root = container.firstElementChild as HTMLElement;

		expect(root.style.boxSizing).toBe("border-box");
		expect(root.style.padding).toBe(`${EXPECTED_VISUAL_INSET_PX}px`);
		expect(root.style.maxWidth).toBe(
			`${EXPECTED_SURFACE_MAX_WIDTH_PX + EXPECTED_VISUAL_INSET_PX * 2}px`,
		);
		expect(root.style.width).toBe("max-content");
	});

	it("keeps every built-in corner decoration inside the shared visual inset", () => {
		for (const style of PET_BUBBLE_STYLES) {
			for (const corner of style.decor?.corners ?? []) {
				for (const value of Object.values(corner.position)) {
					const offset = Number.parseFloat(value ?? "0");
					if (offset < 0) expect(-offset, `${style.id}/${corner.id}`).toBeLessThanOrEqual(EXPECTED_VISUAL_INSET_PX);
				}
			}
		}
	});
});
