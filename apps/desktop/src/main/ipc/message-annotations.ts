import { ipcMain, type WebContents } from "electron";
import { z } from "zod";
import { ANNOTATION_CHANNELS, annotationAskSchema } from "../../shared/message-annotations.js";
import type { MessageAnnotationService } from "../message-annotations/service.js";

const runtimeIdSchema = z.string().min(1).max(256);
export function registerMessageAnnotationsIpc(webContents: WebContents, service: MessageAnnotationService): () => void {
	ipcMain.handle(ANNOTATION_CHANNELS.LIST, (_event, runtimeId: unknown) =>
		service.list(runtimeIdSchema.parse(runtimeId)),
	);
	ipcMain.handle(ANNOTATION_CHANNELS.ASK, (_event, runtimeId: unknown, input: unknown) =>
		service.ask(runtimeIdSchema.parse(runtimeId), annotationAskSchema.parse(input)),
	);
	ipcMain.handle(ANNOTATION_CHANNELS.CANCEL, (_event, runtimeId: unknown, id: unknown) =>
		service.cancel(runtimeIdSchema.parse(runtimeId), z.uuid().parse(id)),
	);
	const unsubscribe = service.onChanged((event) => {
		if (!webContents.isDestroyed()) webContents.send(ANNOTATION_CHANNELS.CHANGED, event);
	});
	return () => {
		unsubscribe();
		service.dispose();
		for (const channel of [ANNOTATION_CHANNELS.LIST, ANNOTATION_CHANNELS.ASK, ANNOTATION_CHANNELS.CANCEL])
			ipcMain.removeHandler(channel);
	};
}
