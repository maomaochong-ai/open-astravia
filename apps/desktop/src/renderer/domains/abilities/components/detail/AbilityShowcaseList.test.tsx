// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AbilityShowcase } from "@shared/lib/api";

vi.mock("@vetta/theme-ui/shared", () => ({
	BotAvatar: () => <span data-testid="bot-avatar" />,
}));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

import { AbilityShowcaseList } from "./AbilityShowcaseList";

const prompt = "整理本月订单";
const reply = "我会先读取页面再汇总。";

function showcase(template: AbilityShowcase["template"], canvas?: AbilityShowcase["canvas"]): AbilityShowcase {
	return { template, canvas, user_prompt: prompt, assistant_reply: reply };
}

describe("AbilityShowcaseList", () => {
	it("renders each host template with a distinct layout landmark", () => {
		render(
			<AbilityShowcaseList
				showcases={[
					showcase("chat-over-canvas", "code"),
					showcase("chat-thread"),
					showcase("canvas-hero", "design"),
					showcase("prompt-result", "board"),
					showcase("spotlight"),
					showcase("workbench", "browser"),
				]}
			/>,
		);

		expect(screen.getByLabelText("ability-showcase-chat-over-canvas")).toBeTruthy();
		expect(screen.getByLabelText("ability-showcase-chat-thread")).toBeTruthy();
		expect(screen.getByLabelText("ability-showcase-canvas-hero")).toBeTruthy();
		expect(screen.getByLabelText("ability-showcase-prompt-result")).toBeTruthy();
		expect(screen.getByLabelText("ability-showcase-spotlight")).toBeTruthy();
		expect(screen.getByLabelText("ability-showcase-workbench")).toBeTruthy();
		expect(screen.getAllByText(prompt)).toHaveLength(6);
		expect(screen.getAllByText(reply)).toHaveLength(6);
	});

	it("keeps split templates on one row instead of stacking the canvas under the copy", () => {
		for (const template of ["chat-over-canvas", "prompt-result", "workbench"] as const) {
			const { container, unmount } = render(
				<AbilityShowcaseList showcases={[showcase(template, "browser")]} />,
			);
			const row = container.querySelector("[data-showcase-layout='split']");
			expect(row, template).toBeTruthy();
			expect(row?.className, template).toContain("grid-cols-");
			expect(row?.className, template).not.toContain("flex-col");
			unmount();
		}
	});

	it("skips unknown templates so newer marketplace payloads do not crash older clients", () => {
		const { container } = render(
			<AbilityShowcaseList
				showcases={[
					{ template: "not-a-template", user_prompt: prompt, assistant_reply: reply } as unknown as AbilityShowcase,
					showcase("canvas-hero", "terminal"),
				]}
			/>,
		);

		expect(container.querySelector('[aria-label="ability-showcase-chat-over-canvas"]')).toBeNull();
		expect(container.querySelector('[aria-label="ability-showcase-canvas-hero"]')).toBeTruthy();
		expect(container.querySelectorAll("section")).toHaveLength(1);
	});
});
