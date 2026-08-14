// @vitest-environment jsdom
/**
 * narration 能力位的查表合同（ADR-0071）：渲染层按注册表判定叙事方式，不硬编码 mode id。
 * 回退语义是合同的一部分：未指定模式 / 未知模式 / 注册表未加载 → "staged"，
 * 与历史会话缺模式记录时按 work 恢复的口径一致。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { __resetAgentModeRegistryForTests, useAgentModeNarration } from "./agent-mode-registry";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REGISTRY = [
	{ id: "work", label: "Work", description: "", icon: "i", narration: "staged" },
	{ id: "coding", label: "Coding", description: "", icon: "i", narration: "inline" },
];

let container: HTMLDivElement;
let root: Root;
let rendered: string | undefined;

function Probe({ modeId }: { modeId: string | null }): null {
	rendered = useAgentModeNarration(modeId);
	return null;
}

async function mount(modeId: string | null): Promise<void> {
	await act(async () => {
		root.render(<Probe modeId={modeId} />);
		await Promise.resolve();
	});
}

beforeEach(() => {
	__resetAgentModeRegistryForTests();
	(globalThis as unknown as { window: unknown }).window = globalThis.window;
	Object.assign(globalThis.window, {
		vetta: { session: { getAgentModes: async () => REGISTRY } },
	});
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	rendered = undefined;
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

it("按注册表返回各模式的 narration", async () => {
	await mount("coding");
	expect(rendered).toBe("inline");
	await mount("work");
	expect(rendered).toBe("staged");
});

it("未指定 / 未知模式回退 staged（与历史会话按 work 恢复口径一致）", async () => {
	await mount(null);
	expect(rendered).toBe("staged");
	await mount("not-a-mode");
	expect(rendered).toBe("staged");
});

it("注册表拉取失败保持回退值，不抛错", async () => {
	__resetAgentModeRegistryForTests();
	Object.assign(globalThis.window, {
		vetta: {
			session: {
				getAgentModes: async () => {
					throw new Error("ipc down");
				},
			},
		},
	});
	await mount("coding");
	expect(rendered).toBe("staged");
});
