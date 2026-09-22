import { basename } from "node:path";
import { DEFAULT_CONVERSATION_CWD, readDesktopConfig, writeDesktopConfig } from "../config/desktop-config-store.js";
import { getDesktopConversationService } from "../conversations/desktop-conversation-service.js";
import { isConversationCwd } from "../conversations/session-paths.js";
import { getDesktopUserQuestionBroker } from "../conversations/user-question-broker.js";
import { getDesktopCredentialVault } from "../credentials/desktop-credential-vault.js";
import { mainT } from "../i18n/index.js";
import { notify } from "../notifications/index.js";
import { getDesktopProjectService } from "../projects/project-service-instance.js";
import { getSharedRuntime } from "../runtime.js";
import { desktopDeviceId, desktopDisplayName, desktopHardware, formatOsLabel } from "./desktop-host-info.js";
import { DesktopRemoteAccessManager } from "./desktop-remote-access-manager.js";
import { DesktopRemoteMirror } from "./desktop-remote-mirror.js";
import { RemoteDeviceStore } from "./remote-device-store.js";

let manager: DesktopRemoteAccessManager | undefined;

/**
 * Wires the remote access manager to the real desktop services. Constructing
 * it is cheap and side-effect free; `restore()` decides whether anything
 * actually starts based on whether phones are paired.
 */
export function getDesktopRemoteAccessManager(defaultRelayBaseUrl?: string): DesktopRemoteAccessManager {
	manager ??= new DesktopRemoteAccessManager({
		store: new RemoteDeviceStore({
			readConfig: readDesktopConfig,
			writeConfig: writeDesktopConfig,
			vault: getDesktopCredentialVault(),
			defaultRelayBaseUrl,
		}),
		deviceId: desktopDeviceId(),
		deviceName: desktopDisplayName(),
		osLabel: formatOsLabel(),
		runningSessionCount: () => getSharedRuntime().getRunningSessionPaths().length,
		notifications: {
			deviceConnected: ({ name }) => void notify({ type: "remote-device-connected", deviceName: name }),
			pairingRequested: ({ deviceName, code }) => void notify({ type: "remote-pairing-request", deviceName, code }),
		},
		createMirror: (emit, deviceStatus) =>
			new DesktopRemoteMirror({
				runtime: getSharedRuntime(),
				conversations: getDesktopConversationService(),
				questions: getDesktopUserQuestionBroker(),
				listProjects: async () => {
					const snapshot = await getDesktopProjectService().list();
					return snapshot.projects.map((project) => ({
						cwd: project.path,
						name: project.name?.trim() || basename(project.path) || project.path,
					}));
				},
				conversationCwd: DEFAULT_CONVERSATION_CWD,
				conversationLabel: mainT("remote.conversationProject"),
				isConversationCwd,
				emit,
				deviceStatus,
				hardware: desktopHardware,
			}),
	});
	return manager;
}

export async function shutdownDesktopRemoteAccess(): Promise<void> {
	const current = manager;
	manager = undefined;
	await current?.shutdown();
}
