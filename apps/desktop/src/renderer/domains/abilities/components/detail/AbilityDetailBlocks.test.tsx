// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AbilityDetailBlock } from "@shared/lib/api";

vi.mock("./AbilityMarkdownBody", () => ({ AbilityMarkdownBody: ({ content }: { content: string }) => <p>{content}</p> }));
vi.mock("./AbilityShowcaseList", () => ({ AbilityShowcaseList: () => <div /> }));
vi.mock("../AbilityIcon", () => ({ AbilityIcon: () => <span /> }));

import { AbilityDetailBlocks } from "./AbilityDetailBlocks";

describe("AbilityDetailBlocks", () => {
	it("renders the richer declarative blocks with accessible content", () => {
		render(
			<AbilityDetailBlocks
				abilityType="plugin"
				blocks={[
					{ type: "hero", eyebrow: "PLUGIN", title: "A useful agent", description: "A short promise", badges: ["Safe"] },
					{ type: "stats", title: "At a glance", items: [{ value: "3", label: "Steps", description: "Simple flow" }] },
					{ type: "gallery", title: "Preview", items: [{ src: "https://example.com/preview.png", alt: "Preview image", caption: "The workspace" }] },
					{
						type: "comparison",
						title: "Why it helps",
						left: { title: "Before", items: ["Manual"], tone: "neutral" },
						right: { title: "After", items: ["Focused"], tone: "accent" },
					},
				]}
			/>,
		);

		expect(screen.getByRole("heading", { name: "A useful agent" })).toBeTruthy();
		expect(screen.getByText("Safe")).toBeTruthy();
		expect(screen.getByText("3")).toBeTruthy();
		expect(screen.getByRole("img", { name: "Preview image" }).getAttribute("src")).toBe("https://example.com/preview.png");
		expect(screen.getByText("The workspace")).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Before" })).toBeTruthy();
		expect(screen.getByText("Focused")).toBeTruthy();
	});

	it("skips unknown blocks instead of crashing the detail page", () => {
		render(
			<AbilityDetailBlocks
				abilityType="plugin"
				blocks={[{ type: "future-block" } as unknown as AbilityDetailBlock, { type: "markdown", content: "Still visible" }]}
			/>,
		);

		expect(screen.getByText("Still visible")).toBeTruthy();
		expect(screen.queryByText("future-block")).toBeNull();
	});
});
