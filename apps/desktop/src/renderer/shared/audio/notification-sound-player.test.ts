import { beforeEach, describe, expect, it, vi } from "vitest";

const audio = {
	pause: vi.fn(),
	play: vi.fn(() => Promise.resolve()),
	currentTime: 10,
	src: "",
	volume: 1,
};

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	audio.currentTime = 10;
	audio.src = "";
	audio.volume = 1;
	vi.stubGlobal(
		"Audio",
		vi.fn(() => audio),
	);
	vi.stubGlobal("btoa", (value: string) => Buffer.from(value, "binary").toString("base64"));
});

describe("notification sound player", () => {
	it("reuses one player and stops the previous cue before playing the next", async () => {
		const { playNotificationSound } = await import("./notification-sound-player.js");
		await playNotificationSound("soft-chime", 60);
		await playNotificationSound("wood-tap", 25);
		expect(Audio).toHaveBeenCalledTimes(1);
		expect(audio.pause).toHaveBeenCalledTimes(2);
		expect(audio.play).toHaveBeenCalledTimes(2);
		expect(audio.volume).toBe(0.25);
		expect(audio.src).toMatch(/^data:audio\/wav;base64,/);
	});

	it("does not reject when the browser blocks playback", async () => {
		audio.play.mockRejectedValueOnce(new Error("blocked"));
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const { playNotificationSound } = await import("./notification-sound-player.js");
		await expect(playNotificationSound("digital-pulse", 200)).resolves.toBeUndefined();
		expect(audio.volume).toBe(1);
		expect(warn).toHaveBeenCalled();
	});
});
