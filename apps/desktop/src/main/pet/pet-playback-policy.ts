export function applyPetPlaybackIntent(input: { paused: boolean; playing: boolean; windowOpen: boolean }): {
	paused: boolean;
	sendPlaying?: boolean;
} {
	const nextPaused = !input.playing;
	if (input.paused === nextPaused) {
		return { paused: nextPaused };
	}
	if (!input.windowOpen) {
		return { paused: nextPaused };
	}
	return { paused: nextPaused, sendPlaying: input.playing };
}

export function playbackCommandForNewWindow(paused: boolean): { type: "set-playback"; playing: boolean } {
	return { type: "set-playback", playing: !paused };
}
