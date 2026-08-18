import type { IpcRenderer } from "electron";
import type { DesktopApi } from "../api.js";
import { onIpcEvent } from "./helper.js";

export const SPEECH_INPUT_CHANNELS = {
	GET_STATUS: "vetta:speech-input:get-status",
	START: "vetta:speech-input:start",
	AUDIO: "vetta:speech-input:audio",
	STOP: "vetta:speech-input:stop",
	CANCEL: "vetta:speech-input:cancel",
	EVENT: "vetta:speech-input:event",
} as const;

export function createSpeechInputApi(ipc: IpcRenderer): Pick<DesktopApi, "speechInput"> {
	return {
		speechInput: {
			getStatus: () => ipc.invoke(SPEECH_INPUT_CHANNELS.GET_STATUS),
			start: () => ipc.invoke(SPEECH_INPUT_CHANNELS.START),
			pushAudio: (sessionId, samples) => ipc.send(SPEECH_INPUT_CHANNELS.AUDIO, sessionId, samples),
			stop: (sessionId) => ipc.invoke(SPEECH_INPUT_CHANNELS.STOP, sessionId),
			cancel: (sessionId) => ipc.invoke(SPEECH_INPUT_CHANNELS.CANCEL, sessionId),
			onEvent: (handler) => onIpcEvent(ipc, SPEECH_INPUT_CHANNELS.EVENT, handler),
		},
	};
}
