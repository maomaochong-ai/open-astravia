import type { PluginAiChatMessage } from "@vetta-org/plugin-sdk";
import { type AgentChatPort, playAgentTurn } from "./agent-player";
import { replayGame, XiangqiEngine } from "./engine";
import { parseIccs } from "./notation";
import type { BoardPoint, CommentaryEntry, GameStatus, MoveRecord, PersistedGameState, Side } from "./types";
import { opponentOf } from "./types";

const STATE_KEY = "game/state.json";

/** The two storage calls the store needs; narrow so tests can fake it. */
export interface GameStoragePort {
	readFile(key: string, encoding: "utf8" | "base64"): Promise<string | null>;
	writeFile(key: string, data: string, encoding: "utf8" | "base64"): Promise<unknown>;
}

export interface NotifyPort {
	(options: { message: string; error?: unknown; variant?: "info" | "success" | "warning" | "error" }): void;
}

export interface ChessSnapshot {
	loaded: boolean;
	/** No game has been started yet (fresh install or after reset). */
	idle: boolean;
	playerSide: Side;
	turn: Side;
	pieces: ReturnType<XiangqiEngine["pieces"]>;
	moves: MoveRecord[];
	commentary: CommentaryEntry[];
	status: GameStatus;
	/** The agent is currently thinking or replying. */
	agentBusy: boolean;
	/** The side to move is in check. */
	inCheck: boolean;
	modelKey: string | null;
	lastMove: MoveRecord | null;
}

interface StoreDeps {
	storage: GameStoragePort;
	ai: AgentChatPort;
	notify: NotifyPort;
	now?: () => number;
}

function freshStatus(): GameStatus {
	return { over: false, winner: null };
}

/**
 * Owns the whole game lifecycle: rules engine, agent loop, persistence.
 * All state survives restarts via plugin storage until the user resets it.
 */
export class ChessStore {
	private readonly deps: StoreDeps;
	private engine: XiangqiEngine | null = null;
	private state: PersistedGameState | null = null;
	private loaded = false;
	private agentBusy = false;
	private listeners = new Set<() => void>();
	private cachedSnapshot: ChessSnapshot | null = null;
	private loadPromise: Promise<void> | null = null;
	private generation = 0;

