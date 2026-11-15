// @vitest-environment jsdom
/**
 * 模型选择面板底栏左侧的快捷键提示。
 *
 * 它读的是设置里「打开模型选择器」的绑定，而不是写死的 `mod+p`：写死会出现「改键后提示还写着
 * 旧键」这种只有用户才会发现的错。这里用不同平台/不同绑定各渲染一次，锁住「按绑定逐段出键帽」。
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	// 提示文案只作 title，这里不关心具体译文。
	useTranslation: () => ({ t: (key: string) => key }),
}));

const { ModelSelectorShortcutHint } = await import("./ModelSelector");

afterEach(cleanup);

describe("ModelSelectorShortcutHint", () => {
	it("按绑定逐段渲染键帽，模键随平台显示", () => {
		const view = render(<ModelSelectorShortcutHint shortcut="mod+p" />);
		const caps = Array.from(view.container.querySelectorAll("kbd")).map((element) => element.textContent);
		expect(caps).toHaveLength(2);
		expect(caps[0]).toMatch(/^(⌘|Ctrl|Cmd|Mod)$/);
		expect(caps[1]).toBe("P");
	});

	it("改键之后提示跟着变，而不是仍写旧键", () => {
		const view = render(<ModelSelectorShortcutHint shortcut="mod+shift+m" />);
		const caps = Array.from(view.container.querySelectorAll("kbd")).map((element) => element.textContent);
		expect(caps).toHaveLength(3);
		expect(caps[1]).toMatch(/^(⇧|Shift)$/);
		expect(caps[2]).toBe("M");
	});

	it("整组键帽有可访问说明", () => {
		const view = render(<ModelSelectorShortcutHint shortcut="mod+p" />);
		expect(view.container.querySelector("span")?.getAttribute("title")).toBe("modelSelect.shortcutHint");
	});
});
