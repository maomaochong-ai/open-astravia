// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { DEFAULT_CONVERSATION_FILTER_OPTIONS } from "./useSidebarFilterSelectModel";

describe("default conversation source options", () => {
	it("offers Agent Teams inside the conversation dropdown", () => {
		expect(DEFAULT_CONVERSATION_FILTER_OPTIONS.map((option) => option.value)).toEqual([
			"conversation",
			"team",
			"claw",
		]);
	});
});
