import { describe, expect, it } from "vitest";
import { isBusyFileError } from "./manager.js";

/**
 * 「重新获取运行时」在 Windows 上撞到 `node.exe` 被占用时，主进程会做有限重试，
 * 仍失败则抛 `runtime-in-use:<type>` 让渲染层换成可执行提示。这个判定是那条链路的
 * 唯一依据：认错了错误码就退化成把系统原文丢给用户。
 */
describe("isBusyFileError", () => {
	it("把占用类错误码判为「被占用」", () => {
		for (const code of ["EPERM", "EBUSY", "ENOTEMPTY", "EACCES"]) {
			expect(isBusyFileError(Object.assign(new Error("x"), { code }))).toBe(true);
		}
	});

	it("网络与磁盘错误不属于占用，不该触发重试", () => {
		for (const code of ["ENOENT", "ECONNRESET", "ENOSPC"]) {
			expect(isBusyFileError(Object.assign(new Error("x"), { code }))).toBe(false);
		}
		expect(isBusyFileError(new Error("plain"))).toBe(false);
		expect(isBusyFileError(undefined)).toBe(false);
	});
});
