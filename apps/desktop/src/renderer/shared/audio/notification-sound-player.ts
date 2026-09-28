import type { BuiltinNotificationSoundId } from "@preload/api";

let player: HTMLAudioElement | null = null;
const urls = new Map<BuiltinNotificationSoundId, string>();

function writeAscii(view: DataView, offset: number, text: string): void {
	for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
}

function envelope(time: number, duration: number, attack = 0.015): number {
	return Math.min(1, time / attack) * Math.max(0, 1 - time / duration);
}

function sampleSound(soundId: BuiltinNotificationSoundId, time: number): number {
	switch (soundId) {
		case "soft-chime": {
			const first = Math.sin(2 * Math.PI * 660 * time) * envelope(time, 0.5);
			const secondTime = Math.max(0, time - 0.11);
			const second = time >= 0.11 ? Math.sin(2 * Math.PI * 880 * secondTime) * envelope(secondTime, 0.39) : 0;
			return (first + second) * 0.35;
		}
		case "single-bell":
			return (
				(Math.sin(2 * Math.PI * 740 * time) + Math.sin(2 * Math.PI * 1480 * time) * 0.35) *
				Math.exp(-7 * time) *
				0.55
			);
		case "wood-tap":
			return Math.sin(2 * Math.PI * (190 - time * 120) * time) * Math.exp(-24 * time) * 0.75;
		case "digital-pulse":
			return (
				(Math.sin(2 * Math.PI * (time < 0.12 ? 520 : 780) * time) >= 0 ? 0.32 : -0.32) *
				Math.max(0, 1 - time / 0.32)
			);
	}
}

function createSoundUrl(soundId: BuiltinNotificationSoundId): string {
	const cached = urls.get(soundId);
	if (cached) return cached;
	const sampleRate = 8_000;
	const duration = soundId === "soft-chime" || soundId === "single-bell" ? 0.5 : 0.32;
	const sampleCount = Math.floor(sampleRate * duration);
	const buffer = new ArrayBuffer(44 + sampleCount * 2);
	const view = new DataView(buffer);
	writeAscii(view, 0, "RIFF");
	view.setUint32(4, 36 + sampleCount * 2, true);
	writeAscii(view, 8, "WAVEfmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	writeAscii(view, 36, "data");
	view.setUint32(40, sampleCount * 2, true);
	for (let index = 0; index < sampleCount; index += 1) {
		view.setInt16(44 + index * 2, Math.round(sampleSound(soundId, index / sampleRate) * 32767), true);
	}
	const bytes = new Uint8Array(buffer);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	const url = `data:audio/wav;base64,${btoa(binary)}`;
	urls.set(soundId, url);
	return url;
}

/** Play one short built-in cue. A new cue always replaces the previous cue. */
export async function playNotificationSound(soundId: BuiltinNotificationSoundId, volume: number): Promise<void> {
	player ??= new Audio();
	player.pause();
	player.currentTime = 0;
	player.src = createSoundUrl(soundId);
	player.volume = Math.max(0, Math.min(1, volume / 100));
	try {
		await player.play();
	} catch (error) {
		console.warn("[NotificationSound] playback failed", error);
	}
}
