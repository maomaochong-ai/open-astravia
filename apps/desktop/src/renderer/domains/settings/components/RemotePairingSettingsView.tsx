import { Button } from "@shared/components/ui/button";
import { Switch } from "@shared/components/ui/switch";
import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";
import { RemoteRelayDialog } from "./RemoteRelayDialog";
import type { RemotePairingSettingsModel } from "./useRemotePairingSettingsModel";

/** The beacon's blue at a given strength; `--chart-2` is the theme's blue in both light and dark. */
function beaconBlue(percent: number): string {
	return `color-mix(in srgb, var(--chart-2) ${percent}%, transparent)`;
}

/** Rings around the beacon, innermost first: diameter and strength of the blue. */
const HALOS = [
	{ size: 88, percent: 22 },
	{ size: 140, percent: 13 },
	{ size: 196, percent: 8 },
	{ size: 256, percent: 4 },
] as const;

/**
 * The page's backdrop illustration in the top-right corner: a link at the centre of
 * blue rings, like a signal looking for a phone. Static on purpose, so the translucent
 * window is not repainted for decoration.
 */
function PairingBeacon(): JSX.Element {
	return (
		<div aria-hidden="true" className="pointer-events-none absolute top-0 right-0 h-[280px] w-[320px] overflow-hidden">
			<div className="absolute top-[110px] right-[120px] flex h-0 w-0 items-center justify-center">
				<span
					className="absolute h-[360px] w-[360px] rounded-full"
					style={{ background: `radial-gradient(closest-side, ${beaconBlue(10)}, transparent)` }}
				/>
				{HALOS.map((halo) => (
					<span
						key={halo.size}
						className="absolute rounded-full"
						style={{ width: halo.size, height: halo.size, background: beaconBlue(halo.percent) }}
					/>
				))}
				<span
					className="absolute flex h-14 w-14 items-center justify-center rounded-full text-white"
					style={{ background: "var(--chart-2)" }}
				>
					<span className="icon-[solar--link-round-linear] h-6 w-6" />
				</span>
			</div>
		</div>
	);
}

