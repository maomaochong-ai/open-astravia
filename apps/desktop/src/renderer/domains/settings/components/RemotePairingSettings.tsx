import { Button } from "@shared/components/ui/button";
import { Switch } from "@shared/components/ui/switch";
import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RemotePairingDevice, RemotePairingState } from "../../../../preload/api-types/remote-pairing";

const EMPTY_STATE: RemotePairingState = {
	devices: [],
	approvals: [],
	lanEndpoints: [],
	cloudEnabled: true,
	vaultAvailable: true,
};

/** Polls only while this page is mounted; the main process pushes nothing otherwise. */
const REFRESH_MS = 1_000;

export function RemotePairingSettings(): JSX.Element {
	const { t } = useTranslation("settings");
	const [state, setState] = useState<RemotePairingState>(EMPTY_STATE);
	const [qr, setQr] = useState<string>();
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<string>();

	const apply = useCallback((next: RemotePairingState): void => {
		setState(next);
		setFailure(undefined);
	}, []);

	useEffect(() => {
		let cancelled = false;
		const sync = (): void => {
			void window.vetta.remotePairing.getState().then((next) => {
				if (!cancelled) setState(next);
			});
		};
		sync();
		const timer = window.setInterval(sync, REFRESH_MS);
		return () => {
			cancelled = true;
			window.clearInterval(timer);
		};
	}, []);

	useEffect(() => {
		const uri = state.invite?.inviteUri;
		if (!uri) {
			setQr(undefined);
			return;
		}
		let cancelled = false;
		void QRCode.toDataURL(uri, { width: 320, margin: 1, errorCorrectionLevel: "M" }).then((url) => {
			if (!cancelled) setQr(url);
		});
		return () => {
			cancelled = true;
		};
	}, [state.invite?.inviteUri]);

	const run = async (action: () => Promise<RemotePairingState>): Promise<void> => {
		setBusy(true);
		try {
			apply(await action());
		} catch (error) {
			setFailure(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	};

	const claimedDevices = state.devices.filter((device) => device.claimed);
	const remaining = state.invite ? Math.max(0, Math.round((state.invite.expiresAt - Date.now()) / 60_000)) : 0;

	return (
		<div className="mx-auto w-full max-w-[680px] px-8 pt-2 pb-8">
			<div className="mb-6">
				<h1 className="text-[20px] font-bold text-foreground">{t("remote.title")}</h1>
				<p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{t("remote.description")}</p>
			</div>

			{state.error || failure ? (
				<div className="mb-5 rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-[12px] text-destructive">
					{failure ?? state.error}
				</div>
			) : null}

			{state.approvals.length > 0 ? (
				<section id="remote-approvals" className="mb-7">
					<h2 className="text-[14px] font-semibold text-foreground">{t("remote.approvals.title")}</h2>
					<p className="mt-1 text-[12px] text-muted-foreground">{t("remote.approvals.description")}</p>
					<div className="mt-3 flex flex-col gap-3">
						{state.approvals.map((approval) => (
							<div
								key={approval.id}
								className="rounded-xl border border-amber-500/40 bg-amber-500/15 px-4 pt-3 pb-3"
							>
								<div className="flex items-center justify-between gap-4">
									<div className="min-w-0">
										<div className="truncate text-[13px] font-medium text-foreground">{approval.deviceName}</div>
										<div className="mt-0.5 text-[12px] text-muted-foreground">{t("remote.approvals.hint")}</div>
									</div>
									<div className="font-mono text-[20px] font-semibold tracking-[0.3em] text-foreground">
										{approval.code}
									</div>
								</div>
								<div className="mt-3 flex gap-2">
									<Button
										size="sm"
										disabled={busy}
										onClick={() => void run(() => window.vetta.remotePairing.approve(approval.id, true))}
									>
										{t("remote.approvals.allow")}
									</Button>
									<Button
										size="sm"
										variant="outline"
										disabled={busy}
										onClick={() => void run(() => window.vetta.remotePairing.approve(approval.id, false))}
									>
										{t("remote.approvals.deny")}
									</Button>
								</div>
							</div>
						))}
					</div>
				</section>
			) : null}

			<section id="remote-devices" className="mb-7">
				<h2 className="text-[14px] font-semibold text-foreground">{t("remote.devices.title")}</h2>
				<p className="mt-1 text-[12px] text-muted-foreground">{t("remote.devices.description")}</p>
				{claimedDevices.length === 0 ? (
					<div className="mt-3 rounded-xl border border-border/50 bg-card/40 px-4 py-6 text-center text-[12px] text-muted-foreground">
						{t("remote.devices.empty")}
					</div>
				) : (
					<ul className="mt-3 flex flex-col gap-2">
						{claimedDevices.map((device) => (
							<DeviceRow
								key={device.id}
								device={device}
								busy={busy}
								onRevoke={() => void run(() => window.vetta.remotePairing.revokeDevice(device.id))}
							/>
						))}
					</ul>
				)}
			</section>

			<section id="remote-pairing" className="mb-7">
				<div className="flex items-start justify-between gap-3">
					<div>
						<h2 className="text-[14px] font-semibold text-foreground">{t("remote.pairing.title")}</h2>
						<p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{t("remote.pairing.description")}</p>
					</div>
					{state.invite ? (
						<Button
							variant="outline"
							size="sm"
							disabled={busy}
							onClick={() => void run(() => window.vetta.remotePairing.cancelInvite())}
						>
							{t("remote.pairing.cancel")}
						</Button>
					) : (
						<Button
							size="sm"
							disabled={busy || !state.vaultAvailable}
							onClick={() => void run(() => window.vetta.remotePairing.createInvite())}
						>
							<span className="icon-[solar--qr-code-linear] h-3.5 w-3.5" />
							{t("remote.pairing.create")}
						</Button>
					)}
				</div>
				{!state.vaultAvailable ? (
					<p className="mt-2 text-[12px] text-destructive">{t("remote.pairing.vaultUnavailable")}</p>
				) : null}
				<div className="mt-4 rounded-xl border border-border/50 bg-card/40 px-4 pt-4 pb-4">
					{qr && state.invite ? (
						<div className="flex flex-col items-center">
							<img src={qr} alt={t("remote.pairing.qrAlt")} className="h-[320px] w-[320px] rounded-lg bg-white p-2" />
							<p className="mt-3 max-w-[420px] text-center text-[12px] leading-relaxed text-muted-foreground">
								{t("remote.pairing.qrHint", { minutes: remaining })}
							</p>
						</div>
					) : (
						<div className="flex min-h-[160px] flex-col items-center justify-center text-muted-foreground">
							<span className="icon-[solar--smartphone-rotate-angle-linear] h-8 w-8" />
							<p className="mt-3 text-[12px]">{t("remote.pairing.empty")}</p>
						</div>
					)}
					<div className="mt-4 border-t border-border/50 pt-3 text-[12px] leading-relaxed text-muted-foreground">
						<p>
							{state.lanPort
								? t("remote.pairing.lanListening", { port: state.lanPort })
								: t("remote.pairing.lanIdle")}
						</p>
						{state.lanEndpoints.length > 0 ? (
							<p className="mt-1 font-mono text-[11px] text-foreground/80">{state.lanEndpoints.join("  ·  ")}</p>
						) : null}
						<p className="mt-1">{t("remote.pairing.manualHint")}</p>
					</div>
				</div>
			</section>

			<section id="remote-cloud">
				<div className="flex items-center justify-between gap-4 py-3">
					<div>
						<h2 className="text-[14px] font-semibold text-foreground">{t("remote.cloud.title")}</h2>
						<p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
							{state.relayBaseUrl
								? t("remote.cloud.description", { relay: state.relayBaseUrl.replace(/^wss?:\/\//, "") })
								: t("remote.cloud.unavailable")}
						</p>
					</div>
					<Switch
						checked={state.cloudEnabled}
						disabled={busy || !state.relayBaseUrl}
						onCheckedChange={(enabled) => void run(() => window.vetta.remotePairing.setCloudEnabled(enabled))}
					/>
				</div>
				<p className="text-[12px] leading-relaxed text-muted-foreground/80">{t("remote.cloud.privacy")}</p>
			</section>
		</div>
	);
}

function DeviceRow({
	device,
	busy,
	onRevoke,
}: {
	device: RemotePairingDevice;
	busy: boolean;
	onRevoke: () => void;
}): JSX.Element {
	const { t } = useTranslation("settings");
	const channel = device.channels.includes("lan") ? "lan" : device.channels.includes("relay") ? "relay" : undefined;
	return (
		<li className="flex items-center justify-between gap-4 rounded-xl border border-border/50 bg-card/40 px-3.5 pt-3 pb-3">
			<div className="flex min-w-0 items-center gap-3">
				<span
					className={
						device.online
							? "h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400"
							: "h-2.5 w-2.5 shrink-0 rounded-full bg-muted-foreground/40"
					}
				/>
				<div className="min-w-0">
					<div className="truncate text-[13px] font-medium text-foreground">{device.name || t("remote.devices.unnamed")}</div>
					<div className="mt-0.5 text-[12px] text-muted-foreground">
						{device.online && channel
							? t(`remote.devices.online.${channel}`)
							: device.lastSeenAt
								? t("remote.devices.lastSeen", { time: new Date(device.lastSeenAt).toLocaleString() })
								: t("remote.devices.neverSeen")}
					</div>
				</div>
			</div>
			<Button variant="outline" size="sm" disabled={busy} onClick={onRevoke}>
				<span className="icon-[solar--link-broken-linear] h-3.5 w-3.5" />
				{t("remote.devices.revoke")}
			</Button>
		</li>
	);
}
