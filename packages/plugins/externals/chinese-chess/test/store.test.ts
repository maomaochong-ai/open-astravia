import type { PluginAiChatRequest, PluginAiChatResult } from "@vetta-org/plugin-sdk";
import { describe, expect, it } from "vitest";
import { ChessStore, type GameStoragePort } from "../src/game/store";
import type { PersistedGameState } from "../src/game/types";

function memoryStorage(initial?: PersistedGameState): GameStoragePort & { data: Map<string, unknown> } {
	const data = new Map<string, unknown>();
	if (initial) data.set("game/state.json", initial);
	return {
		data,
		readJson: async <T>(key: string): Promise<T | null> => (data.get(key) as T | undefined) ?? null,
		writeJson: async (key: string, value: unknown): Promise<void> => {
			data.set(key, JSON.parse(JSON.stringify(value)));
		},
	};
}

/** An agent that always plays the first legal move offered in the turn message. */
function firstLegalAi() {
	const calls: PluginAiChatRequest[] = [];
	return {
		calls,
		chat: async (request: PluginAiChatRequest): Promise<PluginAiChatResult> => {
			calls.push(request);
			const lastUser = [...request.messages].reverse().find((m) => m.role === "user");
			const content = lastUser && "content" in lastUser ? String(lastUser.content) : "";
			const match = /([a-i][0-9][a-i][0-9])/.exec(content.split("合法着法")[1] ?? "");
			return {
				modelKey: "test/model",
				text: "好棋不怕慢。",
				toolCalls: [{ id: `c${calls.length}`, name: "make_move", arguments: { move: match?.[1] ?? "" } }],
				stopReason: "toolUse",
				usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
			};
		},
	};
}

function makeStore(storage = memoryStorage(), ai = firstLegalAi()) {
	const notifications: Array<{ message: string }> = [];
	const store = new ChessStore({
		storage,
		ai,
		notify: (n) => notifications.push(n),
		now: () => 1_000,
	});
	return { store, storage, ai, notifications };
}

