// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { LAST_ACTIVE_SESSION_STORAGE_KEY, readLastActiveSession } from "../shared/store/last-active-session-storage";
import { preloadStartupPage } from "./preload-startup-page";

const pages = vi.hoisted(() => ({ chat: vi.fn(), newSession: vi.fn() }));
vi.mock("../route-page-loaders", () => ({ loadChatPage: pages.chat, loadNewSessionPage: pages.newSession }));
afterEach(() => {
	localStorage.clear();
	vi.clearAllMocks();
});

it("preloads a new conversation, preserves a saved session on reload, and respects an explicit new-session route", async () => {
	await preloadStartupPage("");
	expect(pages.newSession).toHaveBeenCalledOnce();
	expect(pages.chat).not.toHaveBeenCalled();
	const saved = { cwd: "/work", sessionPath: "/history/session.jsonl" };
	localStorage.setItem(LAST_ACTIVE_SESSION_STORAGE_KEY, JSON.stringify(saved));
	await preloadStartupPage("#/");
	expect(pages.chat).toHaveBeenCalledOnce();
	expect(readLastActiveSession()).toEqual(saved);
	await preloadStartupPage("#/new-session?cwd=%2Fwork");
	expect(pages.newSession).toHaveBeenCalledTimes(2);
	expect(readLastActiveSession()).toEqual(saved);
});

it.each(["{", "null", '{"cwd":"/work"}', '{"cwd":"","sessionPath":"p"}'])(
	"uses the existing invalid-session recovery for %s",
	async (saved) => {
		localStorage.setItem(LAST_ACTIVE_SESSION_STORAGE_KEY, saved);
		await preloadStartupPage("#/");
		expect(pages.newSession).toHaveBeenCalledOnce();
		expect(localStorage.getItem(LAST_ACTIVE_SESSION_STORAGE_KEY)).toBeNull();
	},
);

it("leaves other routes alone and lets a failed speculative import fall back to normal boot", async () => {
	await preloadStartupPage("#/settings/general");
	expect(pages.chat).not.toHaveBeenCalled();
	expect(pages.newSession).not.toHaveBeenCalled();
	pages.newSession.mockRejectedValueOnce(new Error("temporary dev server error"));
	await expect(preloadStartupPage("#/new-session/work")).resolves.toBeUndefined();
});
