import type { IpcRenderer, IpcRendererEvent } from "electron";

export function onIpcEvent<T>(ipc: IpcRenderer, channel: string, handler: (data: T) => void): () => void {
	const listener = (_event: IpcRendererEvent, data: unknown) => {
		handler(data as T);
	};
	ipc.on(channel, listener);
	return () => ipc.removeListener(channel, listener);
}

export function onIpcVoidEvent(ipc: IpcRenderer, channel: string, handler: () => void): () => void {
	const listener = () => handler();
	ipc.on(channel, listener);
	return () => ipc.removeListener(channel, listener);
}

export async function subscribeById<T>(
	ipc: IpcRenderer,
	subscribeChannel: string,
	eventChannel: string,
	unsubscribeChannel: string,
	handler: (data: T) => void,
	args: unknown[],
): Promise<() => void> {
	const { subscriptionId } = (await ipc.invoke(subscribeChannel, ...args)) as {
		subscriptionId: string;
	};
	const listener = (_event: IpcRendererEvent, incomingId: string, data: unknown) => {
		if (incomingId === subscriptionId) handler(data as T);
	};
	ipc.on(eventChannel, listener);
	return () => {
		ipc.removeListener(eventChannel, listener);
		void ipc.invoke(unsubscribeChannel, subscriptionId);
	};
}
