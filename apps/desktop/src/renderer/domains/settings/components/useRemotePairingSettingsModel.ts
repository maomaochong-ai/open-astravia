import type { RemotePairingChannel, RemotePairingState } from "@preload/api-types/remote-pairing";
import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const EMPTY_STATE: RemotePairingState = {
	devices: [],
	approvals: [],
	lanEndpoints: [],
	cloudEnabled: true,
	vaultAvailable: true,
};

/** How often the QR code's "expires in N minutes" is recounted while one is shown. */
const COUNTDOWN_MS = 15_000;

type RemotePairingFailure = "action" | "create" | "load" | "qr";

export interface RemotePairingSettingsModel {
	readonly approvals: RemotePairingState["approvals"];
	readonly busy: boolean;
	readonly cloud: {
		readonly available: boolean;
		readonly enabled: boolean;
	};
	readonly devices: readonly {
		readonly id: string;
		readonly name: string;
		readonly online: boolean;
		readonly status: string;
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
			readonly title: string;
			readonly unavailable: string;
		};
		readonly devices: {
			readonly description: string;
			readonly empty: string;
			readonly revoke: string;
			readonly title: string;
		};
		readonly pairing: {
			readonly cancel: string;
			readonly create: string;
			readonly description: string;
			readonly empty: string;
			readonly generating: string;
			readonly manualHint: string;
			readonly permissionHint: string;
			readonly qrAlt: string;
			readonly qrHint: string;
			readonly title: string;
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
		readonly qrDataUrl?: string;
		readonly vaultAvailable: boolean;
	};
	readonly actions: {
		readonly approve: (id: string, allow: boolean) => void;
		readonly cancelInvite: () => void;
		readonly createInvite: () => void;
		readonly revokeDevice: (id: string) => void;
		readonly setCloudEnabled: (enabled: boolean) => void;
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

export function useRemotePairingSettingsModel(): RemotePairingSettingsModel {
	const { t } = useTranslation("settings");
	const [state, setState] = useState<RemotePairingState>(EMPTY_STATE);
	const [qrDataUrl, setQrDataUrl] = useState<string>();
	const [initializing, setInitializing] = useState(true);
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<RemotePairingFailure>();

	// Only the countdown needs the clock; the state itself is pushed.
	const [now, setNow] = useState(() => Date.now());
	const hasInvite = state.invite !== undefined;
	useEffect(() => {
		if (!hasInvite) return;
		setNow(Date.now());
		const timer = window.setInterval(() => setNow(Date.now()), COUNTDOWN_MS);
		return () => window.clearInterval(timer);
	}, [hasInvite]);

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
		const uri = state.invite?.inviteUri;
		if (!uri) {
			setQrDataUrl(undefined);
			return;
		}

		let cancelled = false;
		setQrDataUrl(undefined);
		void QRCode.toDataURL(uri, { width: 320, margin: 1, errorCorrectionLevel: "M" })
			.then((url) => {
				if (!cancelled) setQrDataUrl(url);
			})
			.catch(() => {
				if (!cancelled) setFailure("qr");
			});
		return () => {
			cancelled = true;
		};
	}, [state.invite?.inviteUri]);

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
				description: t("remote.devices.description"),
				empty: t("remote.devices.empty"),
				revoke: t("remote.devices.revoke"),
			},
			pairing: {
				title: t("remote.pairing.title"),
				description: t("remote.pairing.description"),
				create: t("remote.pairing.create"),
				cancel: t("remote.pairing.cancel"),
				qrAlt: t("remote.pairing.qrAlt"),
				qrHint: t("remote.pairing.qrHint", {
					minutes: state.invite ? Math.max(0, Math.round((state.invite.expiresAt - now) / 60_000)) : 0,
				}),
				generating: t("remote.pairing.generating"),
				empty: t("remote.pairing.empty"),
				vaultUnavailable: t("remote.pairing.vaultUnavailable"),
				manualHint: t("remote.pairing.manualHint"),
				permissionHint: t("remote.pairing.permissionHint"),
			},
			cloud: {
				title: t("remote.cloud.title"),
				description: t("remote.cloud.description"),
				unavailable: t("remote.cloud.unavailable"),
			},
		}),
		[state.invite, now, t],
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
					};
				}),
		[state.devices, t],
	);

	const actions = useMemo<RemotePairingSettingsModel["actions"]>(
		() => ({
			approve: (id, allow) => void run(() => window.vetta.remotePairing.approve(id, allow)),
			cancelInvite: () => void run(() => window.vetta.remotePairing.cancelInvite()),
			createInvite: () => void run(() => window.vetta.remotePairing.createInvite(), "create"),
			revokeDevice: (id) => void run(() => window.vetta.remotePairing.revokeDevice(id)),
			setCloudEnabled: (enabled) => void run(() => window.vetta.remotePairing.setCloudEnabled(enabled)),
		}),
		[run],
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
		},
		devices,
		error: failureMessage,
		labels,
		pairing: {
			canCreate: !initializing && !busy && !state.invite && state.vaultAvailable,
			endpoints: state.lanEndpoints,
			hasInvite: Boolean(state.invite),
			preparing:
				initializing || Boolean((busy && !state.invite) || (state.invite && !qrDataUrl && failure !== "qr")),
			qrDataUrl,
			vaultAvailable: state.vaultAvailable,
		},
		actions,
	};
}
