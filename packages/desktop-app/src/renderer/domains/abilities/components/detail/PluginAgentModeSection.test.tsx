// @vitest-environment jsdom
/**
 * 插件详情页的 agent_mode 区块：模式已不再过滤插件，这里只能表达「偏好」，
 * 不得再出现「其它模式下没有入口」这类与实际行为不符的说明。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginAbility } from "../../types";
import { PluginAgentModeSection } from "./PluginAgentModeSection";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function makeItem(overrides: Partial<PluginAbility>): PluginAbility {
	return {
		agentModes: [],
		plugin: { id: "demo" },
		...overrides,
	} as unknown as PluginAbility;
}

function render(item: PluginAbility): void {
	act(() => {
		root.render(<PluginAgentModeSection item={item} />);
	});
}

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

it("shows the declared modes as a preference, not an availability whitelist", () => {
	render(makeItem({ agentModes: ["coding"] }));

	const text = container.textContent ?? "";
	expect(text).toContain("plugin.agentMode.coding");
	expect(text).toContain("plugin.agentMode.hint");
	// 旧文案键（「其它模式下没有入口」）必须消失。
	expect(text).not.toContain("plugin.agentMode.hintAll");
	expect(text).not.toContain("plugin.agentMode.all");
});

it("says there is no declared preference when agent_mode is empty", () => {
	render(makeItem({ agentModes: [] }));

	const text = container.textContent ?? "";
	expect(text).toContain("plugin.agentMode.none");
	expect(text).toContain("plugin.agentMode.hintNone");
});

it("does not warn about the current mode anymore", () => {
	render(makeItem({ agentModes: ["coding"] }));

	// 之前会给「与当前模式不符」的条目加 amber 警示；模式不再决定可用性，警示必须消失。
	expect(container.querySelector(".text-amber-500")).toBeNull();
});

it("renders nothing for market entries that are not installed", () => {
	render(makeItem({ plugin: null }));

	expect(container.textContent).toBe("");
});
