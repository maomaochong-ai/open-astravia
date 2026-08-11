import {
	createEmptyBoard,
	DEFAULT_CONCURRENCY,
	type KanbanBoard,
	type KanbanCard,
	type KanbanIdeaState,
	KANBAN_LANES,
	type KanbanLane,
	type KanbanRunState,
	MAX_CONCURRENCY,
	MIN_CONCURRENCY,
} from "./types";

/**
 * 看板状态的纯函数层。所有变更都返回新 board，不碰存储、不碰会话——
 * 副作用（建会话、发 prompt、落盘）由调用方按返回结果去做，这样同一套规则
 * 既能被 UI 用，也能被 agent 工具用，还能单测。
 */

export interface NewCardInput {
	title: string;
	detail?: string;
	lane?: KanbanLane;
	ideaState?: KanbanIdeaState;
	cwd?: string;
	modelKey?: string;
	priority?: 0 | 1 | 2;
	tags?: string[];
	dependsOn?: string[];
}

function clampPriority(value: unknown): 0 | 1 | 2 {
	return value === 2 ? 2 : value === 1 ? 1 : 0;
}

function nextOrder(board: KanbanBoard, lane: KanbanLane): number {
	const orders = board.cards.filter((card) => card.lane === lane).map((card) => card.order);
	return orders.length === 0 ? 0 : Math.max(...orders) + 1;
}

