import { afterEach, describe, expect, test, vi } from "vitest";
import { __setShortcutScopeStackForTests, ShortcutScopeStack } from "../../../shared/shortcuts";
import {
	assertPluginShortcutScopeKind,
	normalizePluginShortcutBindings,
	registerPluginShortcutScopeOnHost,
} from "./plugin-shortcut-scope.js";

function fakeKeyEvent(key: string): KeyboardEvent {
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

describe("plugin shortcut scope host helpers", () => {
	afterEach(() => {
		__setShortcutScopeStackForTests(null);
	});

	test("normalizePluginShortcutBindings lowercases keys and keeps run", () => {
		const run = vi.fn();
		const bindings = normalizePluginShortcutBindings([
			{ key: " Escape ", run, when: "not-editable" },
			{ key: "=", run },
		]);
		expect(bindings.map((b) => b.key)).toEqual(["escape", "="]);
		expect(bindings[0]?.when).toBe("not-editable");
		bindings[1]?.run(fakeKeyEvent("="));
		expect(run).toHaveBeenCalledOnce();
	});

	test("normalizePluginShortcutBindings rejects empty keys", () => {
		expect(() => normalizePluginShortcutBindings([{ key: "  ", run: vi.fn() }])).toThrow(/key is required/);
	});

	test("assertPluginShortcutScopeKind rejects app", () => {
		expect(() => assertPluginShortcutScopeKind("app")).toThrow(/reserved for the host/);
		expect(assertPluginShortcutScopeKind("surface")).toBe("surface");
	});

	test("registerPluginShortcutScopeOnHost participates in host stack", () => {
		const stack = new ShortcutScopeStack();
		__setShortcutScopeStackForTests(stack);
		const run = vi.fn();
		const handle = registerPluginShortcutScopeOnHost({
			scopeId: "media-viewer:zoom",
			kind: "surface",
			getBindings: () => [{ key: "=", run }],
		});
		stack.handleKeyDownForTests(fakeKeyEvent("="));
		expect(run).toHaveBeenCalledOnce();
		handle.dispose();
		run.mockClear();
		stack.handleKeyDownForTests(fakeKeyEvent("="));
		expect(run).not.toHaveBeenCalled();
	});
});
