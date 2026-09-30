import type {
	RemotePairingChannel,
	RemotePairingState,
	RemoteRelayTestResult,
} from "@preload/api-types/remote-pairing";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type PairingQr, pairingQr } from "./remote-pairing-qr";

const EMPTY_STATE: RemotePairingState = {
	devices: [],
	approvals: [],
	lanEndpoints: [],
	cloudEnabled: true,
	vaultAvailable: true,
};

type RemotePairingFailure = "action" | "create" | "load" | "qr";

export interface RemotePairingSettingsModel {
	readonly approvals: RemotePairingState["approvals"];
	readonly busy: boolean;
	readonly cloud: {
		readonly available: boolean;
		readonly enabled: boolean;
		readonly relayBaseUrl?: string;
		readonly defaultRelayBaseUrl?: string;
		/** The relay's host alone, for showing on the page. */
		readonly relayHost?: string;
		readonly relayIsDefault: boolean;
	};
	readonly devices: readonly {
		readonly id: string;
		readonly name: string;
		readonly online: boolean;
		readonly status: string;
		readonly desktopControl: boolean;
	}[];
	readonly error?: string;
	readonly labels: {
		readonly actionFailed: string;
		readonly approvals: {
			readonly allow: string;
			readonly deny: string;
			readonly description: string;
			readonly hint: string;
			readonly title: string;
		};
		readonly cloud: {
			readonly description: string;
			readonly section: string;
			readonly title: string;
			readonly unavailable: string;
		};
		readonly relay: {
			readonly change: string;
			readonly defaultTag: string;
			readonly label: string;
			readonly unset: string;
		};
		readonly devices: {
			readonly desktop: string;
			readonly empty: string;
			readonly emptyHint: string;
			readonly revoke: string;
			readonly title: string;
		};
		readonly pairing: {
			readonly cancel: string;
			readonly code: string;
			readonly codeFailed: string;
			readonly codeHint: string;
			readonly codePreparing: string;
			readonly password: string;
			readonly create: string;
			readonly empty: string;
			readonly generating: string;
			readonly manualHint: string;
			readonly manualTitle: string;
			readonly qrAlt: string;
			readonly vaultUnavailable: string;
		};
		readonly description: string;
		readonly title: string;
	};
	readonly pairing: {
		readonly canCreate: boolean;
		readonly endpoints: readonly string[];
		readonly hasInvite: boolean;
		readonly preparing: boolean;
		/**
		 * True from the moment a refresh is asked for until the replacement code is ready.
		 * The previous QR and connection code are already being withdrawn, so the view
		 * must not keep showing them.
		 */
		readonly renewing: boolean;
		readonly qrDataUrl?: string;
		/** Diameter of the badge over the QR code's centre, as a share of its width. */
		readonly qrBadge?: number;
		readonly vaultAvailable: boolean;
		/** The invite as a connection code and password, when the relay can hold it. */
		readonly code?: {
			readonly code: string;
			readonly password: string;
			readonly status: "preparing" | "ready" | "failed";
		};
	};
	readonly actions: {
		readonly approve: (id: string, allow: boolean) => void;
		readonly cancelInvite: () => void;
		readonly createInvite: () => void;
		readonly revokeDevice: (id: string) => void;
		readonly setCloudEnabled: (enabled: boolean) => void;
		readonly setDesktopControl: (id: string, enabled: boolean) => void;
		/** Another relay, or the default one for `undefined`; false when it was refused. */
		readonly setRelay: (url: string | undefined) => Promise<boolean>;
		readonly testRelay: (url: string) => Promise<RemoteRelayTestResult>;
	};
}

/** How a phone is connected, fastest first: the one it uses when several are up. */
const CHANNEL_LABELS = {
	p2p: "remote.devices.channel.p2p",
	lan: "remote.devices.channel.lan",
	relay: "remote.devices.channel.relay",
} as const satisfies Record<RemotePairingChannel, string>;

function bestChannel(channels: readonly RemotePairingChannel[]): RemotePairingChannel | undefined {
	return (Object.keys(CHANNEL_LABELS) as RemotePairingChannel[]).find((channel) => channels.includes(channel));
}

