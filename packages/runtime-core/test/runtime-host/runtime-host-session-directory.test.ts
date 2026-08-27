import { describe, expect, it } from "vitest";
import { RuntimeHostSessionDirectory } from "../../src/runtime-host/runtime-host-session-directory.js";
import type { RuntimeHostSessionRecord } from "../../src/runtime-host/types.js";

describe("RuntimeHostSessionDirectory", () => {
	it("keeps one stable key while the canonical Session identity changes", () => {
		const directory = new RuntimeHostSessionDirectory();
		const session = mutableHandle("source-session", "C:/sessions/source.jsonl");

		const sessionKey = directory.register("source-session", session.handle);
		session.setSessionId("continued-session");

		expect(directory.synchronizeIdentity(sessionKey, session.handle)).toEqual({
			sessionKey: "source-session",
			previousSessionId: "source-session",
			nextSessionId: "continued-session",
		});
		expect(directory.get("source-session")).toBe(session.handle);
		expect(directory.get("continued-session")).toBe(session.handle);
		expect(directory.readCanonicalSessionId("source-session")).toBe("continued-session");
	});

	it("rejects duplicate initial and continuation identities", () => {
		const directory = new RuntimeHostSessionDirectory();
		const first = handle("first");
		const second = mutableHandle("second");
		directory.register("first", first);
		directory.register("second", second.handle);

		expect(() => directory.register("first", handle("first"))).toThrow(
			"RuntimeHost Session id is already registered: first",
		);
		second.setSessionId("first");
		expect(() => directory.synchronizeIdentity("second", second.handle)).toThrow(
			"RuntimeHost Session identity is already registered: first",
		);
	});

	it("normalizes paths for active Session lookup", () => {
		const directory = new RuntimeHostSessionDirectory((path) => path.replaceAll("\\", "/").toLowerCase());
		const session = handle("session", "C:\\Sessions\\ONE.jsonl");
		directory.register("session", session);

		expect(directory.findBySessionPath("c:/sessions/one.jsonl")).toMatchObject({
			sessionKey: "session",
			sessionId: "session",
			handle: session,
		});
	});

	it("removes every identity only when the expected owner is still registered", () => {
		const directory = new RuntimeHostSessionDirectory();
		const session = mutableHandle("source");
		const sessionKey = directory.register("source", session.handle);
		session.setSessionId("continued");
		directory.synchronizeIdentity(sessionKey, session.handle);

		expect(directory.remove(sessionKey, handle("replacement"))).toBeUndefined();
		expect(directory.remove(sessionKey, session.handle)).toEqual({
			sessionKey: "source",
			canonicalSessionId: "continued",
			identities: ["source", "continued"],
		});
		expect(() => directory.get("source")).toThrow("Session not found: source");
		expect(() => directory.get("continued")).toThrow("Session not found: continued");
	});
});

function handle(sessionId: string, sessionPath?: string): RuntimeHostSessionRecord {
	return {
		lifecycle: {
			sessionId,
			sessionPath,
			dispose: async () => {},
		},
	} as unknown as RuntimeHostSessionRecord;
}

function mutableHandle(
	initialSessionId: string,
	sessionPath?: string,
): { readonly handle: RuntimeHostSessionRecord; setSessionId(sessionId: string): void } {
	let sessionId = initialSessionId;
	return {
		handle: {
			lifecycle: {
				get sessionId() {
					return sessionId;
				},
				sessionPath,
				dispose: async () => {},
			},
		} as unknown as RuntimeHostSessionRecord,
		setSessionId(nextSessionId) {
			sessionId = nextSessionId;
		},
	};
}
