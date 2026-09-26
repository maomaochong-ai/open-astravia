import type { IpcRenderer } from "electron";
import type { RemotePairingApi, RemotePairingState } from "../api-types/remote-pairing.js";

const STATE_CHANGED = "vetta:remote-pairing:state-changed";

export function createRemotePairingApi(ipc: Pick<IpcRenderer, "invoke" | "on" | "removeListener">): RemotePairingApi {
	return {
		getState: () => ipc.invoke("vetta:remote-pairing:get-state"),
		createInvite: () => ipc.invoke("vetta:remote-pairing:create-invite"),
		cancelInvite: () => ipc.invoke("vetta:remote-pairing:cancel-invite"),
		setCloudEnabled: (enabled) => ipc.invoke("vetta:remote-pairing:set-cloud-enabled", enabled),
		approve: (id, allow) => ipc.invoke("vetta:remote-pairing:approve", id, allow),
		revokeDevice: (id) => ipc.invoke("vetta:remote-pairing:revoke-device", id),
		renameDevice: (id, name) => ipc.invoke("vetta:remote-pairing:rename-device", id, name),
		onStateChanged: (listener) => {
			const handler = (_event: unknown, state: RemotePairingState): void => listener(state);
			ipc.on(STATE_CHANGED, handler);
			return () => {
				ipc.removeListener(STATE_CHANGED, handler);
			};
		},
	};
}
