// @vitest-environment jsdom
/**
 * 新会话页的工作模式 toggle：它是全 App 唯一的模式入口，写的是「新会话默认模式」
 * （desktop-config 的 defaultAgentMode），不是某个会话的当前模式。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

import { Provider, createStore } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { defaultAgentModeAtom } from "@shared/store/atoms";
import { AgentModeIconToggle } from "./AgentModeIconToggle";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface ConfigStub {
	defaultAgentMode?: string;
	/** 旧字段名：断言 renderer 不再读它。 */
	agentMode?: string;
}

let container: HTMLDivElement;
let root: Root;
const setGlobalAgentMode = vi.fn(async () => undefined);
let agentModeListener: ((mode: "work" | "coding") => void) | undefined;

function mountWithConfig(config: ConfigStub): { store: ReturnType<typeof createStore> } {
	(globalThis as unknown as { window: unknown }).window = globalThis.window;
	Object.assign(globalThis.window, {
		vetta: {
			config: { get: async () => config },
			session: {
				setGlobalAgentMode,
				onAgentModeChanged: (handler: (mode: "work" | "coding") => void) => {
					agentModeListener = handler;
					return () => {
						agentModeListener = undefined;
					};
				},
			},
		},
	});
	const store = createStore();
	act(() => {
		root.render(
			<Provider store={store}>
				<AgentModeIconToggle />
			</Provider>,
		);
	});
	return { store };
}

function buttonFor(mode: string): HTMLButtonElement {
	const button = container.querySelector<HTMLButtonElement>(`button[aria-label="agentMode.${mode}"]`);
	if (!button) throw new Error(`missing toggle button for ${mode}`);
	return button;
}

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	setGlobalAgentMode.mockClear();
	agentModeListener = undefined;
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

it("hydrates from desktop-config defaultAgentMode", async () => {
	// 旧实现读的是 config.agentMode；这里刻意把两个字段设成相反值，读错字段就会翻。
	mountWithConfig({ defaultAgentMode: "coding", agentMode: "work" });
	await act(async () => {
		await Promise.resolve();
	});

	expect(buttonFor("coding").getAttribute("aria-pressed")).toBe("true");
	expect(buttonFor("work").getAttribute("aria-pressed")).toBe("false");
});

it("writes the new-session default when a mode is picked", async () => {
	const { store } = mountWithConfig({ defaultAgentMode: "work" });
	await act(async () => {
		await Promise.resolve();
	});

	await act(async () => {
		buttonFor("coding").click();
	});

	expect(setGlobalAgentMode).toHaveBeenCalledWith("coding");
	expect(store.get(defaultAgentModeAtom)).toBe("coding");
});

it("follows the main-process broadcast so every window shows the same default", async () => {
	const { store } = mountWithConfig({ defaultAgentMode: "work" });
	await act(async () => {
		await Promise.resolve();
	});

	await act(async () => {
		agentModeListener?.("coding");
	});

	expect(store.get(defaultAgentModeAtom)).toBe("coding");
	expect(setGlobalAgentMode).not.toHaveBeenCalled();
});
