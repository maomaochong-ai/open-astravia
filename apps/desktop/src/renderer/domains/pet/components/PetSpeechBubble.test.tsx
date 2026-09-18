// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PetSpeechBubble } from "./PetSpeechBubble";

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
});