function stringList(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

export function createCard(board: KanbanBoard, input: NewCardInput, now: number, id: string): KanbanCard {
	const lane = KANBAN_LANES.includes(input.lane as KanbanLane) ? (input.lane as KanbanLane) : "inbox";
	return {
		id,
		title: input.title.trim(),
		detail: (input.detail ?? "").trim(),
		lane,
		// 手动新建到「正在处理」/「待检查」的卡片，其 ideaState 不再被读取，
		// 但仍给个确定值，避免回拖到灵感池时状态不确定。
		ideaState: input.ideaState === "ready" ? "ready" : "draft",
		cwd: (input.cwd ?? "").trim(),
		modelKey: (input.modelKey ?? "").trim(),
		priority: clampPriority(input.priority),
		tags: stringList(input.tags),
		dependsOn: stringList(input.dependsOn),
		createdAt: now,
		updatedAt: now,
		order: nextOrder(board, lane),
	};
}

export function addCard(board: KanbanBoard, card: KanbanCard): KanbanBoard {
	return { ...board, cards: [...board.cards, card] };
}

export function findCard(board: KanbanBoard, cardId: string): KanbanCard | undefined {
	return board.cards.find((card) => card.id === cardId);
}

export function updateCard(
	board: KanbanBoard,
	cardId: string,
	patch: Partial<Omit<KanbanCard, "id" | "createdAt">>,
	now: number,
): KanbanBoard {
	let changed = false;
	const cards = board.cards.map((card) => {
		if (card.id !== cardId) return card;
		changed = true;
		return { ...card, ...patch, id: card.id, createdAt: card.createdAt, updatedAt: now };
	});
	return changed ? { ...board, cards } : board;
}

export function removeCard(board: KanbanBoard, cardId: string): KanbanBoard {
	const cards = board.cards.filter((card) => card.id !== cardId);
	if (cards.length === board.cards.length) return board;
	// 顺手清掉悬空依赖，否则被依赖卡删掉后其它卡会永远派不出去。
	return {
		...board,
		cards: cards.map((card) =>
			card.dependsOn.includes(cardId)
				? { ...card, dependsOn: card.dependsOn.filter((id) => id !== cardId) }
				: card,
		),
	};
}

/**
 * 把卡片移到某泳道的指定位置（`beforeCardId` 之前；null = 末尾）。
 * 移出灵感池时把 ideaState 归一为 `ready`——「草稿」只在灵感池里有意义，
 * 回拖时才不会带着一个已经不成立的状态。
 */
export function moveCard(
	board: KanbanBoard,
	cardId: string,
	lane: KanbanLane,
	beforeCardId: string | null,
	now: number,
): KanbanBoard {
	const card = findCard(board, cardId);
	if (!card) return board;

	const laneCards = board.cards
		.filter((candidate) => candidate.lane === lane && candidate.id !== cardId)
		.sort((left, right) => left.order - right.order);
	const insertAt = beforeCardId === null ? laneCards.length : laneCards.findIndex((c) => c.id === beforeCardId);
	const index = insertAt < 0 ? laneCards.length : insertAt;
	const ordered = [...laneCards.slice(0, index), card, ...laneCards.slice(index)];
	const orderById = new Map(ordered.map((candidate, position) => [candidate.id, position]));

	return {
		...board,
		cards: board.cards.map((candidate) => {
			const order = orderById.get(candidate.id);
			if (order === undefined) return candidate;
			if (candidate.id !== cardId) {
				return candidate.order === order ? candidate : { ...candidate, order };
			}
			return {
				...candidate,
				lane,
				order,
				ideaState: lane === "inbox" ? candidate.ideaState : "ready",
				updatedAt: now,
			};
		}),
	};
}

export function setIdeaState(board: KanbanBoard, cardId: string, state: KanbanIdeaState, now: number): KanbanBoard {
	const card = findCard(board, cardId);
	if (!card || card.lane !== "inbox") return board;
	return updateCard(board, cardId, { ideaState: state }, now);
}

export function setAutoClaim(board: KanbanBoard, enabled: boolean): KanbanBoard {
	return board.autoClaim === enabled ? board : { ...board, autoClaim: enabled };
}

export function setConcurrency(board: KanbanBoard, value: number): KanbanBoard {
	const concurrency = Math.min(MAX_CONCURRENCY, Math.max(MIN_CONCURRENCY, Math.round(value)));
	return concurrency === board.concurrency ? board : { ...board, concurrency };
}

/** 泳道内按 order 排好的卡片（不含已归档）。 */
export function laneCards(board: KanbanBoard, lane: KanbanLane): KanbanCard[] {
	return board.cards
		.filter((card) => card.lane === lane && card.archivedAt === undefined)
		.sort((left, right) => left.order - right.order);
}

/** 已归档卡片，最近归档在前。 */
export function archivedCards(board: KanbanBoard): KanbanCard[] {
	return board.cards
		.filter((card) => card.archivedAt !== undefined)
		.sort((left, right) => (right.archivedAt ?? 0) - (left.archivedAt ?? 0));
}

/** 验收通过 → 归档。只对「待检查」里的卡片有意义；其余原样返回。 */
export function archiveCard(board: KanbanBoard, cardId: string, now: number): KanbanBoard {
	const card = findCard(board, cardId);
	if (!card || card.lane !== "review" || card.archivedAt !== undefined) return board;
	return updateCard(board, cardId, { archivedAt: now }, now);
}

/** 从归档恢复回「待检查」末尾。 */
export function restoreCard(board: KanbanBoard, cardId: string, now: number): KanbanBoard {
	const card = findCard(board, cardId);
	if (!card || card.archivedAt === undefined) return board;
	const cleared = updateCard(board, cardId, { archivedAt: undefined }, now);
	return moveCard(cleared, cardId, "review", null, now);
}

/**
 * 打回重做（纯状态部分）：卡片从「待检查」回到「正在处理」，重新占一个 WIP 名额。
 * 副作用（向原会话发反馈 prompt）由 controller 做；这里只保证状态一致：
 * 清掉 error、runState 归为 queued，deliveryNote 保留——上一轮交付说明是反馈的上下文。
 */
export function sendCardBack(board: KanbanBoard, cardId: string, now: number): KanbanBoard {
	const card = findCard(board, cardId);
	if (!card || card.lane !== "review" || card.archivedAt !== undefined) return board;
	const moved = moveCard(board, cardId, "doing", null, now);
	return updateCard(moved, cardId, { runState: "queued", error: undefined }, now);
}

/** 标题 / 正文 / 标签的大小写不敏感搜索；空串命中全部。 */
export function matchesQuery(card: KanbanCard, query: string): boolean {
	const trimmed = query.trim().toLowerCase();
	if (!trimmed) return true;
	return (
		card.title.toLowerCase().includes(trimmed) ||
		card.detail.toLowerCase().includes(trimmed) ||
		card.tags.some((tag) => tag.toLowerCase().includes(trimmed))
	);
}

/** 会话运行态回填：把宿主广播的 running 集合映射成卡片 runState。 */
export function applyRunningSessions(board: KanbanBoard, runningPaths: ReadonlySet<string>, now: number): KanbanBoard {
	let changed = false;
	const cards = board.cards.map((card) => {
		if (card.lane !== "doing" || !card.sessionPath) return card;
		const running = runningPaths.has(card.sessionPath);
		// 终态（done/failed）不被运行态覆盖：卡片已经交付或已经失败，
		// 会话里后续任何活动都不该把它拉回「运行中」。
		if (card.runState === "done" || card.runState === "failed") return card;
		const next: KanbanRunState = running ? "running" : card.runState === "queued" ? "queued" : "waiting";
		if (card.runState === next) return card;
		changed = true;
		return { ...card, runState: next, updatedAt: now };
	});
	return changed ? { ...board, cards } : board;
}

/** 卡片的目标运行目录。 */
export function resolveCardCwd(board: KanbanBoard, card: KanbanCard): string {
	return card.cwd.trim() || board.defaultCwd.trim();
}

/**
 * 卡片实际使用的模型。空串是有意义的值：**不带模型派单**，由宿主用它的全局默认，
 * 而不是由看板猜一个。
 */
export function resolveCardModelKey(board: KanbanBoard, card: KanbanCard): string {
	return card.modelKey.trim() || board.defaultModelKey.trim();
}

function normalizeCard(raw: unknown, index: number): KanbanCard | null {
	if (raw == null || typeof raw !== "object") return null;
	const record = raw as Record<string, unknown>;
	const id = typeof record.id === "string" && record.id.length > 0 ? record.id : null;
	const title = typeof record.title === "string" ? record.title : "";
	if (!id) return null;
	const lane = KANBAN_LANES.includes(record.lane as KanbanLane) ? (record.lane as KanbanLane) : "inbox";
	const now = Date.now();
	return {
		id,
		title,
		detail: typeof record.detail === "string" ? record.detail : "",
		lane,
		ideaState: record.ideaState === "ready" ? "ready" : "draft",
		cwd: typeof record.cwd === "string" ? record.cwd : "",
		modelKey: typeof record.modelKey === "string" ? record.modelKey : "",
		priority: clampPriority(record.priority),
		tags: stringList(record.tags),
		dependsOn: stringList(record.dependsOn),
		...(typeof record.sessionId === "string" ? { sessionId: record.sessionId } : {}),
		...(typeof record.sessionPath === "string" ? { sessionPath: record.sessionPath } : {}),
		...(typeof record.runState === "string" ? { runState: record.runState as KanbanRunState } : {}),
		...(record.claimedBy === "agent" || record.claimedBy === "user" ? { claimedBy: record.claimedBy } : {}),
		...(typeof record.deliveryNote === "string" ? { deliveryNote: record.deliveryNote } : {}),
		...(typeof record.error === "string" ? { error: record.error } : {}),
		...(typeof record.archivedAt === "number" ? { archivedAt: record.archivedAt } : {}),
		createdAt: typeof record.createdAt === "number" ? record.createdAt : now,
		updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : now,
		order: typeof record.order === "number" ? record.order : index,
	};
}

/**
 * 宽松解析持久化内容。看板是用户长期积累的资产，任何一条脏卡片都不该让整块板
 * 打不开——坏卡片单独丢弃，其余照常恢复。
 */
export function parseBoard(raw: unknown, fallbackCwd = ""): KanbanBoard {
	if (raw == null || typeof raw !== "object") return createEmptyBoard(fallbackCwd);
	const record = raw as Record<string, unknown>;
	const rawCards = Array.isArray(record.cards) ? record.cards : [];
	const cards = rawCards.map(normalizeCard).filter((card): card is KanbanCard => card !== null);
	// 运行中的会话不会跨重启存活：恢复时把「运行中」降级成「等待中」，
	// 由用户决定继续还是重派，避免看板显示一个其实已经没在跑的任务。
	const restored = cards.map((card) => (card.runState === "running" ? { ...card, runState: "waiting" as const } : card));
	const concurrency =
		typeof record.concurrency === "number" && Number.isFinite(record.concurrency)
			? Math.min(MAX_CONCURRENCY, Math.max(MIN_CONCURRENCY, Math.round(record.concurrency)))
			: DEFAULT_CONCURRENCY;
	return {
		version: 1,
		concurrency,
		defaultCwd: typeof record.defaultCwd === "string" && record.defaultCwd ? record.defaultCwd : fallbackCwd,
		defaultModelKey: typeof record.defaultModelKey === "string" ? record.defaultModelKey : "",
		// 只认显式的 true：老数据没有这个字段，恢复后不该突然自己开始派单。
		autoClaim: record.autoClaim === true,
		cards: restored,
	};
}
