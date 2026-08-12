import { type IpcMainEvent, type IpcMainInvokeEvent, ipcMain, type WebContents } from "electron";
import { SPEECH_INPUT_CHANNELS } from "../../preload/apis/speech-input.js";
import { SpeechInputService } from "../speech-input/speech-input-service.js";

const MAX_AUDIO_SAMPLES_PER_MESSAGE = 32_000;

export function registerSpeechInputIpc(webContents: WebContents): () => void {
	const service = new SpeechInputService({
		sendEvent: (event) => {
			if (!webContents.isDestroyed()) webContents.send(SPEECH_INPUT_CHANNELS.EVENT, event);
		},
	});
	const assertAuthorizedSender = (event: IpcMainEvent | IpcMainInvokeEvent): void => {
		if (
			event.sender.id !== webContents.id ||
			(event.senderFrame !== null && event.senderFrame !== event.senderFrame.top)
		)
			throw new Error("Unauthorized speech input sender");
	};

	ipcMain.handle(SPEECH_INPUT_CHANNELS.GET_STATUS, (event) => {
		assertAuthorizedSender(event);
		return service.getStatus();
	});
	ipcMain.handle(SPEECH_INPUT_CHANNELS.START, (event) => {
		assertAuthorizedSender(event);
		return service.start();
	});
	const handleAudio = (event: IpcMainEvent, sessionId: unknown, samples: unknown): void => {
		assertAuthorizedSender(event);
		if (
			typeof sessionId !== "string" ||
			!(samples instanceof Float32Array) ||
			samples.length > MAX_AUDIO_SAMPLES_PER_MESSAGE
		)
			return;
		service.pushAudio(sessionId, samples);
	};
	ipcMain.on(SPEECH_INPUT_CHANNELS.AUDIO, handleAudio);
	ipcMain.handle(SPEECH_INPUT_CHANNELS.STOP, (event, sessionId: unknown) => {
		assertAuthorizedSender(event);
		return typeof sessionId === "string" ? service.stop(sessionId) : undefined;
	});
	ipcMain.handle(SPEECH_INPUT_CHANNELS.CANCEL, (event, sessionId: unknown) => {
		assertAuthorizedSender(event);
		return typeof sessionId === "string" ? service.cancel(sessionId) : undefined;
	});

	return () => {
		service.dispose();
		ipcMain.removeListener(SPEECH_INPUT_CHANNELS.AUDIO, handleAudio);
		for (const channel of Object.values(SPEECH_INPUT_CHANNELS)) {
			if (channel !== SPEECH_INPUT_CHANNELS.AUDIO && channel !== SPEECH_INPUT_CHANNELS.EVENT) {
				ipcMain.removeHandler(channel);
			}
		}
	};
}
