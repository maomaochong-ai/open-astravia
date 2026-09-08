// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { DEFAULT_CONVERSATION_FILTER_OPTIONS } from "./useSidebarFilterSelectModel";

describe("default conversation source options", () => {
	it("keeps Agent Teams inside their projected conversation lists", () => {
		expect(DEFAULT_CONVERSATION_FILTER_OPTIONS.map((option) => option.value)).toEqual(["conversation", "claw"]);
	});
});
