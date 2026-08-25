// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginAiChatRequest, PluginAiChatResult, PluginContext } from "@vetta-org/plugin-sdk";

vi.mock("@vetta-org/plugin-sdk", async () => {
	const actual = await vi.importActual<Record<string, unknown>>("@vetta-org/plugin-sdk");
	return {
		...actual,
		definePlugin: (definition: unknown) => definition,
		useTranslation: () => ({ t: (key: string) => key }),
	};
});

import plugin from "../src/index";

interface RegisteredView {
	id: string;
	component: ComponentType<{ pluginId: string; viewId: string }>;
}

/** Minimal host context: only what activate() actually touches. */
function fakeContext(storage = new Map<string, unknown>()) {
	const registered: RegisteredView[] = [];
	const ctx = {
		storage: {
			readJson: async (key: string) => storage.get(key) ?? null,
			writeJson: async (key: string, value: unknown) => {
				storage.set(key, JSON.parse(JSON.stringify(value)));
			},
		},
		ai: {
			listModels: async () => ({ defaultModel: null, models: [] }),
			chat: async (_request: PluginAiChatRequest): Promise<PluginAiChatResult> => ({
				modelKey: "test/model",
				text: "",
				toolCalls: [],
				stopReason: "stop",
				usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
			}),
		},
		ui: {
			notify: () => {},
			registerWorkspaceView: (contribution: RegisteredView) => {
				registered.push(contribution);
				return { dispose: () => {} };
			},
		},
	} as unknown as PluginContext;
	return { ctx, registered, storage };
}

function activate(): RegisteredView {
	const { ctx, registered } = fakeContext();
	(plugin as { activate: (ctx: PluginContext) => void }).activate(ctx);
	const view = registered[0];
	if (!view) throw new Error("no workspace view registered");
	return view;
}

afterEach(cleanup);

describe("plugin activation", () => {
	it("registers the board workspace view without declaring an icon", () => {
		const { ctx, registered } = fakeContext();
		(plugin as { activate: (ctx: PluginContext) => void }).activate(ctx);
		expect(registered).toHaveLength(1);
		expect(registered[0]?.id).toBe("board");
		// Falls back to the plugin's own plugin.json logo.
		expect(registered[0]).not.toHaveProperty("icon");
	});

	it("exposes no deactivate hook that could tear down a newer activation", () => {
		// The host reloads plugins by activating the new instance BEFORE disposing the
		// old one. A deactivate() clearing module-level state would blank the view that
		// the new activation just registered.
		expect((plugin as { deactivate?: unknown }).deactivate).toBeUndefined();
	});

	it("keeps an earlier activation's view working after the plugin is activated again", async () => {
		const first = activate();
		const second = activate();
		expect(first.component).not.toBe(second.component);

		// Both mounted views must render their own board instead of throwing
		// "plugin is not activated" — i.e. no shared module-level runtime.
		render(<first.component pluginId="chinese-chess" viewId="board" />);
		await waitFor(() => expect(screen.getByText("newGame.title")).toBeTruthy());
		cleanup();

		render(<second.component pluginId="chinese-chess" viewId="board" />);
		await waitFor(() => expect(screen.getByText("newGame.title")).toBeTruthy());
	});

	it("gives each activation its own game state instead of a shared module singleton", async () => {
		const first = activate();
		const second = activate();
		render(
			<div>
				<div data-testid="first">
					<first.component pluginId="chinese-chess" viewId="board" />
				</div>
				<div data-testid="second">
					<second.component pluginId="chinese-chess" viewId="board" />
				</div>
			</div>,
		);
		await waitFor(() => expect(screen.getAllByText("newGame.title")).toHaveLength(2));

		// Start a game in the first view only.
		const firstPane = screen.getByTestId("first");
		fireEvent.click(within(firstPane).getByText("newGame.start"));
		await waitFor(() => expect(within(firstPane).queryByText("newGame.title")).toBeNull());

		// A shared runtime would have moved the second view onto the board too.
		expect(within(screen.getByTestId("second")).getByText("newGame.title")).toBeTruthy();
	});
});
