import { Button } from "@shared/components/ui/button";
import { Switch } from "@shared/components/ui/switch";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RemoteRelayDialog } from "./RemoteRelayDialog";
import type { RemotePairingSettingsModel } from "./useRemotePairingSettingsModel";

export function RemotePairingSettingsView({ model }: { model: RemotePairingSettingsModel }): JSX.Element {
	const { t } = useTranslation("settings");
	const [relayOpen, setRelayOpen] = useState(false);
	return (
		<div className="mx-auto w-full max-w-[680px] px-8 pt-2 pb-8">
			<div className="mb-6">
				<h1 className="text-[20px] font-bold text-foreground">{model.labels.title}</h1>
				<p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{model.labels.description}</p>
			</div>

			{model.error ? (
				<div
					role="alert"
					className="mb-5 rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-[12px] text-destructive"
				>
					{model.error}
				</div>
			) : null}

			{model.approvals.length > 0 ? (
				<section id="remote-approvals" className="mb-7">
					<h2 className="text-[14px] font-semibold text-foreground">{model.labels.approvals.title}</h2>
					<p className="mt-1 text-[12px] text-muted-foreground">{model.labels.approvals.description}</p>
					<div className="mt-3 flex flex-col gap-3">
						{model.approvals.map((approval) => (
							<div
								key={approval.id}
								className="rounded-xl border border-amber-500/40 bg-amber-500/15 px-4 pt-3 pb-3"
							>
								<div className="flex items-center justify-between gap-4">
									<div className="min-w-0">
										<div className="truncate text-[13px] font-medium text-foreground">{approval.deviceName}</div>
										<div className="mt-0.5 text-[12px] text-muted-foreground">{model.labels.approvals.hint}</div>
									</div>
									<div className="font-mono text-[20px] font-semibold tracking-[0.3em] text-foreground">
										{approval.code}
									</div>
								</div>
								<div className="mt-3 flex gap-2">
									<Button size="sm" disabled={model.busy} onClick={() => model.actions.approve(approval.id, true)}>
										{model.labels.approvals.allow}
									</Button>
									<Button
										size="sm"
										variant="outline"
										disabled={model.busy}
										onClick={() => model.actions.approve(approval.id, false)}
									>
										{model.labels.approvals.deny}
									</Button>
								</div>
							</div>
						))}
					</div>
				</section>
			) : null}

			<section id="remote-pairing" className="mb-7">
				<div className="flex items-center justify-between gap-3">
					<h2 className="text-[14px] font-semibold text-foreground">{model.labels.pairing.title}</h2>
					{model.pairing.hasInvite ? (
						<Button variant="outline" size="sm" disabled={model.busy} onClick={model.actions.cancelInvite}>
							{model.labels.pairing.cancel}
						</Button>
					) : null}
				</div>
				{!model.pairing.vaultAvailable ? (
					<p className="mt-2 text-[12px] text-destructive">{model.labels.pairing.vaultUnavailable}</p>
				) : null}
				<div className="mt-4 rounded-xl border border-border/50 bg-card/40 px-4 pt-4 pb-4">
					{model.pairing.qrDataUrl ? (
						<div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
							{/* Scales with the page, always square. */}
							<div className="w-full max-w-[260px] min-w-[160px] shrink">
								<img
									src={model.pairing.qrDataUrl}
									alt={model.labels.pairing.qrAlt}
									className="block aspect-square h-auto w-full rounded-lg bg-white p-2"
								/>
							</div>
							<div className="flex min-w-0 flex-1 flex-col gap-3 text-[12px] leading-relaxed text-muted-foreground">
								<p>{model.labels.pairing.qrHint}</p>
								{model.pairing.code?.status === "ready" ? (
									<>
										<p>{model.labels.pairing.codeHint}</p>
										<dl className="grid grid-cols-2 gap-2">
											<div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
												<dt className="text-[11px]">{model.labels.pairing.code}</dt>
												<dd className="mt-0.5 font-mono text-[18px] font-semibold tracking-[0.08em] whitespace-nowrap text-foreground select-all">
													{model.pairing.code.code}
												</dd>
											</div>
											<div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
												<dt className="text-[11px]">{model.labels.pairing.password}</dt>
												<dd className="mt-0.5 font-mono text-[18px] font-semibold tracking-[0.08em] whitespace-nowrap text-foreground select-all">
													{model.pairing.code.password}
												</dd>
											</div>
										</dl>
									</>
								) : model.pairing.code ? (
									<p>
										{model.pairing.code.status === "preparing"
											? model.labels.pairing.codePreparing
											: model.labels.pairing.codeFailed}
									</p>
								) : null}
							</div>
						</div>
					) : model.pairing.preparing ? (
						<div className="flex min-h-[160px] flex-col items-center justify-center text-muted-foreground">
							<span className="icon-[solar--refresh-linear] h-8 w-8 animate-spin" aria-hidden="true" />
							<p className="mt-3 text-[12px]">{model.labels.pairing.generating}</p>
						</div>
					) : (
						<div className="flex min-h-[160px] flex-col items-center justify-center text-muted-foreground">
							<span className="icon-[solar--smartphone-rotate-angle-linear] h-8 w-8" aria-hidden="true" />
							<p className="mt-3 text-[12px]">{model.labels.pairing.empty}</p>
							{model.pairing.canCreate ? (
								<Button size="sm" className="mt-3" disabled={model.busy} onClick={model.actions.createInvite}>
									<span className="icon-[solar--qr-code-linear] h-3.5 w-3.5" aria-hidden="true" />
									{model.labels.pairing.create}
								</Button>
							) : null}
						</div>
					)}
					{model.pairing.endpoints.length > 0 ? (
						<div className="mt-4 border-t border-border/50 pt-3 text-[12px] leading-relaxed text-muted-foreground">
							<p>{model.labels.pairing.manualHint}</p>
							<p className="mt-1 font-mono text-[11px] text-foreground/80">{model.pairing.endpoints.join("  ·  ")}</p>
						</div>
					) : null}
				</div>
			</section>

			<section id="remote-cloud">
				<div className="flex items-center justify-between gap-4 py-3">
					<div>
						<h2 className="text-[14px] font-semibold text-foreground">{model.labels.cloud.title}</h2>
						<p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
							{model.cloud.available ? model.labels.cloud.description : model.labels.cloud.unavailable}
						</p>
					</div>
					<div className="flex shrink-0 items-center gap-2">
						<Button
							variant="ghost"
							size="icon"
							className="h-8 w-8"
							aria-label={t("remote.relay.title")}
							title={t("remote.relay.title")}
							onClick={() => setRelayOpen(true)}
						>
							<span className="icon-[solar--settings-linear] h-4 w-4" aria-hidden="true" />
						</Button>
						<Switch
							checked={model.cloud.enabled}
							disabled={model.busy || !model.cloud.available}
							onCheckedChange={model.actions.setCloudEnabled}
						/>
					</div>
				</div>
				<RemoteRelayDialog
					open={relayOpen}
					onOpenChange={setRelayOpen}
					relayBaseUrl={model.cloud.relayBaseUrl}
					defaultRelayBaseUrl={model.cloud.defaultRelayBaseUrl}
					onSave={model.actions.setRelay}
					onTest={model.actions.testRelay}
				/>
			</section>

			<section id="remote-devices" className="mt-7">
				<h2 className="text-[14px] font-semibold text-foreground">{model.labels.devices.title}</h2>
				{model.devices.length === 0 ? (
					<div className="mt-3 rounded-xl border border-border/50 bg-card/40 px-4 py-6 text-center text-[12px] text-muted-foreground">
						{model.labels.devices.empty}
					</div>
				) : (
					<ul className="mt-3 flex flex-col gap-2">
						{model.devices.map((device) => (
							<li
								key={device.id}
								className="flex items-center gap-4 rounded-xl border border-border/50 bg-card/40 px-3.5 py-3"
							>
								<span
									className={
										device.online
											? "h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400"
											: "h-2.5 w-2.5 shrink-0 rounded-full bg-muted-foreground/40"
									}
								/>
								<div className="min-w-0 flex-1">
									<div className="truncate text-[13px] font-medium text-foreground">{device.name}</div>
									<div className="mt-0.5 truncate text-[12px] text-muted-foreground">{device.status}</div>
								</div>
								{/* Remote control needs the phone connected and the relay on; otherwise the switch would do nothing. */}
								{device.online && model.cloud.enabled ? (
									<label className="flex shrink-0 items-center gap-2 text-[12px] text-muted-foreground">
										{model.labels.devices.control}
										<Switch
											aria-label={`${device.name} · ${model.labels.devices.control}`}
											checked={device.desktopControl}
											disabled={model.busy}
											onCheckedChange={(enabled) => model.actions.setDesktopControl(device.id, enabled)}
										/>
									</label>
								) : null}
								<Button
									variant="outline"
									size="sm"
									className="shrink-0"
									disabled={model.busy}
									onClick={() => model.actions.revokeDevice(device.id)}
								>
									<span className="icon-[solar--link-broken-linear] h-3.5 w-3.5" aria-hidden="true" />
									{model.labels.devices.revoke}
								</Button>
							</li>
						))}
					</ul>
				)}
			</section>
		</div>
	);
}
