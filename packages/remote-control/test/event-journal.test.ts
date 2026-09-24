import { describe, expect, it } from "vitest";
import type { RemoteEvent } from "../src/index.js";
import { RemoteEventJournal } from "../src/index.js";

function event(sequence: number): RemoteEvent {
	return { type: "event", eventId: `e${sequence}`, sequence, name: "session.state" };
}

describe("RemoteEventJournal", () => {
	it("replays only what the peer has not seen", () => {
		const journal = new RemoteEventJournal();
		for (let index = 0; index < 5; index += 1) journal.remember(event(journal.nextSequence()));
		expect(journal.replay(3)?.map((entry) => entry.sequence)).toEqual([4, 5]);
		expect(journal.replay(5)).toEqual([]);
	});

	it("drops acknowledged events but can still answer a resume behind the ack", () => {
		const journal = new RemoteEventJournal();
		for (let index = 0; index < 4; index += 1) journal.remember(event(journal.nextSequence()));
		journal.acknowledge(2);
		expect(journal.replay(2)?.map((entry) => entry.sequence)).toEqual([3, 4]);
		expect(journal.replay(1)).toBeUndefined();
	});

	it("reports a lost tail when the peer has seen more than this journal ever held", () => {
		const journal = new RemoteEventJournal();
		journal.remember(event(journal.nextSequence()));
		expect(journal.replay(40)).toBeUndefined();
	});

	it("reports an evicted tail when the peer is too far behind by count", () => {
		const journal = new RemoteEventJournal({ capacity: 3 });
		for (let index = 0; index < 6; index += 1) journal.remember(event(journal.nextSequence()));
		expect(journal.replay(2)).toBeUndefined();
		expect(journal.replay(3)?.map((entry) => entry.sequence)).toEqual([4, 5, 6]);
	});

	it("reports an evicted tail when kept events are older than the age bound", () => {
		let now = 0;
		const journal = new RemoteEventJournal({ maxAgeMs: 1_000, now: () => now });
		journal.remember(event(journal.nextSequence()));
		now = 500;
		journal.remember(event(journal.nextSequence()));
		now = 1_400;
		expect(journal.replay(0)).toBeUndefined();
		expect(journal.replay(1)?.map((entry) => entry.sequence)).toEqual([2]);
	});
});
