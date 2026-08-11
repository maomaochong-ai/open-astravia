import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key, locale: "zh" }),
}));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TemplateGalleryDialog } from "../src/cards/TemplateGalleryDialog";
import { designSystemCategoryLabel, designSystemTagline } from "../src/design-systems/labels";
import { resetDesignSystems, setDesignSystems } from "../src/design-systems/registry";
import type { DesignSystem } from "../src/design-systems/types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function remoteSystem(overrides: Partial<DesignSystem> = {}): DesignSystem {
	return {
		id: "brand-new",
		name: "Brand New",
		category: "saas-tools",
		vibe: "dark",
		blurb: "A style that only exists on the remote catalog.",
		tagline: { en: "Fresh from the catalog", zh: "刚从清单来的" },
		resources: [],
		themeCss: "@theme { --color-primary: #123456; }",
		designMd: "# Brand New",
		...overrides,
	};
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	document.body.innerHTML = "";
	resetDesignSystems();
});

describe("远端清单到货后的 UI 行为", () => {
	it("模板 Dialog 已经打开时，新清单直接反映到宫格里", () => {
		// 没有随包内置了，初始列表得自己建。
		act(() => {
			setDesignSystems([remoteSystem({ id: "old-one", name: "Old One", tagline: undefined })]);
		});
		act(() => {
			root.render(
				<TemplateGalleryDialog onApply={() => {}} onClose={() => {}} appliedId={null} busy={false} />,
			);
		});
		expect(document.body.textContent).toContain("Old One");
		expect(document.body.textContent).not.toContain("Brand New");

		act(() => {
			setDesignSystems([remoteSystem()]);
		});

		// 订阅生效：不需要重新打开 Dialog，列表已经是远端那份。
		expect(document.body.textContent).toContain("Brand New");
		expect(document.body.textContent).not.toContain("Old One");
	});

	it("空列表被忽略，不会把已有的选择器清空", () => {
		act(() => {
			setDesignSystems([remoteSystem()]);
		});
		act(() => {
			root.render(
				<TemplateGalleryDialog onApply={() => {}} onClose={() => {}} appliedId={null} busy={false} />,
			);
		});
		act(() => {
			setDesignSystems([]);
		});
		expect(document.body.textContent).toContain("Brand New");
	});
});

describe("远端条目的展示文案", () => {
	const t = (key: string) => key;

	it("标语用条目自带的译文，按 locale 选语言", () => {
		const system = remoteSystem();
		expect(designSystemTagline(system, "zh", t)).toBe("刚从清单来的");
		expect(designSystemTagline(system, "en", t)).toBe("Fresh from the catalog");
		expect(designSystemTagline(system, undefined, t)).toBe("Fresh from the catalog");
	});

	it("内置体系没有自带标语时回落到 i18n，查不到译文也不显示裸 key", () => {
		const system = remoteSystem({ tagline: undefined });
		expect(designSystemTagline(system, "zh", t)).toBe(system.blurb);
	});

	it("locales 里没有的分类显示可读形式，而不是 ds.category.xxx", () => {
		expect(designSystemCategoryLabel(remoteSystem(), t)).toBe("Saas tools");
		expect(designSystemCategoryLabel(remoteSystem({ category: "dev" }), (key) => (key === "ds.category.dev" ? "开发者工具" : key))).toBe(
			"开发者工具",
		);
	});
});
