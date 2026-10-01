import type { IpcRenderer } from "electron";
import type { RemotePairingApi, RemotePairingState } from "../api-types/remote-pairing.js";

const STATE_CHANGED = "astravia:remote-pairing:state-changed";

export function createRemotePairingApi(ipc: Pick<IpcRenderer, "invoke" | "on" | "removeListener">): RemotePairingApi {
	return {
		getState: () => ipc.invoke("astravia:remote-pairing:get-state"),
		createInvite: () => ipc.invoke("astravia:remote-pairing:create-invite"),
		cancelInvite: () => ipc.invoke("astravia:remote-pairing:cancel-invite"),
		setCloudEnabled: (enabled) => ipc.invoke("astravia:remote-pairing:set-cloud-enabled", enabled),
		approve: (id, allow) => ipc.invoke("astravia:remote-pairing:approve", id, allow),
		revokeDevice: (id) => ipc.invoke("astravia:remote-pairing:revoke-device", id),
		renameDevice: (id, name) => ipc.invoke("astravia:remote-pairing:rename-device", id, name),
		setDesktopControl: (id, enabled) => ipc.invoke("astravia:remote-pairing:set-desktop-control", id, enabled),
		setRelay: (url) => ipc.invoke("astravia:remote-pairing:set-relay", url),
		testRelay: (url) => ipc.invoke("astravia:remote-pairing:test-relay", url),
		onStateChanged: (listener) => {
			const handler = (_event: unknown, state: RemotePairingState): void => listener(state);
			ipc.on(STATE_CHANGED, handler);
			return () => {
				ipc.removeListener(STATE_CHANGED, handler);
			};
		},
	};
}
