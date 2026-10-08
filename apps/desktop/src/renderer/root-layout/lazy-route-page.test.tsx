// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { initialRoutePaintedAtom } from "./initial-route-paint-state";
import type { ComponentType } from "react";
import { Suspense, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { lazyRoutePage } from "./lazy-route-page";

const abilitiesEvaluated = vi.hoisted(() => vi.fn());
vi.mock("../domains/abilities/components/AbilitiesPage", () => {
	abilitiesEvaluated();
	return { AbilitiesPage: () => null };
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it("loads the requested page, accepts input, then prefetches another route after paint and idle", async () => {
	vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
	const reportPaint = vi.fn();
	vi.stubGlobal("vetta", { appLifecycle: { reportRendererContentPainted: reportPaint } });
	const frames: FrameRequestCallback[] = [];
	const idle: IdleRequestCallback[] = [];
	vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => frames.push(callback));
	vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => idle.push(callback));
	vi.stubGlobal("cancelIdleCallback", vi.fn());
	let finishLoading!: (page: { default: ComponentType }) => void;
	const Page = lazyRoutePage(
		() =>
			new Promise((resolve) => {
				finishLoading = resolve;
			}),
	);
	function Composer(): JSX.Element {
		const [draft, setDraft] = useState("");
		return <input aria-label="Message" value={draft} onChange={(event) => setDraft(event.currentTarget.value)} />;
	}
	const store = createStore();
	render(
		<Provider store={store}>
			<Suspense fallback={<span>Loading route</span>}>
				<Page />
			</Suspense>
		</Provider>,
	);
	expect(screen.getByText("Loading route")).toBeTruthy();
	expect(idle).toHaveLength(0);
	expect(store.get(initialRoutePaintedAtom)).toBe(false);
	expect(reportPaint).not.toHaveBeenCalled();
	expect(abilitiesEvaluated).not.toHaveBeenCalled();
	await act(async () => finishLoading({ default: Composer }));
	fireEvent.change(screen.getByRole("textbox"), { target: { value: "Draft" } });
	expect(idle).toHaveLength(0);
	expect(store.get(initialRoutePaintedAtom)).toBe(false);
	expect(reportPaint).not.toHaveBeenCalled();
	await act(async () => {
		for (const callback of frames.splice(0)) callback(0);
	});
	expect(idle).toHaveLength(0);
	expect(store.get(initialRoutePaintedAtom)).toBe(false);
	expect(reportPaint).not.toHaveBeenCalled();
	await act(async () => {
		for (const callback of frames.splice(0)) callback(0);
	});
	expect(idle).toHaveLength(1);
	expect(store.get(initialRoutePaintedAtom)).toBe(true);
	expect(reportPaint).toHaveBeenCalledOnce();
	await act(async () => {
		idle.shift()?.({ didTimeout: false, timeRemaining: () => 50 });
		await vi.dynamicImportSettled();
	});
	expect(abilitiesEvaluated).toHaveBeenCalledOnce();
	expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("Draft");
});
