import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import "./telemetry.js";
import {
	PET_BEGIN_WINDOW_MOVE_CHANNEL,
	PET_BEGIN_WINDOW_RESIZE_CHANNEL,
	PET_COMMAND_CHANNEL,
	PET_END_WINDOW_MOVE_CHANNEL,
	PET_END_WINDOW_RESIZE_CHANNEL,
	PET_MOVE_WINDOW_BY_CHANNEL,
	PET_RESIZE_BY_WHEEL_CHANNEL,
	PET_RESIZE_VIDEO_BY_WHEEL_CHANNEL,
	PET_SET_CONTENT_SIZE_CHANNEL,
	PET_SET_MOUSE_PASSTHROUGH_CHANNEL,
	PET_SET_VIDEO_BASE_SIZE_CHANNEL,
	PET_SET_VIDEO_HITBOX_CHANNEL,
	PET_SET_WINDOW_SIZE_CHANNEL,
	type PetBridge,
	type PetCommand,
} from "../shared/pet-ipc.js";

const api: PetBridge = {
	onCommand(listener) {
		const handler = (_event: IpcRendererEvent, command: PetCommand) => {
			listener(command);
		};
		ipcRenderer.on(PET_COMMAND_CHANNEL, handler);
		return () => ipcRenderer.removeListener(PET_COMMAND_CHANNEL, handler);
	},
	resizeByWheel(deltaY) {
		return ipcRenderer.invoke(PET_RESIZE_BY_WHEEL_CHANNEL, deltaY);
	},
	resizeVideoByWheel(actionId, deltaY) {
		return ipcRenderer.invoke(PET_RESIZE_VIDEO_BY_WHEEL_CHANNEL, actionId, deltaY);
	},
	beginWindowMove() {
		return ipcRenderer.invoke(PET_BEGIN_WINDOW_MOVE_CHANNEL);
	},
	moveWindow() {
		return ipcRenderer.invoke(PET_MOVE_WINDOW_BY_CHANNEL);
	},
	endWindowMove() {
		return ipcRenderer.invoke(PET_END_WINDOW_MOVE_CHANNEL);
	},
	beginWindowResize(corner) {
		return ipcRenderer.invoke(PET_BEGIN_WINDOW_RESIZE_CHANNEL, corner);
	},
	setWindowSize(size, corner) {
		return ipcRenderer.invoke(PET_SET_WINDOW_SIZE_CHANNEL, size, corner);
	},
	setContentSize(size) {
		return ipcRenderer.invoke(PET_SET_CONTENT_SIZE_CHANNEL, size);
	},
	endWindowResize(size) {
		return ipcRenderer.invoke(PET_END_WINDOW_RESIZE_CHANNEL, size);
	},
	setVideoBaseSize(actionId, baseSize) {
		return ipcRenderer.invoke(PET_SET_VIDEO_BASE_SIZE_CHANNEL, actionId, baseSize);
	},
	setMousePassthrough(enabled) {
		return ipcRenderer.invoke(PET_SET_MOUSE_PASSTHROUGH_CHANNEL, enabled);
	},
	setVideoHitbox(hitbox) {
		return ipcRenderer.invoke(PET_SET_VIDEO_HITBOX_CHANNEL, hitbox);
	},
};

contextBridge.exposeInMainWorld("vettaPet", api);
