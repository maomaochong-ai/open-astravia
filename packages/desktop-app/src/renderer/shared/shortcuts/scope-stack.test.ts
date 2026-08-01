import { afterEach, describe, expect, test, vi } from "vitest";
import { matchesShortcut } from "../lib/platform";
import { __setShortcutScopeStackForTests, ShortcutScopeStack } from "./scope-stack";

function fakeKeyEvent(key: string): KeyboardEvent {
	// Minimal stand-in for node vitest (no jsdom).
	const event = {
		key,
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		defaultPrevented: false,
		target: null,
		preventDefault() {
			this.defaultPrevented = true;
		},
		stopPropagation() {},
	};
	return event as unknown as KeyboardEvent;
}

describe("ShortcutScopeStack", () => {
	afterEach(() => {
		__setShortcutScopeStackForTests(null);
	});

	test("higher kind wins over lower kind", () => {
		const stack = new ShortcutScopeStack();
		const appRun = vi.fn();
		const surfaceRun = vi.fn();
		stack.register({
			id: "app",
			kind: "app",
			getBindings: () => [{ key: "escape", run: appRun }],
		});
		stack.register({
			id: "surface",
			kind: "surface",
			getBindings: () => [{ key: "escape", run: surfaceRun }],
		});
		stack.handleKeyDownForTests(fakeKeyEvent("Escape"));
		expect(surfaceRun).toHaveBeenCalledOnce();
		expect(appRun).not.toHaveBeenCalled();
	});

	test("later registration wins within same kind", () => {
		const stack = new ShortcutScopeStack();
		const first = vi.fn();
		const second = vi.fn();
		stack.register({
			id: "a",
			kind: "overlay",
			getBindings: () => [{ key: "escape", run: first }],
		});
		stack.register({
			id: "b",
			kind: "overlay",
			getBindings: () => [{ key: "escape", run: second }],
		});
		stack.handleKeyDownForTests(fakeKeyEvent("Escape"));
		expect(second).toHaveBeenCalledOnce();
		expect(first).not.toHaveBeenCalled();
	});

	test("exclusive scope blocks fallthrough when unmatched", () => {
		const stack = new ShortcutScopeStack();
		const appRun = vi.fn();
		stack.register({
			id: "app",
			kind: "app",
			getBindings: () => [{ key: "escape", run: appRun }],
		});
		stack.register({
			id: "modal",
			kind: "modal",
			exclusive: true,
			getBindings: () => [{ key: "enter", run: vi.fn() }],
		});
		stack.handleKeyDownForTests(fakeKeyEvent("Escape"));
		expect(appRun).not.toHaveBeenCalled();
	});

	test("dispose removes scope", () => {
		const stack = new ShortcutScopeStack();
		const run = vi.fn();
		const handle = stack.register({
			id: "s",
			kind: "surface",
			getBindings: () => [{ key: "escape", run }],
		});
		handle.dispose();
		stack.handleKeyDownForTests(fakeKeyEvent("Escape"));
		expect(run).not.toHaveBeenCalled();
	});

	test("matchesShortcut understands arrow keys", () => {
		const event = fakeKeyEvent("ArrowLeft");
		expect(matchesShortcut(event, "arrowleft")).toBe(true);
		expect(matchesShortcut(event, "arrowright")).toBe(false);
	});
});
