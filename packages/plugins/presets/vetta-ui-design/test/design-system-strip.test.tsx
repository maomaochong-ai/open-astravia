import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({
		t: (key: string, params?: Record<string, string>) =>
			params ? `${key}:${Object.values(params).join(",")}` : key,
		locale: "zh",
	}),
}));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DesignSystemStrip } from "../src/gallery/DesignSystemStrip";
import { buildStyleStartDraft, designNameForSystem } from "../src/gallery/start-from-system";
import { resetDesignSystems, setDesignSystems } from "../src/design-systems/registry";
import type { DesignSystem } from "../src/design-systems/types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function system(id: string, name: string): DesignSystem {
	return {
		id,
		name,
		category: "dev",
		vibe: "dark",
		blurb: "blurb",
		themeCss: "@theme { --color-primary: #000; }",
		designMd: `# ${name}`,
	};
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
	setDesignSystems([system("linear", "Linear"), system("stripe", "Stripe")]);
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	document.body.innerHTML = "";
	resetDesignSystems();
});

function render(node: React.ReactNode): void {
	act(() => root.render(node));
}

function tiles(): HTMLButtonElement[] {
	return [...document.body.querySelectorAll<HTMLButtonElement>("button[aria-label]")];
}

describe("DesignSystemStrip", () => {
	it("两种形态都列出当前生效的全部风格", () => {
		for (const variant of ["hero", "strip"] as const) {
			render(<DesignSystemStrip variant={variant} busy={false} onPick={() => {}} />);
			expect(tiles()).toHaveLength(2);
			expect(document.body.textContent).toContain("Linear");
			expect(document.body.textContent).toContain("Stripe");
		}
	});

	it("点一张卡把对应的体系交回去", () => {
		const picked: string[] = [];
		render(<DesignSystemStrip variant="hero" busy={false} onPick={(s) => picked.push(s.id)} />);
		act(() => {
			tiles()[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(picked).toEqual(["stripe"]);
	});

	it("busy 时禁用，避免重复建项目", () => {
		const picked: string[] = [];
		render(<DesignSystemStrip variant="strip" busy onPick={(s) => picked.push(s.id)} />);
		expect(tiles().every((tile) => tile.disabled)).toBe(true);
		act(() => {
			tiles()[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(picked).toEqual([]);
	});

	it("每张卡都有可读的无障碍名称", () => {
		render(<DesignSystemStrip variant="hero" busy={false} onPick={() => {}} />);
		expect(tiles().map((tile) => tile.getAttribute("aria-label"))).toEqual([
			"gallery.styles.start:Linear",
			"gallery.styles.start:Stripe",
		]);
	});
});

describe("从风格开新设计的文案", () => {
	it("项目名用体系名", () => {
		expect(designNameForSystem(system("retro-95", "Retro 95"))).toBe("Retro 95");
	});

	it("草稿带 skill badge 和体系名，跟宿主语言走", () => {
		const zh = buildStyleStartDraft(system("linear", "Linear"), "zh-CN");
		expect(zh).toContain("@skill:vetta-ui-design ");
		expect(zh).toContain("Linear");
		expect(zh).toContain("DESIGN.md");

		const en = buildStyleStartDraft(system("linear", "Linear"), "en");
		expect(en).toContain("@skill:vetta-ui-design ");
		expect(en).toContain('"Linear" system');
	});
});
