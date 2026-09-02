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
	decode: (data: unknown) => T = (data) => data as T,
): Promise<() => void> {
	let subscriptionId: string | undefined;
	const buffered: Array<{ readonly incomingId: string; readonly data: unknown }> = [];
	const listener = (_event: IpcRendererEvent, incomingId: string, data: unknown) => {
		if (subscriptionId === undefined) {
			buffered.push({ incomingId, data });
			return;
		}
		if (incomingId === subscriptionId) handler(decode(data));
	};
	ipc.on(eventChannel, listener);
	let initial: T | undefined;
	try {
		const response = (await ipc.invoke(subscribeChannel, ...args)) as {
			subscriptionId: string;
			initial?: T;
		};
		subscriptionId = response.subscriptionId;
		initial = response.initial;
	} catch (error) {
		ipc.removeListener(eventChannel, listener);
		throw error;
	}
	if (initial !== undefined) handler(decode(initial));
	for (const event of buffered) {
		if (event.incomingId === subscriptionId) handler(decode(event.data));
	}
	buffered.length = 0;
	return () => {
		ipc.removeListener(eventChannel, listener);
		void ipc.invoke(unsubscribeChannel, subscriptionId);
	};
}