function relayHost(url: string | undefined): string | undefined {
	if (!url) return undefined;
	try {
		return new URL(url).host || url;
	} catch {
		return url;
	}
}

export function useRemotePairingSettingsModel(): RemotePairingSettingsModel {
	const { t } = useTranslation("settings");
	const [state, setState] = useState<RemotePairingState>(EMPTY_STATE);
	const [qr, setQr] = useState<PairingQr>();
	const [initializing, setInitializing] = useState(true);
	const [busy, setBusy] = useState(false);
	const [renewing, setRenewing] = useState(false);
	const [failure, setFailure] = useState<RemotePairingFailure>();
	const inviteIdRef = useRef<string | undefined>(undefined);
	const renewedFromRef = useRef<string | undefined>(undefined);
	inviteIdRef.current = state.invite?.pairingId;

	const apply = useCallback((next: RemotePairingState): void => {
		setState(next);
		setFailure(undefined);
	}, []);

	useEffect(() => {
		let cancelled = false;
		// The desktop pushes every change: a phone coming or going, an invite or approval appearing.
		const unsubscribe = window.vetta.remotePairing.onStateChanged((next) => {
			if (cancelled) return;
			setState(next);
			setFailure((current) => (current === "load" ? undefined : current));
		});

		const initialize = async (): Promise<void> => {
			try {
				const current = await window.vetta.remotePairing.getState();
				if (cancelled) return;
				setState(current);
				if (current.invite || !current.vaultAvailable) return;
				const next = await window.vetta.remotePairing.createInvite();
				if (!cancelled) apply(next);
			} catch {
				if (!cancelled) setFailure("create");
			} finally {
				if (!cancelled) setInitializing(false);
			}
		};

		void initialize();
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, [apply]);

	useEffect(() => {
		const uri = state.invite?.qrText;
		if (!uri) {
			setQr(undefined);
			return;
		}

		try {
			setQr(pairingQr(uri));
		} catch {
			setQr(undefined);
			setFailure("qr");
		}
	}, [state.invite?.qrText]);

	// A refresh withdraws the current invite and mints another. Hold the preparing layout
	// across that gap, including the moment with no invite at all, and release it once
	// an invite is actually showable again (or the refresh failed).
	useEffect(() => {
		if (!renewing || busy) return;
		if (failure) {
			setRenewing(false);
			return;
		}
		if (!state.invite?.pairingId) return;
		if (qr && state.invite?.code?.status !== "preparing") setRenewing(false);
	}, [busy, failure, qr, renewing, state.invite?.code?.status, state.invite?.pairingId]);

	const run = useCallback(
		async (action: () => Promise<RemotePairingState>, failureKind: RemotePairingFailure = "action") => {
			setBusy(true);
			try {
				apply(await action());
			} catch {
				setFailure(failureKind);
			} finally {
				setBusy(false);
			}
		},
		[apply],
	);

	// While the page is open there is always a code to scan: one that expired, was used by a
	// phone or was refreshed is replaced at once. A failure stops it until the person retries.
	const needsInvite = !initializing && !busy && !failure && !state.invite && state.vaultAvailable;
	useEffect(() => {
		if (needsInvite) void run(() => window.vetta.remotePairing.createInvite(), "create");
	}, [needsInvite, run]);

	const labels = useMemo<RemotePairingSettingsModel["labels"]>(
		() => ({
			title: t("remote.title"),
			description: t("remote.description"),
			actionFailed: t("remote.actionFailed"),
			approvals: {
				title: t("remote.approvals.title"),
				description: t("remote.approvals.description"),
				hint: t("remote.approvals.hint"),
				allow: t("remote.approvals.allow"),
				deny: t("remote.approvals.deny"),
			},
			devices: {
				title: t("remote.devices.title"),
				empty: t("remote.devices.empty"),
				emptyHint: t("remote.devices.emptyHint"),
				revoke: t("remote.devices.revoke"),
				desktop: t("remote.devices.desktop"),
			},
			pairing: {
				create: t("remote.pairing.create"),
				cancel: t("remote.pairing.cancel"),
				qrAlt: t("remote.pairing.qrAlt"),
				generating: t("remote.pairing.generating"),
				empty: t("remote.pairing.empty"),
				vaultUnavailable: t("remote.pairing.vaultUnavailable"),
				manualHint: t("remote.pairing.manualHint"),
				manualTitle: t("remote.pairing.manualTitle"),
				code: t("remote.pairing.code"),
				password: t("remote.pairing.password"),
				codeHint: t("remote.pairing.codeHint"),
				codePreparing: t("remote.pairing.codePreparing"),
				codeFailed: t("remote.pairing.codeFailed"),
			},
			cloud: {
				title: t("remote.cloud.title"),
				section: t("section_remote-cloud"),
				description: t("remote.cloud.description"),
				unavailable: t("remote.cloud.unavailable"),
			},
			relay: {
				label: t("remote.relay.label"),
				change: t("remote.relay.change"),
				defaultTag: t("remote.relay.defaultTag"),
				unset: t("remote.relay.unset"),
			},
		}),
		[t],
	);

	const devices = useMemo(
		() =>
			state.devices
				.filter((device) => device.claimed)
				.map((device) => {
					const channel = device.online ? bestChannel(device.channels) : undefined;
					return {
						id: device.id,
						name: device.name || t("remote.devices.unnamed"),
						online: device.online,
						status: channel
							? t("remote.devices.onlineVia", { channel: t(CHANNEL_LABELS[channel]) })
							: device.online
								? t("remote.devices.online")
								: device.lastSeenAt
									? t("remote.devices.lastSeen", { time: new Date(device.lastSeenAt).toLocaleString() })
									: t("remote.devices.neverSeen"),
						desktopControl: device.desktopControl,
					};
				}),
		[state.devices, t],
	);

	const actions = useMemo<RemotePairingSettingsModel["actions"]>(
		() => ({
			approve: (id, allow) => void run(() => window.vetta.remotePairing.approve(id, allow)),
			cancelInvite: () => {
				renewedFromRef.current = inviteIdRef.current ?? "";
				setRenewing(true);
				void run(() => window.vetta.remotePairing.cancelInvite());
			},
			createInvite: () => void run(() => window.vetta.remotePairing.createInvite(), "create"),
			revokeDevice: (id) => void run(() => window.vetta.remotePairing.revokeDevice(id)),
			setCloudEnabled: (enabled) => void run(() => window.vetta.remotePairing.setCloudEnabled(enabled)),
			setDesktopControl: (id, enabled) => void run(() => window.vetta.remotePairing.setDesktopControl(id, enabled)),
			setRelay: async (url) => {
				try {
					apply(await window.vetta.remotePairing.setRelay(url));
					return true;
				} catch {
					return false;
				}
			},
			testRelay: (url) => window.vetta.remotePairing.testRelay(url).catch(() => "unreachable" as const),
		}),
		[apply, run],
	);

	const failureMessage = failure
		? failure === "create" || failure === "qr"
			? t("remote.pairing.createFailed")
			: failure === "load"
				? t("remote.loadFailed")
				: labels.actionFailed
		: state.error
			? t("remote.connectionFailed")
			: undefined;

	return {
		approvals: state.approvals,
		busy,
		cloud: {
			available: Boolean(state.relayBaseUrl),
			enabled: state.cloudEnabled,
			relayBaseUrl: state.relayBaseUrl,
			defaultRelayBaseUrl: state.defaultRelayBaseUrl,
			relayHost: relayHost(state.relayBaseUrl),
			relayIsDefault: !state.relayBaseUrl || state.relayBaseUrl === state.defaultRelayBaseUrl,
		},
		devices,
		error: failureMessage,
		labels,
		pairing: {
			canCreate: !initializing && !busy && !state.invite && state.vaultAvailable,
			endpoints: state.lanEndpoints,
			hasInvite: Boolean(state.invite),
			preparing: initializing || Boolean((busy && !state.invite) || (state.invite && !qr && failure !== "qr")),
			renewing,
			qrDataUrl: qr?.dataUrl,
			qrBadge: qr?.badge,
			vaultAvailable: state.vaultAvailable,
			code: state.invite?.code,
		},
		actions,
	};
}
