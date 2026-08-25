// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginAiChatRequest, PluginAiChatResult } from "@vetta-org/plugin-sdk";
import { ChessStore, type GameStoragePort } from "../src/game/store";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({
		t: (key: string, values?: Record<string, string | number>) =>
			values ? `${key}:${JSON.stringify(values)}` : key,
	}),
}));

import { ChessView } from "../src/components/ChessView";
import { ChessRuntimeProvider } from "../src/runtime-context";

const listModels = async () => ({
	defaultModel: "openai/gpt-5",
	models: [
		{
			modelKey: "openai/gpt-5",
			provider: "openai",
			id: "gpt-5",
			name: "GPT-5",
			api: "openai",
			reasoning: false,
			input: ["text" as const],
			contextWindow: 100_000,
			maxTokens: 8_192,
		},
	],
});

let activeStore: ChessStore | null = null;

/** Mount the view exactly like `activate()` does: runtime supplied through context. */
function renderView() {
	if (!activeStore) throw new Error("store not ready");
	return render(
		<ChessRuntimeProvider value={{ store: activeStore, listModels }}>
			<ChessView />
		</ChessRuntimeProvider>,
	);
}

function memoryStorage(): GameStoragePort {
	const data = new Map<string, unknown>();
	return {
		readJson: async <T,>(key: string): Promise<T | null> => (data.get(key) as T | undefined) ?? null,
		writeJson: async (key: string, value: unknown): Promise<void> => {
			data.set(key, JSON.parse(JSON.stringify(value)));
		},
	};
}

function firstLegalAi() {
	return {
		chat: async (request: PluginAiChatRequest): Promise<PluginAiChatResult> => {
			const lastUser = [...request.messages].reverse().find((m) => m.role === "user");
			const content = lastUser && "content" in lastUser ? String(lastUser.content) : "";
			const match = /([a-i][0-9][a-i][0-9])/.exec(content.split("合法着法")[1] ?? "");
			return {
				modelKey: "openai/gpt-5",
				text: "此步稳健。",
				toolCalls: [{ id: "c1", name: "make_move", arguments: { move: match?.[1] ?? "" } }],
				stopReason: "toolUse",
				usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
			};
		},
	};
}

function setupStore() {
	activeStore = new ChessStore({
		storage: memoryStorage(),
		ai: firstLegalAi(),
		notify: () => {},
		now: () => 1,
	});
	return activeStore;
}

describe("ChessView", () => {
	beforeEach(() => {
		setupStore();
	});
	afterEach(() => {
		cleanup();
		activeStore = null;
	});

	it("shows the new-game screen when nothing is saved", async () => {
		renderView();
		await waitFor(() => expect(screen.getByText("newGame.title")).toBeTruthy());
		expect(screen.getByText("newGame.red.title")).toBeTruthy();
		expect(screen.getByText("newGame.black.title")).toBeTruthy();
	});

	it("starts a game as red and renders the full board", async () => {
		renderView();
		await waitFor(() => screen.getByText("newGame.start"));
		fireEvent.click(screen.getByText("newGame.start"));
		await waitFor(() => expect(screen.getAllByRole("button", { name: /red-|black-/ })).toHaveLength(32));
		expect(screen.getByText("status.yourTurn")).toBeTruthy();
		expect(screen.getByText("panel.noMoves")).toBeTruthy();
	});

	it("selecting a piece shows targets, moving triggers the agent reply", async () => {
		renderView();
		await waitFor(() => screen.getByText("newGame.start"));
		fireEvent.click(screen.getByText("newGame.start"));
		await waitFor(() => screen.getByRole("button", { name: "red-cannon-1-7" }));

		// select the red cannon and play 炮二平五 (b7 -> e7)
		fireEvent.click(screen.getByRole("button", { name: "red-cannon-1-7" }));
		const target = document.querySelector('[data-square="4,7"]');
		expect(target).not.toBeNull();
		fireEvent.click(target as Element);

		// player's move plus the scripted agent's answer land in the history
		await waitFor(() => expect(screen.getByText("炮二平五")).toBeTruthy());
		await waitFor(() => expect(screen.getByText("此步稳健。")).toBeTruthy());
		await waitFor(() => expect(screen.getByText("status.yourTurn")).toBeTruthy());
	});

	it("playing as black lets the agent open and flips the board interactivity", async () => {
		renderView();
		await waitFor(() => screen.getByText("newGame.black.title"));
		fireEvent.click(screen.getByText("newGame.black.title"));
		fireEvent.click(screen.getByText("newGame.start"));
		// the agent (red) makes the first move automatically
		await waitFor(() => expect(screen.getByText("此步稳健。")).toBeTruthy());
		expect(screen.getByText("status.yourTurn")).toBeTruthy();
	});

	it("reset returns to the new-game screen after confirmation", async () => {
		renderView();
		await waitFor(() => screen.getByText("newGame.start"));
		fireEvent.click(screen.getByText("newGame.start"));
		await waitFor(() => screen.getByText("action.reset"));
		fireEvent.click(screen.getByText("action.reset"));
		fireEvent.click(screen.getByText("confirm.reset"));
		await waitFor(() => expect(screen.getByText("newGame.title")).toBeTruthy());
	});

	it("resign ends the game and offers a rematch", async () => {
		renderView();
		await waitFor(() => screen.getByText("newGame.start"));
		fireEvent.click(screen.getByText("newGame.start"));
		await waitFor(() => screen.getByText("action.resign"));
		fireEvent.click(screen.getByText("action.resign"));
		fireEvent.click(screen.getByText("confirm.resign"));
		await waitFor(() => expect(screen.getAllByText("status.resigned").length).toBeGreaterThan(0));
		expect(screen.getByText("action.playAgain")).toBeTruthy();
	});

	it("restores a persisted game on remount", async () => {
		const store = activeStore as ChessStore;
		await act(async () => {
			await store.ensureLoaded();
			await store.newGame("RED");
			await store.playerMove({ x: 1, y: 7 }, { x: 4, y: 7 });
		});
		renderView();
		await waitFor(() => expect(screen.getByText("炮二平五")).toBeTruthy());
	});
});
