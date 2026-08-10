import type { PluginContext } from "@vetta-org/plugin-sdk";
import {
	addCard,
	applyRunningSessions,
	archiveCard,
	createCard,
	findCard,
	moveCard,
	type NewCardInput,
	parseBoard,
	removeCard,
	restoreCard,
	sendCardBack,
	setConcurrency,
	setIdeaState,
	updateCard,
} from "./board-store";
import { buildDispatchPrompt, buildSendBackPrompt, canDispatch, type DispatchDecision } from "./dispatch";
import { createEmptyBoard, type KanbanBoard, type KanbanIdeaState, type KanbanLane } from "./types";

const BOARD_STORAGE_KEY = "board";

export type BoardListener = (board: KanbanBoard) => void;

export interface DispatchResult {
	ok: boolean;
	/** 失败时的机器可读原因（与 {@link DispatchDecision} 一致）。 */
	decision: DispatchDecision;
	message: string;
}

/**
 * 看板的**单一真相源**。UI 和 agent 工具共用同一个实例，因此：
 * 用户在页面上拖一张卡，agent 下一次读板立刻看到；agent 认领一条需求，页面立刻
 * 亮起「运行中」。不做双份状态，也就不会出现两边打架。
 *
 * 纯规则在 board-store / dispatch 里；这里只负责：加载与落盘、副作用（建会话、
 * 发 prompt）、以及把宿主的会话运行态回灌进卡片。
 */
export class KanbanBoardController {
	private board: KanbanBoard = createEmptyBoard();
	private readonly listeners = new Set<BoardListener>();
	private loaded = false;
	private loading: Promise<void> | null = null;
	private writeChain: Promise<void> = Promise.resolve();
	private runningPaths = new Set<string>();
	private disposeRunning: (() => void) | null = null;
	private projects: Array<{ path: string; name?: string }> = [];

	constructor(private readonly ctx: PluginContext) {}

	getBoard(): KanbanBoard {
		return this.board;
	}

	/** 已知项目列表（load 时取一次），供 Composer 的项目选择器用。 */
	getProjects(): Array<{ path: string; name?: string }> {
		return this.projects;
	}

