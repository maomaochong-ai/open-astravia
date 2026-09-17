import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

describe("useSessionManager mount boundary", () => {
	it("keeps ChatPage and the new-session page on the shared session manager refs", () => {
		const chatPage = readFileSync(join(here, "../components/ChatPage.tsx"), "utf8");
		const newSessionPage = readFileSync(join(here, "../components/new-session/useNewSessionPageModel.ts"), "utf8");

		expect(chatPage).not.toMatch(/from ["'][^"']*useSessionManager["']/);
		expect(chatPage).toContain("sendMessageFnRef");
		expect(newSessionPage).not.toMatch(/from ["'][^"']*useSessionManager["']/);
		expect(newSessionPage).toContain("openSessionFnRef");
	});
});
