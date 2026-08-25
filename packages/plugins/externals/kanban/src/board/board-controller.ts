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
	resolveCardModelKey,
	restoreCard,
	sendCardBack,
	setAutoClaim,
	setConcurrency,
	setIdeaState,
	updateCard,
} from "./board-store";
import {
	autoClaimCandidates,
	buildDispatchPrompt,
	buildSendBackPrompt,
	canDispatch,
	type DispatchDecision,
} from "./dispatch";
import { createEmptyBoard, type KanbanBoard, type KanbanIdeaState, type KanbanLane } from "./types";

const BOARD_STORAGE_KEY = "board";

export type BoardListener = (board: KanbanBoard) => void;

/** 可选模型的扁平列表项，供选择器直接渲染。 */
export interface KanbanModelOption {
	/** `provider/modelId`，与宿主 modelKey 同格式。 */
	key: string;
	modelId: string;
	providerId: string;
	providerName: string;
	/** provider 图标 symbol；交给宿主 ProviderIcon 解析，缺省则不画图标。 */
	providerIcon?: string;
	displayName: string;
}

/** 可在需求正文里以 `@skill:名字` 引用的技能，供提及选择器渲染。 */
export interface KanbanSkillOption {
	name: string;
	alias?: string;
	description: string;
}

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
	private models: KanbanModelOption[] = [];
	private skills: KanbanSkillOption[] = [];
	/** 宿主的全局默认模型，仅用于在选择器里标注「默认」，不写进看板数据。 */
	private hostDefaultModelKey = "";
	private autoClaimRunning = false;
	private autoClaimPending = false;
	/**
	 * 自动认领时派不动、又还留在灵感池的卡片（例如目标项目缺失、宿主建会话报错）。
	 * 不跳过它们，循环会盯着同一张卡无限重试。卡片被再次编辑时解除跳过。
	 */
	private readonly autoClaimSkip = new Set<string>();

	constructor(private readonly ctx: PluginContext) {}

	getBoard(): KanbanBoard {
		return this.board;
	}

	/** 已知项目列表（load 时取一次），供 Composer 的项目选择器用。 */
	getProjects(): Array<{ path: string; name?: string }> {
		return this.projects;
	}

	/** 可选模型（load 时取一次），供发布器与卡片编辑器的模型选择器用。 */
	getModels(): KanbanModelOption[] {
		return this.models;
	}

	/** 宿主全局默认模型的 key；空串表示宿主也没配。 */
	getHostDefaultModelKey(): string {
		return this.hostDefaultModelKey;
	}

	/**
	 * 重新拉取模型清单。清单不是看板数据（不落盘、不进 board），所以走单独的刷新口子：
	 * 面板每次挂载都刷一次，用户开着看板去登录 / 加 provider 后回来即可看到新模型，
	 * 不用重开应用。
	 */
	async refreshModels(): Promise<KanbanModelOption[]> {
		try {
			const catalog = await this.ctx.official.models.list();
			this.hostDefaultModelKey = catalog.defaultModel ?? "";
			this.models = catalog.providers.flatMap((provider) =>
				provider.models.map((model) => ({
					key: `${provider.id}/${model.id}`,
					modelId: model.id,
					providerId: provider.id,
					providerName: provider.displayName || provider.id,
					...(provider.icon ? { providerIcon: provider.icon } : {}),
					displayName: model.name?.trim() || model.id,
				})),
			);
		} catch (error) {
			// 模型清单拿不到不该挡住看板：选择器退化为空，派单不带模型走宿主默认。
			console.warn("[kanban] failed to load model catalog", error);
		}
		return this.models;
	}

	/** 已安装技能（load 时取一次），供正文编辑器的 `@` 提及选择器用。 */
	getSkills(): KanbanSkillOption[] {
		return this.skills;
	}

	/**
	 * 重新拉取技能清单。与模型清单同理：不是看板数据，面板每次挂载刷一次，
	 * 用户装了新技能回来就能在 `@` 提及里看到。
	 */
	async refreshSkills(): Promise<KanbanSkillOption[]> {
		try {
			const list = await this.ctx.official.skills.list();
			// 只留 skill：scene 在 prompt 里没有 `@skill:` 软引用形态，混进来会插出无效 token。
			this.skills = list
				.filter((skill) => skill.type === "skill")
				.map((skill) => ({
					name: skill.name,
					...(skill.alias ? { alias: skill.alias } : {}),
					description: skill.description,
				}));
		} catch (error) {
			// 技能清单拿不到不该挡住看板：提及选择器退化为空，正文照常写纯文本。
			console.warn("[kanban] failed to load skill list", error);
		}
		return this.skills;
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
		await Promise.all([this.refreshModels(), this.refreshSkills()]);
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
		// 开关是持久化的：上次开着自动认领、关掉应用期间攒下的待认领卡片，这里接着派。
		this.scheduleAutoClaim();
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
		// 停掉自动认领的续跑：热重载会立刻建一个新 controller，旧实例不该继续派单。
		this.autoClaimPending = false;
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
		this.scheduleAutoClaim();
		return next;
	}

	// ── 自动认领 ────────────────────────────────────────────────────────
	//
	// 看板本身没有「事件源」——卡片变 ready、有卡交付腾出名额、并发上调，都只是一次
	// commit。所以自动认领挂在 commit 上统一评估，而不是在每个入口各挂一次钩子；
	// 少一处漏挂，就少一次「明明可以派却没派」。

	/**
	 * 请求跑一轮自动认领。可重入：循环正在跑时只置 pending，由当前循环收尾时再评估，
	 * 避免 dispatch 内部的 commit 递归触发出多条并行循环、双双看到同一个空名额。
	 */
	private scheduleAutoClaim(): void {
		if (!this.loaded || !this.board.autoClaim) return;
		this.autoClaimPending = true;
		if (this.autoClaimRunning) return;
		void this.runAutoClaim();
	}

	private async runAutoClaim(): Promise<void> {
		this.autoClaimRunning = true;
		try {
			while (this.autoClaimPending) {
				this.autoClaimPending = false;
				const next = autoClaimCandidates(this.board).find((card) => !this.autoClaimSkip.has(card.id));
				if (!next) continue;
				// 一次只派一张、串行等结果：名额是在 dispatch 里占的，并行派会让两张卡
				// 同时看到最后一个名额。派完再评估一轮，名额还有就继续。
				this.autoClaimPending = true;
				const result = await this.dispatch(next.id, "agent");
				// 暂时性拒绝（名额满 / 被依赖挡住）不该拉黑：下一轮条件变了它还能被派。
				const transient = result.decision.ok === false && ["wip-full", "blocked"].includes(result.decision.reason);
				if (!result.ok && !transient && findCard(this.board, next.id)?.lane === "inbox") {
					this.autoClaimSkip.add(next.id);
				}
			}
		} finally {
			this.autoClaimRunning = false;
		}
	}

	// ── 用户 / agent 共用的看板操作 ───────────────────────────────────────

	addCard(input: NewCardInput): KanbanBoard {
		const now = Date.now();
		const id = `card-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		return this.commit(addCard(this.board, createCard(this.board, input, now, id)));
	}

	updateCard(cardId: string, patch: Parameters<typeof updateCard>[2]): KanbanBoard {
		// 卡片被改过（补上目标项目等）就给它重新参与自动认领的机会。
		this.autoClaimSkip.delete(cardId);
		return this.commit(updateCard(this.board, cardId, patch, Date.now()));
	}

	removeCard(cardId: string): KanbanBoard {
		return this.commit(removeCard(this.board, cardId));
	}

	moveCard(cardId: string, lane: KanbanLane, beforeCardId: string | null): KanbanBoard {
		this.autoClaimSkip.delete(cardId);
		return this.commit(moveCard(this.board, cardId, lane, beforeCardId, Date.now()));
	}

	setIdeaState(cardId: string, state: KanbanIdeaState): KanbanBoard {
		this.autoClaimSkip.delete(cardId);
		return this.commit(setIdeaState(this.board, cardId, state, Date.now()));
	}

	setConcurrency(value: number): KanbanBoard {
		return this.commit(setConcurrency(this.board, value));
	}

	/**
	 * 开关自动认领。开启时清空跳过名单并立即评估一轮——用户刚补完卡片信息再开开关，
	 * 不该还记着上一轮的失败。
	 */
	setAutoClaim(enabled: boolean): KanbanBoard {
		if (enabled === this.board.autoClaim) return this.board;
		if (enabled) this.autoClaimSkip.clear();
		return this.commit(setAutoClaim(this.board, enabled));
	}

	setDefaultCwd(cwd: string): KanbanBoard {
		return this.commit({ ...this.board, defaultCwd: cwd });
	}

	/** 空串 = 清除看板默认模型，回到「跟随宿主全局默认」。 */
	setDefaultModelKey(modelKey: string): KanbanBoard {
		const next = modelKey.trim();
		return next === this.board.defaultModelKey ? this.board : this.commit({ ...this.board, defaultModelKey: next });
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
		const { card, cwd, modelKey } = decision;
		this.commit(
			updateCard(
				moveCard(this.board, card.id, "doing", null, Date.now()),
				card.id,
				{ runState: "queued", claimedBy, error: undefined },
				Date.now(),
			),
		);
		try {
			// 模型写进会话设置（而不是只钉首轮）：用户之后接管这个会话继续聊，
			// 用的仍是卡片上选的模型。
			const session = await this.ctx.official.sessions.create({
				cwd,
				title: card.title,
				...(modelKey ? { modelKey } : {}),
			});
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
				// 不覆盖原会话的模型：它已经在派单时按卡片设过，之后若用户在对话页手动换了模型，
				// 那是更新的意图，打回不该把它顶回去。
				await this.ctx.official.sessions.prompt(target.sessionId, buildSendBackPrompt(target, feedback));
			} else {
				const cwd = target.cwd.trim() || this.board.defaultCwd.trim();
				if (!cwd) throw new Error(this.ctx.i18n.t("dispatch.refuse.missingCwd"));
				const modelKey = resolveCardModelKey(this.board, target);
				const session = await this.ctx.official.sessions.create({
					cwd,
					title: target.title,
					...(modelKey ? { modelKey } : {}),
				});
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
