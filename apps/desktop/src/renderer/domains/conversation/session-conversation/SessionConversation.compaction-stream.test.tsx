// @vitest-environment jsdom
import { activeSessionAtom } from "@shared/store/atoms";
import { act, cleanup, render } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindConversationFeed, dispatchConversationFeed, resetConversationFeed } from "../services/conversation-feed-store";
import { SessionConversation } from "./SessionConversation";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("../hooks/useSkillTokenMeta", () => ({ useSkillTokenMeta: () => () => undefined }));
// jsdom 没有布局：只替换虚拟列表，按 Virtuoso 的方式把 data 逐项渲染出来。
vi.mock("react-virtuoso", () => ({
	Virtuoso: ({
		data,
		firstItemIndex = 0,
		itemContent,
		computeItemKey,
	}: {
		data: readonly unknown[];
		firstItemIndex?: number;
		itemContent: (index: number, item: never) => ReactNode;
		computeItemKey: (index: number, item: never) => string;
	}) => (
		<div>
			{data.map((item, position) => {
				const index = firstItemIndex + position;
				return (
					<div key={computeItemKey(index, item as never)} data-item-index={index}>
						{itemContent(index, item as never)}
					</div>
				);
			})}
		</div>
	),
}));

const B = { cwd: "/project", sessionPath: "/history/b.jsonl", runtimeId: "runtime-b" };

/** 一段压缩摘要的增量：标题、列表、行内代码、表格、代码块、引用，逐段到达。 */
const DELTAS = [
	"## 已完成的工作\n\n",
	"- **登录** 流程收尾，`auth/session.ts` 改成滑动续期\n",
	"- 会话列表分页改成游标，删掉了全量拉取\n",
	"- 埋点补齐 `turn_id`\n\n",
	"## 关键决策\n\n",
	"> 备注：续期窗口固定 30 天，不做滚动叠加。\n\n",
	"| 字段 | 说明 |\n| --- | --- |\n| `turn_id` | 每轮唯一 |\n| `session_id` | 会话唯一 |\n\n",
	"## 待确认\n\n",
	"1. 续期失败要不要弹提示\n2. 分页游标过期后的回退\n\n",
	"```ts\nexport function renew(session: Session): Session {\n\treturn { ...session, expiresAt: Date.now() + WINDOW };\n}\n```\n\n",
	"## 结论\n\n压缩后保留上面的结论，可以直接开工。\n",
];

function summaryAt(count: number): string {
	let text = "";
	for (let index = 0; index < count; index += 1) text += DELTAS[index % DELTAS.length];
	return text;
}

beforeEach(() => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	Object.assign(window, {
		astravia: {
			messageAnnotations: { list: async () => [], ask: vi.fn(), cancel: vi.fn(), onChanged: () => () => {} },
			session: { listSandboxGrants: async () => [] },
			models: { get: async () => ({ providers: {} }), fetchRemote: async () => ({ providers: {} }) },
			markdown: { favicon: async () => null },
		},
	});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

/** 把画布上的会话开到「有一个进行中的 Turn」的状态。 */
async function openRunningTurn(store: ReturnType<typeof createStore>) {
	render(
		<Provider store={store}>
			<SessionConversation sessionId={B.sessionPath} workspace={{ id: "/project", cwd: "/project", runtimeIds: [] }} />
		</Provider>,
	);
	await act(async () => {
		resetConversationFeed(store);
		bindConversationFeed(B.runtimeId, store);
		store.set(activeSessionAtom, B);
		dispatchConversationFeed(
			{ type: "feed.attached", runtimeId: B.runtimeId, items: [], revision: 1 },
			store,
		);
		dispatchConversationFeed(
			{
				type: "runtime.events",
				runtimeId: B.runtimeId,
				events: [{ type: "conversation.turn.started", turnId: "t1", timestamp: 1, sequence: 1 }] as never,
			},
			store,
		);
	});
}

describe("紧凑步的摘要在流式增长时不会把渲染推进死循环", () => {
	it("每条 delta 一次刷新，从头跑到结束再到 success", async () => {
		const errors: string[] = [];
		vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
			errors.push(args.map((value) => String(value)).join(" "));
		});
		const store = createStore();
		await openRunningTurn(store);

		await act(async () => {
			dispatchConversationFeed(
				{
					type: "runtime.events",
					runtimeId: B.runtimeId,
					events: [
						{
							type: "compaction.start",
							sessionId: B.runtimeId,
							eventId: "c1",
							timestamp: 2,
							reason: "threshold",
							source: "agent",
						},
					] as never,
				},
				store,
			);
		});

		for (let index = 1; index <= 60; index += 1) {
			const already = summaryAt(index - 1);
			const full = summaryAt(index);
			await act(async () => {
				dispatchConversationFeed(
					{
						type: "runtime.events",
						runtimeId: B.runtimeId,
						events: [
							{
								type: "compaction.delta",
								sessionId: B.runtimeId,
								eventId: `c1-${index}`,
								timestamp: 3 + index,
								text: full.slice(already.length),
							},
						] as never,
					},
					store,
				);
			});
		}

		await act(async () => {
			dispatchConversationFeed(
				{
					type: "runtime.events",
					runtimeId: B.runtimeId,
					events: [
						{
							type: "compaction.end",
							sessionId: B.runtimeId,
							eventId: "c1-end",
							timestamp: 99,
							success: true,
							reason: "threshold",
							summary: summaryAt(60),
							tokensBefore: 120_000,
						},
					] as never,
				},
				store,
			);
		});

		expect(errors.filter((message) => message.includes("Maximum update depth"))).toEqual([]);
	}, 30_000);

	it("一批 delta 在同一次刷新里到达也不循环", async () => {
		const errors: string[] = [];
		vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
			errors.push(args.map((value) => String(value)).join(" "));
		});
		const store = createStore();
		await openRunningTurn(store);

		await act(async () => {
			dispatchConversationFeed(
				{
					type: "runtime.events",
					runtimeId: B.runtimeId,
					events: [
						{
							type: "compaction.start",
							sessionId: B.runtimeId,
							eventId: "c1",
							timestamp: 2,
							reason: "threshold",
							source: "agent",
						},
					] as never,
				},
				store,
			);
		});

		// 重挂或追上积压时，多批 delta 会挤进同一次 store 写入。
		await act(async () => {
			const events = Array.from({ length: 80 }, (_, index) => {
				const already = summaryAt(index);
				const full = summaryAt(index + 1);
				return {
					type: "compaction.delta",
					sessionId: B.runtimeId,
					eventId: `c1-${index}`,
					timestamp: 3 + index,
					text: full.slice(already.length),
				};
			});
			dispatchConversationFeed({ type: "runtime.events", runtimeId: B.runtimeId, events: events as never }, store);
		});

		expect(errors.filter((message) => message.includes("Maximum update depth"))).toEqual([]);
	}, 30_000);
});
