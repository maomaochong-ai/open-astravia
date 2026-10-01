import { expect, it } from "vitest";
import { toAstraviaFileUrl } from "../src/cards/file-url";

it("converts a Windows path into a valid astravia-file URL", () => {
	const url = toAstraviaFileUrl(String.raw`C:\Users\flowerwine\.astravia\conversation\frame 1.png`);

	expect(url).toBe("astravia-file://local/C:/Users/flowerwine/.astravia/conversation/frame%201.png");
	expect(new URL(url)).toMatchObject({ host: "local", pathname: "/C:/Users/flowerwine/.astravia/conversation/frame%201.png" });
});

it("preserves the leading separator of a POSIX path", () => {
	expect(toAstraviaFileUrl("/home/user/frame.png")).toBe("astravia-file://local/home/user/frame.png");
});
