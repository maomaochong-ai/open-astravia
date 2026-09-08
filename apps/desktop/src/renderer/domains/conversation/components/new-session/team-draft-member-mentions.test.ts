import { describe, expect, it } from "vitest";
import { rebaseTeamDraftMemberMentions } from "./team-draft-member-mentions";

const mention = { participantId: "member-1", handle: "research", start: 0, end: 9 } as const;

describe("rebaseTeamDraftMemberMentions", () => {
	it("keeps and shifts a mention when ordinary text changes around it", () => {
		expect(rebaseTeamDraftMemberMentions("@research review", "Please @research review", [mention])).toEqual([
			{ ...mention, start: 7, end: 16 },
		]);
		expect(rebaseTeamDraftMemberMentions("@research review", "@research review this", [mention])).toEqual([mention]);
	});

	it("drops the routing annotation when the mention text is edited", () => {
		expect(rebaseTeamDraftMemberMentions("@research review", "@researcher review", [mention])).toEqual([]);
		expect(rebaseTeamDraftMemberMentions("@research review", "review", [mention])).toEqual([]);
	});

	it("ignores stale or malformed annotations", () => {
		expect(
			rebaseTeamDraftMemberMentions("plain text", "plain text", [
				{ participantId: "member-1", handle: "research", start: 0, end: 9 },
			]),
		).toEqual([]);
	});
});
