import type { IpcRenderer, IpcRendererEvent } from "electron";
import { ANNOTATION_CHANNELS, type AnnotationChanged } from "../../shared/message-annotations.js";
import type { DesktopApi } from "../api.js";

export function createMessageAnnotationsApi(ipc: IpcRenderer): Pick<DesktopApi, "messageAnnotations"> {
	return {
		messageAnnotations: {
			list: (runtimeId) => ipc.invoke(ANNOTATION_CHANNELS.LIST, runtimeId),
			ask: (runtimeId, input) => ipc.invoke(ANNOTATION_CHANNELS.ASK, runtimeId, input),
			cancel: (runtimeId, id) => ipc.invoke(ANNOTATION_CHANNELS.CANCEL, runtimeId, id),
			onChanged: (listener) => {
				const handler = (_event: IpcRendererEvent, event: AnnotationChanged) => listener(event);
				ipc.on(ANNOTATION_CHANNELS.CHANGED, handler);
				return () => {
					ipc.removeListener(ANNOTATION_CHANNELS.CHANGED, handler);
				};
			},
		},
	};
}
