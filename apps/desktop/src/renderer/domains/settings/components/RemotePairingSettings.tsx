import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
import { Switch } from "@shared/components/ui/switch";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import QRCode from "qrcode";
import type { RemotePairingState } from "../../../../preload/api-types/remote-pairing";

const DEFAULT_RELAY = "https://relay.flowerwine.dpdns.org";

export function RemotePairingSettings(): JSX.Element {
	const { t } = useTranslation("settings");
	const [state, setState] = useState<RemotePairingState>({ status: "idle", inputEnabled: false, inputSupported: false });
	const [relay, setRelay] = useState(DEFAULT_RELAY);
	const [qr, setQr] = useState<string>();
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		const sync = (): void => {
			void window.vetta.remotePairing.getState().then((next) => {
				setState(next);
				if (next.relayBaseUrl) setRelay(next.relayBaseUrl.replace(/^ws/, "http"));
			});
		};
		sync();
		const timer = window.setInterval(sync, 1000);
		return () => window.clearInterval(timer);
	}, []);

	useEffect(() => {
		if (!state.inviteUri) {
			setQr(undefined);
			return;
		}
		void QRCode.toDataURL(state.inviteUri, { width: 280, margin: 1, errorCorrectionLevel: "M" }).then(setQr);
	}, [state.inviteUri]);

	const statusLabel = useMemo(() => t(`remote.status.${state.status}`), [state.status, t]);

	const create = async (): Promise<void> => {
		setBusy(true);
		try {
			setState(await window.vetta.remotePairing.create(relay));
		} catch {
			setState((current) => ({ ...current, status: "error" }));
		} finally {
			setBusy(false);
		}
	};

	const setInputEnabled = async (enabled: boolean): Promise<void> => {
		try {
			setState(await window.vetta.remotePairing.setInputEnabled(enabled));
		} catch {
			setState((current) => ({ ...current, status: "error" }));
		}
	};

	const revoke = async (): Promise<void> => {
		try {
			setState(await window.vetta.remotePairing.revoke());
		} catch {
			setState((current) => ({ ...current, status: "error" }));
		}
	};

	return (
		<div className="mx-auto w-full max-w-[680px] px-8 pt-2 pb-8">
			<div className="mb-6">
				<h1 className="text-[20px] font-bold text-foreground">{t("remote.title")}</h1>
				<p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{t("remote.description")}</p>
			</div>

			<section id="remote-pairing" className="mb-7">
				<div className="mb-3 flex items-center justify-between gap-3">
					<div>
						<h2 className="text-[14px] font-semibold text-foreground">{t("remote.pairingTitle")}</h2>
						<p className="mt-1 text-[12px] text-muted-foreground">{t("remote.pairingDescription")}</p>
					</div>
					<span className={state.status === "ready" ? "text-[12px] text-emerald-400" : "text-[12px] text-muted-foreground"}>{statusLabel}</span>
				</div>
				<div className="flex gap-2">
					<Input value={relay} onChange={(event) => setRelay(event.target.value)} aria-label={t("remote.relayLabel")} />
					<Button onClick={() => void create()} disabled={busy || !relay.trim()}>
						<span className="icon-[solar--qr-code-linear] h-4 w-4" />
						{busy ? t("remote.creating") : t("remote.create")}
					</Button>
				</div>
				<div className="mt-5 min-h-[310px] overflow-hidden border-y border-border/50 py-5">
					{qr ? (
						<div className="flex flex-col items-center animate-in fade-in zoom-in-95 duration-200">
							<img src={qr} alt={t("remote.qrAlt")} className="h-[280px] w-[280px] rounded-lg bg-white p-2" />
							<p className="mt-3 max-w-[360px] text-center text-[12px] leading-relaxed text-muted-foreground">{t("remote.qrHint")}</p>
						</div>
					) : (
						<div className="flex min-h-[270px] flex-col items-center justify-center text-muted-foreground">
							<span className="icon-[solar--smartphone-rotate-angle-linear] h-9 w-9" />
							<p className="mt-3 text-[12px]">{t("remote.empty")}</p>
						</div>
					)}
				</div>
			</section>

			<section id="remote-permissions">
				<div className="flex items-center justify-between gap-4 py-3">
					<div>
						<h2 className="text-[14px] font-semibold text-foreground">{t("remote.inputTitle")}</h2>
						<p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{t("remote.inputDescription")}</p>
					</div>
					<Switch
						checked={state.inputEnabled}
						disabled={(state.status !== "ready" && state.status !== "connected") || !state.inputSupported}
						onCheckedChange={(enabled) => void setInputEnabled(enabled)}
					/>
				</div>
				{state.status === "ready" || state.status === "connected" ? (
					<Button variant="outline" onClick={() => void revoke()}>
						<span className="icon-[solar--link-broken-linear] h-4 w-4" />
						{t("remote.revoke")}
					</Button>
				) : null}
			</section>
		</div>
	);
}