describe("ChessStore", () => {
	it("starts idle when nothing is persisted", async () => {
		const { store } = makeStore();
		await store.ensureLoaded();
		const snap = store.snapshot();
		expect(snap.loaded).toBe(true);
		expect(snap.idle).toBe(true);
	});

	it("plays a full round: player moves, agent answers, everything persists", async () => {
		const { store, storage, ai } = makeStore();
		await store.ensureLoaded();
		await store.newGame("RED");
		expect(store.snapshot().idle).toBe(false);

		const moved = await store.playerMove({ x: 1, y: 7 }, { x: 4, y: 7 });
		expect(moved).toBe(true);
		const snap = store.snapshot();
		expect(snap.moves).toHaveLength(2);
		expect(snap.moves[0]?.side).toBe("RED");
		expect(snap.moves[1]?.side).toBe("BLACK");
		expect(snap.turn).toBe("RED");
		expect(snap.commentary).toHaveLength(1);
		expect(ai.calls).toHaveLength(1);

		const persisted = storage.data.get("game/state.json") as PersistedGameState;
		expect(persisted.moves).toHaveLength(2);
		expect(persisted.chat.length).toBeGreaterThan(0);
	});

	it("lets the agent open the game when the player picks black", async () => {
		const { store } = makeStore();
		await store.ensureLoaded();
		await store.newGame("BLACK");
		const snap = store.snapshot();
		expect(snap.moves).toHaveLength(1);
		expect(snap.moves[0]?.side).toBe("RED");
		expect(snap.turn).toBe("BLACK");
	});

	it("rejects player moves out of turn or on illegal squares", async () => {
		const { store } = makeStore();
		await store.ensureLoaded();
		await store.newGame("RED");
		expect(await store.playerMove({ x: 0, y: 9 }, { x: 0, y: 4 })).toBe(false);
		expect(await store.playerMove({ x: 1, y: 2 }, { x: 4, y: 2 })).toBe(false);
	});

	it("restores a saved game and resumes an interrupted agent turn", async () => {
		const first = makeStore();
		await first.store.ensureLoaded();
		await first.store.newGame("RED");
		await first.store.playerMove({ x: 1, y: 7 }, { x: 4, y: 7 });
		const saved = first.storage.data.get("game/state.json") as PersistedGameState;

		// Simulate a crash right after the player moved: drop the agent's reply.
		const interrupted: PersistedGameState = {
			...saved,
			moves: saved.moves.slice(0, 1),
			pen: "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/4C2C1/9/RNBAKABNR b",
			chat: [],
			commentary: [],
		};
		const second = makeStore(memoryStorage(interrupted));
		await second.store.ensureLoaded();
		const snap = second.store.snapshot();
		expect(snap.moves).toHaveLength(2);
		expect(snap.turn).toBe("RED");
	});

	it("undo takes back a full round and keeps the engine consistent", async () => {
		const { store } = makeStore();
		await store.ensureLoaded();
		await store.newGame("RED");
		await store.playerMove({ x: 1, y: 7 }, { x: 4, y: 7 });
		expect(store.snapshot().moves).toHaveLength(2);
		await store.undo();
		const snap = store.snapshot();
		expect(snap.moves).toHaveLength(0);
		expect(snap.turn).toBe("RED");
		expect(snap.pieces).toHaveLength(32);
	});

	it("reset clears the game back to idle and survives reload", async () => {
		const { store, storage } = makeStore();
		await store.ensureLoaded();
		await store.newGame("RED");
		await store.reset();
		expect(store.snapshot().idle).toBe(true);
		const reloaded = makeStore(storage);
		await reloaded.store.ensureLoaded();
		expect(reloaded.store.snapshot().idle).toBe(true);
	});

	it("resign ends the game in the agent's favor", async () => {
		const { store } = makeStore();
		await store.ensureLoaded();
		await store.newGame("RED");
		await store.resign();
		const snap = store.snapshot();
		expect(snap.status).toEqual({ over: true, winner: "BLACK", reason: "resign" });
		expect(await store.playerMove({ x: 1, y: 7 }, { x: 4, y: 7 })).toBe(false);
	});

	it("notifies instead of crashing when the agent errors, and can retry", async () => {
		let fail = true;
		const flaky = {
			chat: async (request: PluginAiChatRequest): Promise<PluginAiChatResult> => {
				if (fail) throw new Error("no model configured");
				return firstLegalAi().chat(request);
			},
		};
		const storage = memoryStorage();
		const notifications: Array<{ message: string }> = [];
		const store = new ChessStore({ storage, ai: flaky, notify: (n) => notifications.push(n), now: () => 1 });
		await store.ensureLoaded();
		await store.newGame("RED");
		await store.playerMove({ x: 1, y: 7 }, { x: 4, y: 7 });
		expect(store.snapshot().moves).toHaveLength(1);
		expect(notifications.some((n) => n.message.includes("Agent"))).toBe(true);
		expect(store.snapshot().agentBusy).toBe(false);

		fail = false;
		await store.retryAgentTurn();
		expect(store.snapshot().moves).toHaveLength(2);
	});

	it("ignores a stale agent reply after reset", async () => {
		const gate: { release?: () => void } = {};
		const slow = {
			chat: (request: PluginAiChatRequest): Promise<PluginAiChatResult> =>
				new Promise((resolve) => {
					gate.release = () => resolve(firstLegalAi().chat(request));
				}),
		};
		const { store } = makeStore(memoryStorage(), slow as never);
		await store.ensureLoaded();
		await store.newGame("RED");
		const movePromise = store.playerMove({ x: 1, y: 7 }, { x: 4, y: 7 });
		await new Promise((r) => setTimeout(r, 0));
		await store.reset();
		gate.release?.();
		await movePromise;
		expect(store.snapshot().idle).toBe(true);
	});
});