function PairingPanel({ model }: { model: RemotePairingSettingsModel }): JSX.Element {
	const [manualOpen, setManualOpen] = useState(false);
	const { pairing, labels } = model;
	const code = pairing.code;

	return (
		<div className="px-3">
			{!pairing.vaultAvailable ? (
				<p className="mb-3 text-[12px] text-destructive">{labels.pairing.vaultUnavailable}</p>
			) : null}

			<div className="flex flex-wrap items-center gap-x-10 gap-y-6">
				<div className="flex h-[176px] w-[176px] shrink-0 items-center justify-center">
					{pairing.qrDataUrl ? (
						<img
							src={pairing.qrDataUrl}
							alt={labels.pairing.qrAlt}
							className="block aspect-square w-full rounded-xl bg-white p-2"
						/>
					) : pairing.preparing ? (
						<div className="flex flex-col items-center text-muted-foreground">
							<span className="icon-[solar--refresh-linear] h-8 w-8 animate-spin" aria-hidden="true" />
							<p className="mt-3 text-[12px]">{labels.pairing.generating}</p>
						</div>
					) : (
						<div className="flex flex-col items-center text-muted-foreground">
							<span className="icon-[solar--qr-code-linear] h-8 w-8" aria-hidden="true" />
							<p className="mt-3 text-[12px]">{labels.pairing.empty}</p>
							{pairing.canCreate ? (
								<Button size="sm" className="mt-3" disabled={model.busy} onClick={model.actions.createInvite}>
									{labels.pairing.create}
								</Button>
							) : null}
						</div>
					)}
				</div>

				{pairing.qrDataUrl ? (
					<div className="flex max-w-[260px] min-w-[220px] flex-1 flex-col">
						<p className="text-[12px] leading-relaxed text-muted-foreground">{labels.pairing.qrHint}</p>
						{code ? (
							<div className="mt-6">
								<p className="text-[12px] leading-relaxed text-muted-foreground">
									{code.status === "ready"
										? labels.pairing.codeHint
										: code.status === "preparing"
											? labels.pairing.codePreparing
											: labels.pairing.codeFailed}
								</p>
								{code.status === "ready" ? (
									<dl className="mt-3 flex flex-col gap-3">
										<div>
											<dt className="text-[11px] text-muted-foreground/70">{labels.pairing.code}</dt>
											<dd className="font-mono text-[20px] font-semibold tracking-[0.08em] whitespace-nowrap text-foreground select-all">
												{code.code}
											</dd>
										</div>
										<div>
											<dt className="text-[11px] text-muted-foreground/70">{labels.pairing.password}</dt>
											<dd className="font-mono text-[20px] font-semibold tracking-[0.08em] whitespace-nowrap text-foreground select-all">
												{code.password}
											</dd>
										</div>
									</dl>
								) : null}
							</div>
						) : null}
						{pairing.hasInvite ? (
							<Button
								variant="ghost"
								size="sm"
								className="mt-4 -ml-2.5 self-start"
								disabled={model.busy}
								onClick={model.actions.cancelInvite}
							>
								<span className="icon-[solar--refresh-linear] h-3.5 w-3.5" aria-hidden="true" />
								{labels.pairing.cancel}
							</Button>
						) : null}
					</div>
				) : null}
			</div>

			{pairing.endpoints.length > 0 ? (
				<div className="mt-5 -ml-2.5">
					<Button
						variant="ghost"
						size="sm"
						className="font-normal"
						aria-expanded={manualOpen}
						aria-controls="remote-manual-endpoints"
						onClick={() => setManualOpen((open) => !open)}
					>
						{labels.pairing.manualTitle}
						<span
							className={`icon-[solar--alt-arrow-down-linear] h-3.5 w-3.5 transition-transform duration-200 ${manualOpen ? "rotate-180" : ""}`}
							aria-hidden="true"
						/>
					</Button>
					{manualOpen ? (
						<div id="remote-manual-endpoints" className="mt-1 flex flex-col gap-1.5 pl-2.5">
							<p className="text-[12px] text-muted-foreground">{labels.pairing.manualHint}</p>
							{pairing.endpoints.map((endpoint) => (
								<span key={endpoint} className="font-mono text-[13px] text-foreground select-all">
									{endpoint}
								</span>
							))}
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}

function SectionTitle({ children, count }: { children: string; count?: number }): JSX.Element {
	return (
		<h2 className="mb-2 flex items-baseline gap-2 px-3 text-[13px] font-semibold text-foreground">
			{children}
			{count ? <span className="text-[12px] font-normal text-muted-foreground">{count}</span> : null}
		</h2>
	);
}

/** One borderless row: a round icon, what it is, and its control on the right. */
function Row({
	icon,
	iconClassName,
	iconStyle,
	title,
	detail,
	detailClassName = "text-muted-foreground",
	children,
}: {
	icon: string;
	iconClassName: string;
	iconStyle?: CSSProperties;
	title: string;
	detail: ReactNode;
	detailClassName?: string;
	children?: ReactNode;
}): JSX.Element {
	return (
		<div className="flex items-center gap-3.5 rounded-xl px-3 py-3 transition-colors duration-200 hover:bg-accent/40">
			<span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${iconClassName}`} style={iconStyle}>
				<span className={`${icon} h-5 w-5`} aria-hidden="true" />
			</span>
			<div className="min-w-0 flex-1">
				<div className="truncate text-[13px] font-medium text-foreground">{title}</div>
				<div className={`mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-[12px] ${detailClassName}`}>{detail}</div>
			</div>
			{children}
		</div>
	);
}

export function RemotePairingSettingsView({ model }: { model: RemotePairingSettingsModel }): JSX.Element {
	const [relayOpen, setRelayOpen] = useState(false);
	const { labels } = model;
	return (
		<div className="relative mx-auto w-full max-w-[680px] px-8 pt-2 pb-12">
			<PairingBeacon />
			<div className="relative max-w-[380px]">
				<h1 className="text-[20px] font-bold text-foreground">{labels.title}</h1>
				<p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{labels.description}</p>
			</div>

			{model.error ? (
				<div role="alert" className="relative mt-5 rounded-xl bg-destructive/10 px-4 py-3 text-[12px] text-destructive">
					{model.error}
				</div>
			) : null}

			{model.approvals.length > 0 ? (
				<section id="remote-approvals" className="relative mt-6 flex flex-col gap-2.5">
					{model.approvals.map((approval) => (
						<div key={approval.id} className="rounded-xl bg-amber-500/15 px-4 py-4">
							<div className="flex items-center justify-between gap-4">
								<div className="min-w-0">
									<div className="text-[12px] text-amber-400">{labels.approvals.title}</div>
									<div className="mt-1 truncate text-[13px] font-medium text-foreground">{approval.deviceName}</div>
									<div className="mt-0.5 text-[12px] text-muted-foreground">{labels.approvals.hint}</div>
								</div>
								<div className="font-mono text-[20px] font-semibold tracking-[0.3em] text-foreground">
									{approval.code}
								</div>
							</div>
							<div className="mt-3 flex gap-2">
								<Button size="sm" disabled={model.busy} onClick={() => model.actions.approve(approval.id, true)}>
									{labels.approvals.allow}
								</Button>
								<Button
									size="sm"
									variant="ghost"
									disabled={model.busy}
									onClick={() => model.actions.approve(approval.id, false)}
								>
									{labels.approvals.deny}
								</Button>
							</div>
						</div>
					))}
				</section>
			) : null}

			<section id="remote-pairing" className="relative mt-24">
				<SectionTitle>{labels.pairing.title}</SectionTitle>
				<PairingPanel model={model} />
			</section>

			<section id="remote-devices" className="mt-14">
				<SectionTitle count={model.devices.length}>{labels.devices.title}</SectionTitle>
				{model.devices.length === 0 ? (
					<p className="px-3 py-3 text-[12px] text-muted-foreground">{labels.devices.empty}</p>
				) : (
					<ul className="flex flex-col">
						{model.devices.map((device) => (
							<li key={device.id}>
								<Row
									icon="icon-[solar--smartphone-2-linear]"
									iconClassName={
										device.online ? "bg-emerald-500/15 text-emerald-400" : "bg-muted text-muted-foreground/60"
									}
									title={device.name}
									detail={device.status}
									detailClassName={device.online ? "text-emerald-400" : "text-muted-foreground"}
								>
									{/* Remote control needs the phone connected and the relay on; otherwise the switch would do nothing. */}
									{device.online && model.cloud.enabled ? (
										<label className="flex shrink-0 items-center gap-2 text-[12px] text-muted-foreground">
											{labels.devices.control}
											<Switch
												aria-label={`${device.name} · ${labels.devices.control}`}
												checked={device.desktopControl}
												disabled={model.busy}
												onCheckedChange={(enabled) => model.actions.setDesktopControl(device.id, enabled)}
											/>
										</label>
									) : null}
									<Button
										variant="ghost"
										size="icon-sm"
										className="shrink-0 hover:text-destructive"
										aria-label={`${device.name} · ${labels.devices.revoke}`}
										title={labels.devices.revoke}
										disabled={model.busy}
										onClick={() => model.actions.revokeDevice(device.id)}
									>
										<span className="icon-[solar--link-broken-linear] h-4 w-4" aria-hidden="true" />
									</Button>
								</Row>
							</li>
						))}
					</ul>
				)}
			</section>

			<section id="remote-cloud" className="mt-10">
				<SectionTitle>{labels.cloud.section}</SectionTitle>
				<Row
					icon="icon-[solar--global-linear]"
					iconClassName={model.cloud.enabled ? "" : "bg-muted text-muted-foreground"}
					iconStyle={
						model.cloud.enabled ? { background: beaconBlue(15), color: "var(--chart-2)" } : undefined
					}
					title={labels.cloud.title}
					detail={model.cloud.available ? labels.cloud.description : labels.cloud.unavailable}
				>
					<Switch
						aria-label={labels.cloud.title}
						checked={model.cloud.enabled}
						disabled={model.busy || !model.cloud.available}
						onCheckedChange={model.actions.setCloudEnabled}
					/>
				</Row>
				<Row
					icon="icon-[solar--server-linear]"
					iconClassName="bg-muted text-muted-foreground"
					title={labels.relay.label}
					detail={
						<>
							<span className="truncate font-mono">{model.cloud.relayHost ?? labels.relay.unset}</span>
							{model.cloud.relayHost && model.cloud.relayIsDefault ? (
								<span className="shrink-0 text-muted-foreground/60">· {labels.relay.defaultTag}</span>
							) : null}
						</>
					}
				>
					<Button variant="ghost" size="sm" className="shrink-0" onClick={() => setRelayOpen(true)}>
						{labels.relay.change}
					</Button>
				</Row>
				<RemoteRelayDialog
					open={relayOpen}
					onOpenChange={setRelayOpen}
					relayBaseUrl={model.cloud.relayBaseUrl}
					defaultRelayBaseUrl={model.cloud.defaultRelayBaseUrl}
					onSave={model.actions.setRelay}
					onTest={model.actions.testRelay}
				/>
			</section>
		</div>
	);
}
