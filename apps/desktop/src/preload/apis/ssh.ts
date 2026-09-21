import type { IpcRenderer, IpcRendererEvent } from "electron";
import { SSH_CHANNELS, type SshHostStatusEvent } from "../../shared/ssh-ipc.js";
import { SSH_PROMPT_CHANNELS, type SshPromptRequestEvent } from "../../shared/ssh-prompt-ipc.js";
import type { DesktopApi } from "../api.js";

const CHANNELS = {
	LIST_HOSTS: "vetta:ssh:list-hosts",
	CREATE_HOST: "vetta:ssh:create-host",
	UPDATE_HOST: "vetta:ssh:update-host",
	REMOVE_HOST: "vetta:ssh:remove-host",
	IMPORT_CONFIG: "vetta:ssh:import-config",
	LIST_CONFIG_ALIASES: "vetta:ssh:list-config-aliases",
	TEST_HOST: "vetta:ssh:test-host",
	HOST_STATUS: "vetta:ssh:get-host-status",
	LIST_REMOTE_DIR: "vetta:ssh:list-remote-dir",
	LIST_LISTENING_PORTS: "vetta:ssh:list-listening-ports",
	LIST_FORWARDS: "vetta:ssh:list-port-forwards",
	OPEN_FORWARD: "vetta:ssh:open-port-forward",
	CLOSE_FORWARD: "vetta:ssh:close-port-forward",
} as const;

export function createSshApi(ipc: IpcRenderer): Pick<DesktopApi, "ssh"> {
	return {
		ssh: {
			listHosts: () => ipc.invoke(CHANNELS.LIST_HOSTS),
			createHost: (input) => ipc.invoke(CHANNELS.CREATE_HOST, input),
			updateHost: (input) => ipc.invoke(CHANNELS.UPDATE_HOST, input),
			removeHost: (hostId) => ipc.invoke(CHANNELS.REMOVE_HOST, hostId),
			listConfigAliases: () => ipc.invoke(CHANNELS.LIST_CONFIG_ALIASES),
			importFromConfig: (aliases) => ipc.invoke(CHANNELS.IMPORT_CONFIG, [...aliases]),
			testHost: (hostId) => ipc.invoke(CHANNELS.TEST_HOST, hostId),
			getHostStatus: (hostId) => ipc.invoke(CHANNELS.HOST_STATUS, hostId),
			listRemoteDirectory: (input) => ipc.invoke(CHANNELS.LIST_REMOTE_DIR, input),
			listListeningPorts: (hostId) => ipc.invoke(CHANNELS.LIST_LISTENING_PORTS, hostId),
			listPortForwards: (hostId) => ipc.invoke(CHANNELS.LIST_FORWARDS, hostId ?? ""),
			openPortForward: (request) => ipc.invoke(CHANNELS.OPEN_FORWARD, request),
			closePortForward: (input) => ipc.invoke(CHANNELS.CLOSE_FORWARD, input),
			onPortForwardsChanged: (listener) => {
				const handler = (): void => listener();
				ipc.on(SSH_CHANNELS.PORT_FORWARDS_CHANGED, handler);
				return () => ipc.removeListener(SSH_CHANNELS.PORT_FORWARDS_CHANGED, handler);
			},
			onHostsChanged: (listener) => {
				const handler = (): void => listener();
				ipc.on(SSH_CHANNELS.HOSTS_CHANGED, handler);
				return () => ipc.removeListener(SSH_CHANNELS.HOSTS_CHANGED, handler);
			},
			onHostStatusChanged: (listener) => {
				const handler = (_event: IpcRendererEvent, payload: SshHostStatusEvent): void => listener(payload);
				ipc.on(SSH_CHANNELS.HOST_STATUS, handler);
				return () => ipc.removeListener(SSH_CHANNELS.HOST_STATUS, handler);
			},
			onPromptRequest: (listener) => {
				const handler = (_event: IpcRendererEvent, payload: SshPromptRequestEvent): void => listener(payload);
				ipc.on(SSH_PROMPT_CHANNELS.REQUEST, handler);
				return () => ipc.removeListener(SSH_PROMPT_CHANNELS.REQUEST, handler);
			},
			onPromptCancelled: (listener) => {
				const handler = (_event: IpcRendererEvent, id: string): void => listener(id);
				ipc.on(SSH_PROMPT_CHANNELS.CANCEL, handler);
				return () => ipc.removeListener(SSH_PROMPT_CHANNELS.CANCEL, handler);
			},
			respondToPrompt: (response) => ipc.send(SSH_PROMPT_CHANNELS.RESPOND, response),
		},
	};
}
