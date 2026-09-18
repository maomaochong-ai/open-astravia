import { describe, expect, it } from "vitest";
import { applyPetPlaybackIntent, playbackCommandForNewWindow } from "./pet-playback-policy";

describe("applyPetPlaybackIntent", () => {
	it("still clears the paused flag after the pet window is destroyed", () => {
		expect(
			applyPetPlaybackIntent({
				paused: true,
				playing: true,
				windowOpen: false,
			}),
		).toEqual({ paused: false });
	});

	it("does not send a command when the desired state is already applied", () => {
		expect(
			applyPetPlaybackIntent({
				paused: true,
				playing: false,
				windowOpen: true,
			}),
		).toEqual({ paused: true });
	});

	it("pauses a live window on lock or suspend", () => {
		expect(
			applyPetPlaybackIntent({
				paused: false,
				playing: false,
				windowOpen: true,
			}),
		).toEqual({ paused: true, sendPlaying: false });
	});
});

describe("playbackCommandForNewWindow", () => {
	it("re-applies lock-screen pause when the pet window is created while locked", () => {
		expect(playbackCommandForNewWindow(true)).toEqual({ type: "set-playback", playing: false });
	});
});
