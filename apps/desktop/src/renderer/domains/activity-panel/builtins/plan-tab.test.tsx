// @vitest-environment jsdom
import { planModeStateBySessionAtom } from "@shared/store/atoms";
import { cleanup, render, renderHook, screen } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityPanelContextProvider } from "../registry/context";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@shared/components/RendererMarkdownContent", () => ({
	RendererMarkdownContent: ({ text }: { text: string }) => <div data-testid="markdown">{text}</div>,
}));

const { planTabDefinition } = await import("./plan-tab.js");
const store = getDefaultStore();

function wrapperFor(runtimeIds: readonly string[]) {
	return ({ children }: { children: ReactNode }) => (
		<ActivityPanelContextProvider
			value={{ workspace: { id: "workspace", cwd: null, runtimeIds: [...runtimeIds] }, knowledgeHistory: false }}
		>
			{children}
		</ActivityPanelContextProvider>
	);
}

describe("activity panel plan tab", () => {
	beforeEach(() => store.set(planModeStateBySessionAtom, {}));
	afterEach(cleanup);

	it("only appears once the session has a plan, and stays after the plan is approved", () => {
		const wrapper = wrapperFor(["runtime-1"]);
		const meta = renderHook(() => planTabDefinition.useMeta(), { wrapper });
		expect(meta.result.current).toBeNull();

		// 计划模式开着但还没提交过计划：没有内容可看，不占一个 tab。
		store.set(planModeStateBySessionAtom, { "runtime-1": { permissionMode: "plan" } });
		meta.rerender();
		expect(meta.result.current).toBeNull();

		store.set(planModeStateBySessionAtom, {
			"runtime-1": { permissionMode: "default", plan: { content: "1. Ship it", status: "approved", updatedAt: "t" } },
		});
		meta.rerender();
		expect(meta.result.current).toMatchObject({ label: "activityPanel.tabs.plan" });

		const Tab = planTabDefinition.component;
		render(<Tab />, { wrapper });
		expect(screen.getByRole("heading", { name: "activityPanel.plan.headline" })).toBeTruthy();
		expect(screen.getByTestId("markdown").textContent).toBe("1. Ship it");
		expect(screen.getByText("planMode.toolCard.approved")).toBeTruthy();
	});

	it("does not show another session's plan", () => {
		store.set(planModeStateBySessionAtom, {
			"other-runtime": { permissionMode: "plan", plan: { content: "1. Other", status: "pending-review", updatedAt: "t" } },
		});
		const meta = renderHook(() => planTabDefinition.useMeta(), { wrapper: wrapperFor(["runtime-1"]) });
		expect(meta.result.current).toBeNull();
	});
});