	constructor(deps: StoreDeps) {
		this.deps = deps;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(): void {
		this.cachedSnapshot = null;
		for (const listener of this.listeners) listener();
	}

	/** Stable reference between emits so it can back `useSyncExternalStore`. */
	snapshot(): ChessSnapshot {
		if (this.cachedSnapshot) return this.cachedSnapshot;
		this.cachedSnapshot = this.buildSnapshot();
		return this.cachedSnapshot;
	}

	private buildSnapshot(): ChessSnapshot {
		const engine = this.engine;
		const state = this.state;
		return {
			loaded: this.loaded,
			idle: state === null,
			playerSide: state?.playerSide ?? "RED",
			turn: engine?.turn ?? "RED",
			pieces: engine?.pieces() ?? [],
			moves: state?.moves ?? [],
			commentary: state?.commentary ?? [],
			status: state?.status ?? freshStatus(),
			agentBusy: this.agentBusy,
			inCheck: engine?.inCheck() ?? false,
			modelKey: state?.modelKey ?? null,
			lastMove: state?.moves.at(-1) ?? null,
		};
	}

	legalTargetsFrom(from: BoardPoint): BoardPoint[] {
		if (!this.engine || !this.state || this.state.status.over) return [];
		if (this.engine.turn !== this.state.playerSide || this.agentBusy) return [];
		return this.engine.legalTargetsFrom(from);
	}

	ensureLoaded(): Promise<void> {
		this.loadPromise ??= this.load();
		return this.loadPromise;
	}

	private async load(): Promise<void> {
		try {
			const raw = await this.deps.storage.readFile(STATE_KEY, "utf8");
			const saved = raw === null ? null : (JSON.parse(raw) as PersistedGameState);
			if (saved && saved.version === 1) {
				this.state = saved;
				this.engine = this.rebuildEngine(saved);
			}
		} catch (error) {
			this.deps.notify({ message: "读取棋局存档失败，已从空局开始", error });
		}
		this.loaded = true;
		this.emit();
		// A restart may have interrupted the agent mid-turn; let it move again.
		// The listeners above already saw the restored position, so awaiting the
		// model here only delays the promise, not first paint.
		await this.resumeAgentIfNeeded();
	}

	/**
	 * The PEN is authoritative for the position; replaying the history keeps the
	 * engine's internal state (turn, game-over) consistent with it. A corrupted
	 * history falls back to loading the PEN directly.
	 */
	private rebuildEngine(state: PersistedGameState): XiangqiEngine {
		const replayed = replayGame(state.moves.map((move) => move.iccs), parseIccs);
		if (replayed.pen === state.pen) return replayed;
		return new XiangqiEngine(state.pen);
	}

	private async persist(): Promise<void> {
		if (!this.state) return;
		try {
			await this.deps.storage.writeFile(STATE_KEY, JSON.stringify(this.state, null, 2), "utf8");
		} catch (error) {
			this.deps.notify({ message: "保存棋局失败", error });
		}
	}

	async newGame(playerSide: Side, modelKey?: string | null): Promise<void> {
		this.generation += 1;
		this.engine = new XiangqiEngine();
		this.state = {
			version: 1,
			pen: this.engine.pen,
			playerSide,
			moves: [],
			chat: [],
			commentary: [],
			modelKey: modelKey === undefined ? (this.state?.modelKey ?? null) : modelKey,
			status: freshStatus(),
			updatedAt: this.deps.now?.() ?? Date.now(),
		};
		this.agentBusy = false;
		this.emit();
		await this.persist();
		if (playerSide === "BLACK") await this.runAgentTurn();
	}

	async reset(): Promise<void> {
		this.generation += 1;
		this.engine = null;
		this.state = null;
		this.agentBusy = false;
		this.emit();
		try {
			await this.deps.storage.writeFile(STATE_KEY, "null", "utf8");
		} catch (error) {
			this.deps.notify({ message: "清除棋局失败", error });
		}
	}

	async setModelKey(modelKey: string | null): Promise<void> {
		if (!this.state) return;
		this.state.modelKey = modelKey;
		this.emit();
		await this.persist();
	}

	/** Apply the player's move, then hand the turn to the agent. */
	async playerMove(from: BoardPoint, to: BoardPoint): Promise<boolean> {
		const engine = this.engine;
		const state = this.state;
		if (!engine || !state || state.status.over || this.agentBusy) return false;
		if (engine.turn !== state.playerSide) return false;
		const outcome = engine.move(from, to);
		if (!outcome.ok || !outcome.record) return false;
		state.moves.push(outcome.record);
		state.pen = engine.pen;
		state.updatedAt = this.deps.now?.() ?? Date.now();
		if (outcome.over) {
			state.status = { over: true, winner: outcome.winner, reason: "checkmate" };
		}
		this.emit();
		await this.persist();
		if (!outcome.over) await this.runAgentTurn();
		return true;
	}

	/** Take back the last full round (agent reply + own move). */
	async undo(): Promise<void> {
		const state = this.state;
		if (!state || this.agentBusy || state.moves.length === 0) return;
		const dropCount = state.moves.at(-1)?.side === state.playerSide ? 1 : 2;
		state.moves = state.moves.slice(0, Math.max(0, state.moves.length - dropCount));
		state.commentary = state.commentary.filter((entry) => entry.moveIndex < state.moves.length);
		this.engine = replayGame(state.moves.map((move) => move.iccs), parseIccs);
		state.pen = this.engine.pen;
		state.status = freshStatus();
		state.chat = [...state.chat, { role: "user", content: "（用户悔棋，棋局已回退。以最新局面为准。）" }];
		state.updatedAt = this.deps.now?.() ?? Date.now();
		this.emit();
		await this.persist();
		await this.resumeAgentIfNeeded();
	}

	async resign(): Promise<void> {
		const state = this.state;
		if (!state || state.status.over) return;
		state.status = { over: true, winner: opponentOf(state.playerSide), reason: "resign" };
		state.updatedAt = this.deps.now?.() ?? Date.now();
		this.emit();
		await this.persist();
	}

	private async resumeAgentIfNeeded(): Promise<void> {
		const engine = this.engine;
		const state = this.state;
		if (!engine || !state || state.status.over || this.agentBusy) return;
		if (engine.turn === state.playerSide) return;
		await this.runAgentTurn();
	}

	private async runAgentTurn(): Promise<void> {
		const engine = this.engine;
		const state = this.state;
		if (!engine || !state || state.status.over || this.agentBusy) return;
		const generation = this.generation;
		const agentSide = opponentOf(state.playerSide);
		if (engine.turn !== agentSide) return;
		this.agentBusy = true;
		this.emit();
		try {
			const result = await playAgentTurn({
				ai: this.deps.ai,
				engine,
				agentSide,
				modelKey: state.modelKey,
				transcript: state.chat,
				...(state.moves.at(-1) === undefined ? {} : { lastOpponentMove: state.moves.at(-1) as MoveRecord }),
			});
			// The user may have reset or started a new game while the model was thinking.
			if (generation !== this.generation || this.state !== state) return;
			state.chat = result.transcript as PluginAiChatMessage[];
			state.moves.push(result.record);
			if (result.commentary.length > 0) {
				state.commentary.push({ moveIndex: state.moves.length - 1, text: result.commentary });
			}
			state.pen = engine.pen;
			state.updatedAt = this.deps.now?.() ?? Date.now();
			if (result.over) {
				state.status = { over: true, winner: result.winner, reason: "checkmate" };
			}
			if (result.fallbackUsed) {
				this.deps.notify({ message: "模型多次给出非法走法，本步已由系统代走", variant: "warning" });
			}
			await this.persist();
		} catch (error) {
			if (generation === this.generation) {
				this.deps.notify({ message: "Agent 走棋失败，请检查模型配置后重试", error });
			}
		} finally {
			if (generation === this.generation) {
				this.agentBusy = false;
				this.emit();
			}
		}
	}

	/** Ask the agent to move again after a failed attempt (e.g. no model configured). */
	async retryAgentTurn(): Promise<void> {
		await this.resumeAgentIfNeeded();
	}
}
