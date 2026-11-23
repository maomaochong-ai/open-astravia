import { describe, expect, it } from "vitest";
import type {
	CodingAgentCustomMessageEntry,
	CodingAgentSessionHeader,
	CodingAgentSessionMessageEntry,
} from "../../src/sessions/contracts/session-entry.js";
import { branchFromFileEntries, entriesToHistory } from "../../src/sessions/projection/session-history.js";

/**
 * 用户消息的 ‹ i/n › 版本切换依赖 edit branch parent 分组。
 *
 * 这条链路原来对每条用户消息都重扫全量用户消息、逐条回溯父链；改成预建索引后，
 * 语义必须一模一样：跨「透明节点」（技能展开 / 设置变更）仍能找到同一个分支点，
 * 并列版本按时间排序，子孙分支不算并列。
 */
// 会话头必须是完整的 CodingAgentSessionHeader（cwd 是必填项）：缺字段时整份数组都
// 无法赋给 CodingAgentSessionEntry[]，类型检查会在 CI 上直接拦下。
const HEADER: CodingAgentSessionHeader = {
	type: "session",
	id: "root",
	timestamp: "2026-01-01T00:00:00.000Z",
	cwd: "/workspace",
};

/** 消息条目要满足 CodingAgentSessionMessageEntry：message 必须是完整的 AgentMessage（含 timestamp）。 */
function userMessage(
	id: string,
	parentId: string | null,
	minute: number,
	text: string,
): CodingAgentSessionMessageEntry {
	const at = Date.UTC(2026, 0, 1, 0, minute);
	return {
		type: "message",
		id,
		parentId,
		timestamp: new Date(at).toISOString(),
		message: { role: "user", content: text, timestamp: at },
	};
}

function assistantMessage(id: string, parentId: string | null, minute: number): CodingAgentSessionMessageEntry {
	const at = Date.UTC(2026, 0, 1, 0, minute);
	return {
		type: "message",
		id,
		parentId,
		timestamp: new Date(at).toISOString(),
		// AssistantMessage 是完整的信封：缺 api/provider/model/usage/stopReason 就不是
		// 合法消息，哪怕只是测试夹具。
		message: {
			role: "assistant",
			content: [{ type: "text", text: `回复 ${id}` }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "test-model",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: at,
		},
	};
}

/** 透明节点：custom_message 同样必须满足会话条目契约（含 display）。 */
function skillExpansion(id: string, parentId: string, minute: number): CodingAgentCustomMessageEntry {
	return {
		type: "custom_message",
		id,
		parentId,
		timestamp: new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString(),
		customType: "skill_expansion",
		content: '<skill name="demo">x</skill>',
		display: false,
	};
}

describe("entriesToHistory branch metadata", () => {
	it("groups edited versions that sit behind transparent nodes", () => {
		// 同一分支点下有 3 个版本，每个版本后面都跟一条透明节点再是回复。
		const versions = [
			userMessage("u1", "root", 1, "第一版"),
			userMessage("u2", "root", 3, "第二版"),
			userMessage("u3", "root", 5, "第三版"),
		];
		const all = [
			...versions,
			skillExpansion("t1", "u1", 2),
			skillExpansion("t2", "u2", 4),
			skillExpansion("t3", "u3", 6),
			assistantMessage("a1", "t1", 2),
			assistantMessage("a2", "t2", 4),
			assistantMessage("a3", "t3", 6),
		];

		const history = entriesToHistory([versions[1], all[3], all[6]], { allEntries: all });
		const user = history.find((entry) => entry.type === "message" && entry.message.role === "user");

		expect(user?.type).toBe("message");
		if (user?.type !== "message") return;
		expect(user.branch?.siblings).toEqual(["u1", "u2", "u3"]);
		// 第二版在按时间排序后的位置
		expect(user.branch?.index).toBe(1);
	});

	it("does not treat a descendant branch as a sibling version", () => {
		// u2 是 u1 的后代（编辑后继续对话），不属于并列版本。
		const all = [
			userMessage("u1", "root", 1, "原始"),
			assistantMessage("a1", "u1", 2),
			userMessage("u2", "a1", 3, "续问"),
			assistantMessage("a2", "u2", 4),
		];

		const history = entriesToHistory([all[3], all[2], all[1], all[0]], { allEntries: all });
		const users = history.filter((entry) => entry.type === "message" && entry.message.role === "user");

		// 两条用户消息分属不同分支点，各自是唯一版本。
		for (const entry of users) {
			if (entry.type !== "message") continue;
			expect(entry.branch?.siblings).toEqual([entry.entryId]);
			expect(entry.branch?.index).toBe(0);
		}
	});

	it("leaves branch metadata off when allEntries is not provided", () => {
		const all = [userMessage("u1", "root", 1, "唯一")];
		const history = entriesToHistory([all[0]]);
		const [entry] = history;
		expect(entry?.type).toBe("message");
		if (entry?.type !== "message") return;
		expect(entry.branch).toBeUndefined();
	});

	it("keeps the same leaf when reconstructing the branch from flat entries", () => {
		// branchFromFileEntries 只接受条目（含会话头，它按 type 跳过），但 allEntries
		// 要的是不含会话头的列表，所以两者分开传。
		const entries = [
			userMessage("u1", "root", 1, "原始"),
			userMessage("u2", "root", 3, "改写"),
			assistantMessage("a2", "u2", 4),
		];
		const all = [HEADER, ...entries];

		const branch = branchFromFileEntries(all);

		expect(branch.map((entry) => entry.id)).toEqual(["u2", "a2"]);
		const history = entriesToHistory(branch, { allEntries: entries });
		expect(history).toHaveLength(2);
	});
});
