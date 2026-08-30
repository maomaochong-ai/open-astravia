// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AbilityDetailBlock } from "@shared/lib/api";

vi.mock("./AbilityMarkdownBody", () => ({ AbilityMarkdownBody: ({ content }: { content: string }) => <p>{content}</p> }));
vi.mock("./AbilityShowcaseList", () => ({ AbilityShowcaseList: () => <div /> }));
vi.mock("../AbilityIcon", () => ({ AbilityIcon: () => <span /> }));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@vetta/ui", async () => {
	const actual = await vi.importActual<typeof import("@vetta/ui")>("@vetta/ui");
	return {
		...actual,
		Dialog: ({ children, open }: { children?: unknown; open?: boolean }) => (open ? <div>{children as never}</div> : null),
		DialogContent: ({ children }: { children?: unknown }) => <div>{children as never}</div>,
		DialogTitle: ({ children }: { children?: unknown }) => <h2>{children as never}</h2>,
		DialogDescription: ({ children }: { children?: unknown }) => <p>{children as never}</p>,
	};
});

import { AbilityDetailBlocks } from "./AbilityDetailBlocks";
import { shouldShowHeroStill } from "./AbilityRichDetailBlocks";

afterEach(() => {
	cleanup();
});

describe("AbilityDetailBlocks", () => {
	it("renders the richer declarative blocks with accessible content", () => {
		const { container } = render(
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
		expect(container.querySelector('[data-detail-layout="cover"]')).toBeTruthy();
		expect(screen.getByText("Safe")).toBeTruthy();
		expect(screen.getByText("3")).toBeTruthy();
		expect(screen.getByText("Simple flow")).toBeTruthy();
		expect(screen.getByRole("img", { name: "Preview image" }).getAttribute("src")).toBe("https://example.com/preview.png");
		expect(screen.getByText("The workspace")).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Before" })).toBeTruthy();
		expect(screen.getByText("Focused")).toBeTruthy();
		expect(container.querySelector('[data-detail-layout="contrast"]')?.tagName).not.toBe("TABLE");
		expect(container.querySelector('[data-contrast-pane="left"]')?.getAttribute("data-contrast-tone")).toBe("neutral");
		expect(container.querySelector('[data-contrast-pane="right"]')?.getAttribute("data-contrast-tone")).toBe("accent");
		expect(container.querySelector('[data-contrast-tone="accent"]')?.className).toContain("ring-1");
		expect(container.querySelector('[data-contrast-tone="neutral"]')?.className).not.toContain("ring-1");
	});

	it("renders feature, step and callout host blocks with their copy", () => {
		render(
			<AbilityDetailBlocks
				abilityType="plugin"
				blocks={[
					{
						type: "feature-grid",
						title: "Capabilities",
						items: [{ title: "Read pages", description: "Use snapshots instead of raw HTML." }],
					},
					{
						type: "steps",
						title: "Get started",
						items: [{ title: "Install", description: "Add the plugin first." }],
					},
					{ type: "callout", tone: "warning", title: "Permissions", content: "Only grant what the task needs." },
				]}
			/>,
		);

		expect(screen.getByRole("heading", { name: "Capabilities" })).toBeTruthy();
		expect(screen.getByText("Read pages")).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Get started" })).toBeTruthy();
		expect(screen.getByText("Install")).toBeTruthy();
		expect(screen.getByText("01")).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Permissions" })).toBeTruthy();
		expect(screen.getByText("Only grant what the task needs.")).toBeTruthy();
	});

	it("shows every feature, step, stat and comparison line without requiring a click", () => {
		const { container } = render(
			<AbilityDetailBlocks
				abilityType="plugin"
				blocks={[
					{
						type: "feature-grid",
						title: "Capabilities",
						items: [
							{ title: "Read pages", description: "Use snapshots instead of raw HTML." },
							{ title: "Fill forms", description: "Type into the live page." },
						],
					},
					{
						type: "steps",
						title: "Get started",
						items: [
							{ title: "Install", description: "Add the plugin first." },
							{ title: "Grant access", description: "Open only what the task needs." },
						],
					},
					{
						type: "comparison",
						title: "Why it helps",
						left: { title: "Before", items: ["Manual"] },
						right: { title: "After", items: ["Focused"], tone: "accent" },
					},
					{
						type: "stats",
						title: "At a glance",
						items: [
							{ value: "3", label: "Steps", description: "Simple flow" },
							{ value: "1", label: "Confirm", description: "Stop before submit" },
						],
					},
				]}
			/>,
		);

		expect(screen.getByText("Use snapshots instead of raw HTML.")).toBeTruthy();
		expect(screen.getByText("Type into the live page.")).toBeTruthy();
		expect(screen.getByText("Add the plugin first.")).toBeTruthy();
		expect(screen.getByText("Open only what the task needs.")).toBeTruthy();
		expect(screen.getByText("Manual")).toBeTruthy();
		expect(screen.getByText("Focused")).toBeTruthy();
		expect(screen.getByText("Simple flow")).toBeTruthy();
		expect(screen.getByText("Stop before submit")).toBeTruthy();
		expect(screen.queryByRole("tab")).toBeNull();
		expect(screen.queryByRole("button", { name: "detail.story.stepNext" })).toBeNull();
		expect(screen.queryByRole("button", { name: "detail.story.compareBoth" })).toBeNull();

		const sequence = container.querySelector('[data-detail-layout="sequence"]');
		expect(sequence?.tagName).toBe("OL");
		expect(sequence?.className).not.toContain("auto-fill");
		expect(container.querySelector('[data-detail-layout="contrast"]')?.tagName).not.toBe("TABLE");
		expect(container.querySelector('[data-detail-layout="catalog"]')?.className).toContain("auto-fill");
		expect(container.querySelector('[data-detail-layout="claims"]')?.className).not.toContain("auto-fill");
		expect(container.querySelectorAll('[data-detail-layout="claims"] article').length).toBe(2);
		expect(container.querySelector("[data-detail-spine]")).toBeNull();
		expect(screen.queryByText("detail.story.vs")).toBeNull();
	});

	it("keeps comparison columns independent when one side is longer", () => {
		const { container } = render(
			<AbilityDetailBlocks
				abilityType="plugin"
				blocks={[
					{
						type: "comparison",
						title: "Why it helps",
						left: { title: "Before", items: ["Manual", "Scattered tabs"] },
						right: { title: "After", items: ["Focused"] },
					},
				]}
			/>,
		);

		expect(screen.getByText("Manual")).toBeTruthy();
		expect(screen.getByText("Scattered tabs")).toBeTruthy();
		expect(screen.getByText("Focused")).toBeTruthy();
		expect(container.querySelector('[data-contrast-pane="right"]')?.getAttribute("data-contrast-tone")).toBe("accent");
	});

	it("keeps every feature description visible in a long list", () => {
		render(
			<AbilityDetailBlocks
				abilityType="plugin"
				blocks={[
					{
						type: "feature-grid",
						title: "代码就是设计稿",
						items: [
							{ title: "无限画布", description: "在同一设计文档中并排组织多个真实界面画框。" },
							{ title: "选中后修改", description: "把画框或具体元素交给 Vetta。" },
							{ title: "保存即更新", description: "保存后画布自动加载最新结果。" },
							{ title: "导出与分享", description: "可导出设计分享包。" },
							{ title: "设计画廊", description: "侧边栏汇总所有带设计稿的项目。" },
						],
					},
				]}
			/>,
		);

		expect(screen.getByText("无限画布")).toBeTruthy();
		expect(screen.getByText("设计画廊")).toBeTruthy();
		expect(screen.getByText("在同一设计文档中并排组织多个真实界面画框。")).toBeTruthy();
		expect(screen.getByText("侧边栏汇总所有带设计稿的项目。")).toBeTruthy();
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

	it("does not shout author comparison titles into uppercase", () => {
		render(
			<AbilityDetailBlocks
				abilityType="plugin"
				blocks={[
					{
						type: "comparison",
						title: "Why it helps",
						left: { title: "Web search only", items: ["Results only"] },
						right: { title: "使用 Browser", items: ["Focused"], tone: "accent" },
					},
				]}
			/>,
		);

		const heading = screen.getByRole("heading", { name: "使用 Browser" });
		expect(heading.className).not.toContain("uppercase");
	});

	it("hides a hero logo that duplicates the ability icon, but keeps a scene still", () => {
		const { rerender } = render(
			<AbilityDetailBlocks
				abilityType="plugin"
				abilityIcon="vetta-plugin://browser/icon.png"
				blocks={[{ type: "hero", title: "A useful agent", image: "icon.png", image_alt: "Plugin icon" }]}
			/>,
		);
		expect(screen.queryByRole("img")).toBeNull();

		rerender(
			<AbilityDetailBlocks
				abilityType="plugin"
				abilityIcon="vetta-plugin://browser/icon.png"
				blocks={[{ type: "hero", title: "A useful agent", image: "https://example.com/preview.webp", image_alt: "Workspace" }]}
			/>,
		);
		expect(screen.getByRole("img", { name: "Workspace" }).getAttribute("src")).toBe("https://example.com/preview.webp");
	});
});

describe("shouldShowHeroStill", () => {
	it("rejects plugin logos and the same file as the ability icon", () => {
		expect(shouldShowHeroStill(undefined)).toBe(false);
		expect(shouldShowHeroStill("icon.png")).toBe(false);
		expect(shouldShowHeroStill("logo.svg")).toBe(false);
		expect(shouldShowHeroStill("vetta-plugin://browser/icon.png", "vetta-plugin://browser/icon.png")).toBe(false);
		expect(shouldShowHeroStill("https://cdn.example/preview.webp")).toBe(true);
		expect(shouldShowHeroStill("presentation/screenshot.png", "vetta-plugin://browser/icon.png")).toBe(true);
	});
});
