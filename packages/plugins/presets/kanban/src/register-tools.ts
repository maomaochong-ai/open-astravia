import type { PluginContext } from "@vetta-org/plugin-sdk";
import type { KanbanBoardController } from "./board/board-controller";
import { findCard } from "./board/board-store";
import { dispatchableCards, snapshotForAgent } from "./board/dispatch";

/**
 * 看板的 agent 侧接口。设计原则：**看板只做闸门，不做调度**。
 *
 * 哪条需求先做、能不能并行、要不要等前一条交付，全由 agent 在对话里自行判断；
 * 这些工具只负责给它一个准确的板面快照，并在它违反并发上限 / 依赖顺序 / 草稿保护
 * 时明确拒绝——拒绝理由是可执行的（还剩几个名额、被谁挡住），agent 据此决定等还是换。
 */
export function registerKanbanTools(ctx: PluginContext, controller: KanbanBoardController): void {
	const scope_use = ["conversation", "project"] as const;

	ctx.agent.registerTool<Record<string, never>>({
		id: "kanban-list",
		name: "kanban_list_tasks",
		label: "%tool.list.label%",
		description:
			"读取看板快照：待认领需求（含优先级、依赖阻塞情况）、正在处理的任务及其运行态、待检查的交付，以及「正在处理」还剩几个并发名额。" +
			"认领任务前先调这个，不要凭记忆假设板面状态。" +
			"快照里的 autoClaim=true 表示看板已开启自动认领，会自己把「待认领」派出去，你不需要再逐条认领。",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		scope_use,
		handler: async () => {
			await controller.ensureLoaded();
			return { ok: true, board: snapshotForAgent(controller.getBoard()) };
		},
	});

	ctx.agent.registerTool<{
		title: string;
		detail?: string;
		cwd?: string;
		model?: string;
		priority?: 0 | 1 | 2;
		tags?: string[];
		ready?: boolean;
	}>(
		{
			id: "kanban-add",
			name: "kanban_add_task",
			label: "%tool.add.label%",
			description:
				"往灵感池里加一条需求。默认落为「草稿」（你不会去认领它，等用户完善）；只有在用户已经把需求说清楚、明确要你开工时才传 ready=true 落为「待认领」。",
			parameters: {
				type: "object",
				properties: {
					title: { type: "string", description: "一句话需求标题" },
					detail: { type: "string", description: "需求正文；派单时作为首轮 prompt 主体" },
					cwd: { type: "string", description: "目标项目绝对路径；不传则用看板默认项目" },
					model: {
						type: "string",
						description: "执行这条需求用的模型，格式 provider/modelId；不传则用看板默认模型。只在用户明确指定模型时才传。",
					},
					priority: { type: "number", enum: [0, 1, 2], description: "0=低 1=中 2=高" },
					tags: { type: "array", items: { type: "string" } },
					ready: { type: "boolean", description: "true = 直接落为「待认领」，可被认领" },
				},
				required: ["title"],
				additionalProperties: false,
			},
			scope_use,
			handler: async ({ trigger: { input } }) => {
				const title = typeof input?.title === "string" ? input.title.trim() : "";
				if (!title) return { ok: false, retryable: true, error: "title 不能为空" };
				await controller.ensureLoaded();
				const modelKey = typeof input?.model === "string" ? input.model.trim() : "";
				if (modelKey) {
					// 先校验再落卡：写进去一个不存在的模型，要等到派单当场才炸，那时卡片已经占了名额。
					try {
						await ctx.official.models.assertModelKeyExists(modelKey, "kanban_add_task");
					} catch (error) {
						return {
							ok: false,
							retryable: true,
							error: `模型 ${modelKey} 不可用：${error instanceof Error ? error.message : String(error)}`,
						};
					}
				}
				const board = controller.addCard({
					title,
					detail: input?.detail,
					cwd: input?.cwd,
					modelKey,
					priority: input?.priority,
					tags: input?.tags,
					ideaState: input?.ready === true ? "ready" : "draft",
				});
				const created = board.cards[board.cards.length - 1];
				return { ok: true, cardId: created.id, lane: created.lane, ideaState: created.ideaState };
			},
		},
	);

	ctx.agent.registerTool<{ cardId: string }>({
		id: "kanban-claim",
		name: "kanban_claim_task",
		label: "%tool.claim.label%",
		description:
			"认领一条「待认领」需求：看板会新建一个会话、把卡片推进「正在处理」，并把需求正文作为首轮 prompt 发出去，任务在后台独立执行。" +
			"被拒绝时按 reason 处理：wip-full = 名额满了，先等已有任务交付；blocked = 依赖的卡片还没进「待检查」，先做依赖；draft = 需求还是草稿，别碰。" +
			"你可以在名额允许时连续认领多条并行推进。",
		parameters: {
			type: "object",
			properties: { cardId: { type: "string", description: "kanban_list_tasks 返回的卡片 id" } },
			required: ["cardId"],
			additionalProperties: false,
		},
		scope_use,
		// 跨会话拉起独立的后台 agent 循环并产生模型计费，且描述鼓励批量认领；
		// 与 spawn_agent 不同，它不在本会话预算内、无 task_stop 可回收。
		side_effect: "heavy",
		handler: async ({ trigger: { input } }) => {
			const cardId = typeof input?.cardId === "string" ? input.cardId : "";
			if (!cardId) return { ok: false, retryable: true, error: "cardId 不能为空" };
			const result = await controller.dispatch(cardId, "agent");
			if (result.ok) {
				const card = findCard(controller.getBoard(), cardId);
				return {
					ok: true,
					cardId,
					sessionPath: card?.sessionPath,
					remainingSlots: snapshotForAgent(controller.getBoard()).remainingSlots,
					summary: `已认领「${card?.title ?? cardId}」并在后台开工。`,
				};
			}
			return {
				ok: false,
				// wip-full / blocked 是暂时性的：agent 等已有任务交付后可以再试。
				retryable: result.decision.ok === false && ["wip-full", "blocked"].includes(result.decision.reason),
				reason: result.decision.ok === false ? result.decision.reason : "unknown",
				error: result.message,
				board: snapshotForAgent(controller.getBoard()),
			};
		},
	});

	ctx.agent.registerTool<{ cardId: string; note: string }>({
		id: "kanban-submit",
		name: "kanban_submit_task",
		label: "%tool.submit.label%",
		description:
			"把一条「正在处理」的卡片提交到「待检查」，交还并发名额。note 里写清交付了什么、有哪些已知风险或未覆盖的点；" +
			"需求不清楚导致无法开工时同样提交，并在 note 里说明缺什么。不提交会一直占着名额。",
		parameters: {
			type: "object",
			properties: {
				cardId: { type: "string" },
				note: { type: "string", description: "交付说明，用户会在「待检查」里读到" },
			},
			required: ["cardId", "note"],
			additionalProperties: false,
		},
		scope_use,
		handler: async ({ trigger: { input } }) => {
			const cardId = typeof input?.cardId === "string" ? input.cardId : "";
			const note = typeof input?.note === "string" ? input.note : "";
			if (!cardId) return { ok: false, retryable: true, error: "cardId 不能为空" };
			await controller.ensureLoaded();
			if (!controller.submit(cardId, note)) {
				return {
					ok: false,
					retryable: false,
					error: `卡片 ${cardId} 不在「正在处理」泳道，无法提交。`,
					board: snapshotForAgent(controller.getBoard()),
				};
			}
			const snapshot = snapshotForAgent(controller.getBoard());
			return {
				ok: true,
				cardId,
				remainingSlots: snapshot.remainingSlots,
				// 交还名额后顺手告诉 agent 还有什么能接，省一次 list 往返。
				nextCandidates: dispatchableCards(controller.getBoard())
					.slice(0, 5)
					.map((card) => ({ id: card.id, title: card.title, priority: card.priority })),
			};
		},
	});
}