	subscribe(listener: BoardListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** 幂等：多个面板同时挂载只会真正加载一次。 */
	async ensureLoaded(): Promise<KanbanBoard> {
		if (this.loaded) return this.board;
		this.loading ??= this.load();
		await this.loading;
		return this.board;
	}

	private async load(): Promise<void> {
		let fallbackCwd = "";
		try {
			const snapshot = await this.ctx.official.projects.list();
			this.projects = snapshot.projects.map((entry) => ({ path: entry.path, name: entry.name }));
			fallbackCwd = snapshot.projects[0]?.path ?? snapshot.workspacePath ?? "";
		} catch (error) {
			console.warn("[kanban] failed to resolve default project", error);
		}
		try {
			const stored = await this.ctx.storage.readJson<unknown>(BOARD_STORAGE_KEY);
			this.board = parseBoard(stored, fallbackCwd);
		} catch (error) {
			this.ctx.ui.notify({ message: this.ctx.i18n.t("error.loadBoard"), error });
			this.board = createEmptyBoard(fallbackCwd);
		}
		this.loaded = true;
		this.attachRunningWatch();
		await this.refreshRunning();
		this.emit();
	}

	/**
	 * 订阅宿主的会话运行态广播。运行态是**派生**信息（真相在主进程），所以只回灌
	 * 不落盘的部分——`runState` 仍写进 board 是为了让 agent 读板时看到一致的视图。
	 */
	private attachRunningWatch(): void {
		if (this.disposeRunning) return;
		this.disposeRunning = this.ctx.official.sessions.onRunningChanged((event) => {
			if (event.running) this.runningPaths.add(event.sessionPath);
			else this.runningPaths.delete(event.sessionPath);
			this.applyRunning();
		});
	}

	private async refreshRunning(): Promise<void> {
		try {
			this.runningPaths = new Set(await this.ctx.official.sessions.listRunning());
			this.applyRunning();
		} catch (error) {
			console.warn("[kanban] failed to read running sessions", error);
		}
	}

	private applyRunning(): void {
		const next = applyRunningSessions(this.board, this.runningPaths, Date.now());
		if (next === this.board) return;
		this.commit(next);
	}

	dispose(): void {
		this.disposeRunning?.();
		this.disposeRunning = null;
		this.listeners.clear();
	}

	private emit(): void {
		for (const listener of this.listeners) listener(this.board);
	}

	/**
	 * 写入并落盘。落盘串行化：拖拽会在一帧内连发多次变更，并行写会让最后落盘的
	 * 不一定是最新状态。
	 */
	private commit(next: KanbanBoard): KanbanBoard {
		this.board = next;
		this.emit();
		this.writeChain = this.writeChain
			.then(() => this.ctx.storage.writeJson(BOARD_STORAGE_KEY, this.board))
			.catch((error: unknown) => {
				this.ctx.ui.notify({ message: this.ctx.i18n.t("error.saveBoard"), error });
			});
		return next;
	}

	// ── 用户 / agent 共用的看板操作 ───────────────────────────────────────

	addCard(input: NewCardInput): KanbanBoard {
		const now = Date.now();
		const id = `card-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		return this.commit(addCard(this.board, createCard(this.board, input, now, id)));
	}

	updateCard(cardId: string, patch: Parameters<typeof updateCard>[2]): KanbanBoard {
		return this.commit(updateCard(this.board, cardId, patch, Date.now()));
	}

	removeCard(cardId: string): KanbanBoard {
		return this.commit(removeCard(this.board, cardId));
	}

	moveCard(cardId: string, lane: KanbanLane, beforeCardId: string | null): KanbanBoard {
		return this.commit(moveCard(this.board, cardId, lane, beforeCardId, Date.now()));
	}

	setIdeaState(cardId: string, state: KanbanIdeaState): KanbanBoard {
		return this.commit(setIdeaState(this.board, cardId, state, Date.now()));
	}

	setConcurrency(value: number): KanbanBoard {
		return this.commit(setConcurrency(this.board, value));
	}

	setDefaultCwd(cwd: string): KanbanBoard {
		return this.commit({ ...this.board, defaultCwd: cwd });
	}

	/**
	 * 派单：建会话 → 卡片移入「正在处理」→ 发出首轮 prompt。
	 *
	 * 卡片先落到「正在处理」再发 prompt，是为了让并发闸门在**发出之前**就把名额
	 * 占住——否则并发派两条时，两次 canDispatch 都会看到同一个空名额。
	 */
	async dispatch(cardId: string, claimedBy: "agent" | "user"): Promise<DispatchResult> {
		await this.ensureLoaded();
		const decision = canDispatch(this.board, cardId);
		if (!decision.ok) {
			return { ok: false, decision, message: this.describeRefusal(decision) };
		}
		const { card, cwd } = decision;
		this.commit(
			updateCard(
				moveCard(this.board, card.id, "doing", null, Date.now()),
				card.id,
				{ runState: "queued", claimedBy, error: undefined },
				Date.now(),
			),
		);
		try {
			const session = await this.ctx.official.sessions.create({ cwd, title: card.title });
			this.updateCard(card.id, { sessionId: session.sessionId, sessionPath: session.sessionPath });
			await this.ctx.official.sessions.prompt(session.sessionId, buildDispatchPrompt(card));
			await this.refreshRunning();
			return { ok: true, decision, message: this.ctx.i18n.t("dispatch.started") };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			// 派单失败必须把名额吐回来，否则一次网络抖动会永久占住一个 WIP 位。
			this.updateCard(card.id, { runState: "failed", error: message });
			this.ctx.ui.notify({ message: this.ctx.i18n.t("error.dispatch"), error });
			return { ok: false, decision: { ok: false, reason: "session-error", message }, message };
		}
	}

	/** 把「正在处理」的卡片提交到「待检查」。 */
	submit(cardId: string, note: string): boolean {
		const card = findCard(this.board, cardId);
		if (!card || card.lane !== "doing") return false;
		const now = Date.now();
		this.commit(
			updateCard(
				moveCard(this.board, cardId, "review", null, now),
				cardId,
				{ runState: "done", deliveryNote: note.trim() },
				now,
			),
		);
		return true;
	}

	/** 验收通过 → 归档。 */
	archive(cardId: string): void {
		this.commit(archiveCard(this.board, cardId, Date.now()));
	}

	/** 从归档恢复回「待检查」。 */
	restore(cardId: string): void {
		this.commit(restoreCard(this.board, cardId, Date.now()));
	}

	/**
	 * 打回重做：卡片回「正在处理」，反馈发往**原会话**（上下文都在，agent 只需按
	 * 反馈修正）。原会话不存在（被删 / 跨重启丢失 sessionId）时走重新派发：新会话 +
	 * 完整需求 + 反馈。
	 */
	async sendBack(cardId: string, feedback: string): Promise<boolean> {
		await this.ensureLoaded();
		const card = findCard(this.board, cardId);
		if (!card || card.lane !== "review") return false;
		const next = sendCardBack(this.board, cardId, Date.now());
		if (next === this.board) return false;
		this.commit(next);
		const target = findCard(this.board, cardId);
		if (!target) return false;
		try {
			if (target.sessionId) {
				await this.ctx.official.sessions.prompt(target.sessionId, buildSendBackPrompt(target, feedback));
			} else {
				const cwd = target.cwd.trim() || this.board.defaultCwd.trim();
				if (!cwd) throw new Error(this.ctx.i18n.t("dispatch.refuse.missingCwd"));
				const session = await this.ctx.official.sessions.create({ cwd, title: target.title });
				this.updateCard(cardId, { sessionId: session.sessionId, sessionPath: session.sessionPath });
				await this.ctx.official.sessions.prompt(
					session.sessionId,
					`${buildDispatchPrompt(target)}\n\n---\n上一轮交付被打回，用户反馈：\n${feedback.trim()}`,
				);
			}
			await this.refreshRunning();
			return true;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.updateCard(cardId, { runState: "failed", error: message });
			this.ctx.ui.notify({ message: this.ctx.i18n.t("error.sendBack"), error });
			return false;
		}
	}

	/** 打断卡片对应会话的当前回合。 */
	async abort(cardId: string): Promise<void> {
		const card = findCard(this.board, cardId);
		if (!card?.sessionId) return;
		try {
			await this.ctx.official.sessions.abort(card.sessionId);
		} catch (error) {
			this.ctx.ui.notify({ message: this.ctx.i18n.t("error.abort"), error });
		}
	}

	/** 跳到卡片对应的对话页。 */
	async openSession(cardId: string): Promise<void> {
		const card = findCard(this.board, cardId);
		if (!card?.sessionPath) return;
		const cwd = card.cwd.trim() || this.board.defaultCwd.trim();
		if (!cwd) return;
		try {
			await this.ctx.official.sessions.open({ cwd, sessionPath: card.sessionPath });
		} catch (error) {
			this.ctx.ui.notify({ message: this.ctx.i18n.t("error.openSession"), error });
		}
	}

	private describeRefusal(decision: DispatchDecision & { ok: false }): string {
		const t = (key: string): string => this.ctx.i18n.t(key);
		switch (decision.reason) {
			case "draft":
				return t("dispatch.refuse.draft");
			case "wip-full":
				return `${t("dispatch.refuse.wipFull")} (${decision.concurrency})`;
			case "blocked":
				return `${t("dispatch.refuse.blocked")}: ${decision.blockedBy.join(", ")}`;
			case "not-in-inbox":
				return t("dispatch.refuse.notInInbox");
			case "missing-cwd":
				return t("dispatch.refuse.missingCwd");
			case "session-error":
				return decision.message;
			default:
				return t("dispatch.refuse.notFound");
		}
	}
}
