import { describe, expect, it } from "vitest";
import { reclaimableSupersededSessionPath } from "./superseded-session-reclaim";

describe("reclaimableSupersededSessionPath", () => {
	it("reclaims the empty shell this open just created", () => {
		expect(
			reclaimableSupersededSessionPath({ isExistingSessionOpen: false, sessionPath: "/sessions/new.jsonl" }),
		).toBe("/sessions/new.jsonl");
	});

	it("never reclaims an existing conversation the user opened", () => {
		// create 返回的是用户已有的对话文件；删掉它就会连带删掉整个会话。
		expect(
			reclaimableSupersededSessionPath({
				isExistingSessionOpen: true,
				sessionPath: "/sessions/existing.jsonl",
			}),
		).toBeUndefined();
	});

	it("has nothing to reclaim when create reported no path", () => {
		expect(
			reclaimableSupersededSessionPath({ isExistingSessionOpen: false, sessionPath: undefined }),
		).toBeUndefined();
		expect(reclaimableSupersededSessionPath({ isExistingSessionOpen: false, sessionPath: "" })).toBeUndefined();
	});
});
