import { describe, expect, it } from "vitest";
import { parsePromptRequest } from "./prompt-request-schema.js";

const absolute = process.platform === "win32" ? "C:\\work\\app\\a.ts" : "/work/app/a.ts";

describe("提示请求里的附件路径", () => {
	it("@ 选中的远端文件可以发送，交给模型的是远端上的绝对路径", () => {
		// 回归：校验只认本机绝对路径，选了远端文件后整条消息发不出去。
		const request = parsePromptRequest({
			text: "看看这个文件",
			attachments: [{ kind: "file", path: "ssh://host-1/srv/app/src/main.ts" }],
		});
		expect(request.attachments).toEqual([{ kind: "file", path: "/srv/app/src/main.ts" }]);
	});

	it("本机绝对路径原样保留，相对路径照旧拒绝", () => {
		expect(parsePromptRequest({ text: "x", attachments: [{ kind: "image", path: absolute }] }).attachments).toEqual([
			{ kind: "image", path: absolute },
		]);
		expect(() => parsePromptRequest({ text: "x", attachments: [{ kind: "file", path: "src/a.ts" }] })).toThrow(
			/must be absolute/,
		);
	});
});
