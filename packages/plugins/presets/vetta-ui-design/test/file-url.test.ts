import { expect, it } from "vitest";
import { toVettaFileUrl } from "../src/cards/file-url";

it("converts a Windows path into a valid vetta-file URL", () => {
	const url = toVettaFileUrl(String.raw`C:\Users\flowerwine\.vetta\conversation\frame 1.png`);

	expect(url).toBe("vetta-file://local/C:/Users/flowerwine/.vetta/conversation/frame%201.png");
	expect(new URL(url)).toMatchObject({ host: "local", pathname: "/C:/Users/flowerwine/.vetta/conversation/frame%201.png" });
});

it("preserves the leading separator of a POSIX path", () => {
	expect(toVettaFileUrl("/home/user/frame.png")).toBe("vetta-file://local/home/user/frame.png");
});
