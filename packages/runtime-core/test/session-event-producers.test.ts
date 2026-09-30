import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SessionEvent } from "../src/contracts.js";

type RuntimeSessionEventType = Exclude<SessionEvent, { readonly channel: "assistant" }>["type"];

interface SessionEventProducer {
	/** Source file, relative to `packages/runtime-core/src`, that constructs the event. */
	readonly file: string;
	/** The `type` literal written there when the event is built from an observation of another name. */
	readonly literal?: string;
}

/**
 * Every Runtime SessionEvent type and where it is produced.
 *
 * `satisfies Record<…>` keeps this exhaustive: adding an event type to the contract
 * fails to compile until its producer is named here, and an event type removed from
 * the contract must be removed here too. The test below checks that each named file
 * really constructs the event, so a type whose producer disappears cannot linger in
 * the contract while consumers keep branching on it.
 */
const SESSION_EVENT_PRODUCERS = {
	"session.lifecycle": { file: "kernel/stateless-agent-core-turn-engine.ts", literal: "lifecycle" },
	"session.context.state": { file: "session-context-state.ts" },
	"session.path_changed": { file: "runtime-host/kernel-session-events.ts" },
	"conversation.turn.started": { file: "runtime-host/kernel-session-events.ts" },
	"conversation.turn.completed": { file: "runtime-host/kernel-session-events.ts" },
	"conversation.turn.cancelled": { file: "runtime-host/kernel-session-events.ts" },
	"conversation.turn.failed": { file: "runtime-host/kernel-session-events.ts" },
	"conversation.message.appended": { file: "runtime-host/kernel-session-events.ts" },
	"model.request.started": { file: "kernel/stateless-agent-core-turn-engine.ts" },
	"tool.start": { file: "kernel/stateless-agent-core-turn-engine.ts" },
	"tool.update": { file: "kernel/stateless-agent-core-turn-engine.ts" },
	"tool.phase": { file: "kernel/stateless-agent-core-turn-engine.ts" },
	"tool.end": { file: "kernel/stateless-agent-core-turn-engine.ts" },
	"usage.update": { file: "runtime-host/kernel-session-events.ts" },
	error: { file: "runtime-host/kernel-session-events.ts" },
	"session.extension": { file: "session-extensions/contracts.ts" },
	active_tools_update: { file: "runtime-host/runtime-host-session-event-relay.ts" },
	"compaction.start": { file: "runtime-host/composed-runtime-factory.ts" },
	"compaction.end": { file: "kernel/turn-pipeline.ts" },
	"retry.start": { file: "runtime-host/session-retry.ts" },
	"retry.end": { file: "runtime-host/session-retry.ts" },
	"queue.changed": { file: "runtime-host/kernel-session-events.ts" },
} satisfies Record<RuntimeSessionEventType, SessionEventProducer>;

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

describe("SessionEvent contract", () => {
	it.each(Object.entries(SESSION_EVENT_PRODUCERS) as Array<[RuntimeSessionEventType, SessionEventProducer]>)(
		"%s has a producer",
		(type, producer) => {
			const source = readFileSync(new URL(`../src/${producer.file}`, import.meta.url), "utf8");
			const literal = producer.literal ?? type;
			expect(source).toMatch(new RegExp(`type:\\s*"${escapeRegExp(literal)}"`, "u"));
		},
	);
});
