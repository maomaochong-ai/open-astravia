import { Button } from "@shared/components/ui/button";
import { Switch } from "@shared/components/ui/switch";
import type { ReactNode } from "react";
import { Fragment, useState } from "react";
import { RemoteRelayDialog } from "./RemoteRelayDialog";
import type { RemotePairingSettingsModel } from "./useRemotePairingSettingsModel";

/**
 * A code shown the way it is typed on the phone: each `-`-separated group in one box,
 * its characters split by hairlines, with a short dash between the boxes. The whole
 * value stays readable by screen readers and text search.
 */
function CodeBoxes({ label, value }: { label: string; value: string }): JSX.Element {
	const groups = value.split("-");
	return (
		<div className="flex flex-col">
			<dt className="text-[11px] text-muted-foreground">{label}</dt>
			<dd className="mt-1.5">
				<span className="sr-only">{value}</span>
				<span aria-hidden="true" className="flex items-center gap-2">
					{groups.map((group, groupIndex) => (
						<Fragment key={groupIndex}>
							{groupIndex > 0 ? <span className="h-0.5 w-3 rounded-full bg-muted-foreground/50" /> : null}
							<span className="flex h-11 divide-x divide-border overflow-hidden rounded-lg border border-border bg-card">
								{[...group].map((char, index) => (
									<span
										key={index}
										className="flex w-9 items-center justify-center font-mono text-[20px] font-semibold text-foreground"
									>
										{char}
									</span>
								))}
							</span>
						</Fragment>
					))}
				</span>
			</dd>
		</div>
	);
}

/** Quiet corner ticks so the empty slot still reads as a code frame, not a blank card. */
function QrFrameMarks(): JSX.Element {
	const mark = "pointer-events-none absolute h-5 w-5 border-muted-foreground/30";
	return (
		<>
			<span className={`${mark} top-3 left-3 rounded-tl-md border-t border-l`} />
			<span className={`${mark} top-3 right-3 rounded-tr-md border-t border-r`} />
			<span className={`${mark} bottom-3 left-3 rounded-bl-md border-b border-l`} />
			<span className={`${mark} right-3 bottom-3 rounded-br-md border-b border-r`} />
		</>
	);
}

function PreparingQr({ label }: { label: string }): JSX.Element {
	return (
		<div
			role="status"
			className="relative flex h-full w-full flex-col items-center justify-center rounded-2xl border border-border bg-card px-6 text-center"
		>
			<QrFrameMarks />
			<span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
				<span
					className="icon-[solar--refresh-linear] h-5 w-5 animate-spin motion-reduce:animate-none"
					aria-hidden="true"
				/>
			</span>
			<p className="processing-shimmer mt-3 text-[12px] leading-relaxed">{label}</p>
		</div>
	);
}

function PlaceholderGlyph(): JSX.Element {
	return (
		<span className="flex w-9 items-center justify-center">
			<span className="h-1 w-3 rounded-full bg-muted-foreground/25" />
		</span>
	);
}

/**
 * Same boxes as a ready connection code, with the glyphs not filled in yet.
 * The password box reserves the width of six digits so the row does not jump when they arrive.
 */
function PreparingCodes({ codeLabel, passwordLabel }: { codeLabel: string; passwordLabel: string }): JSX.Element {
	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col">
				<div className="text-[11px] text-muted-foreground">{codeLabel}</div>
				<div className="mt-1.5 flex items-center gap-2" aria-hidden="true">
					<span className="flex h-11 divide-x divide-border overflow-hidden rounded-lg border border-border bg-card">
						<PlaceholderGlyph />
						<PlaceholderGlyph />
						<PlaceholderGlyph />
						<PlaceholderGlyph />
					</span>
					<span className="h-0.5 w-3 rounded-full bg-muted-foreground/50" />
					<span className="flex h-11 divide-x divide-border overflow-hidden rounded-lg border border-border bg-card">
						<PlaceholderGlyph />
						<PlaceholderGlyph />
						<PlaceholderGlyph />
						<PlaceholderGlyph />
					</span>
				</div>
			</div>
			<div className="flex flex-col">
				<div className="text-[11px] text-muted-foreground">{passwordLabel}</div>
				<div
					className="relative mt-1.5 flex h-11 items-center self-start rounded-lg border border-border bg-card pr-[calc(1rem-0.3em)] pl-4"
					aria-hidden="true"
				>
					<span className="invisible font-mono text-[20px] font-semibold tracking-[0.3em]">000000</span>
					<span className="absolute inset-0 flex items-center justify-center gap-1.5">
						{Array.from({ length: 6 }, (_, index) => (
							<span key={index} className="h-1 w-2.5 rounded-full bg-muted-foreground/25" />
						))}
					</span>
				</div>
			</div>
		</div>
	);
}

function RefreshInviteButton({
	label,
	spinning,
	disabled,
	onClick,
}: {
	label: string;
	spinning: boolean;
	disabled: boolean;
	onClick: () => void;
}): JSX.Element {
	return (
		<Button
			variant="ghost"
			size="icon-sm"
			className="shrink-0"
			aria-label={label}
			title={label}
			disabled={disabled}
			onClick={onClick}
		>
			<span
				className={`icon-[solar--refresh-linear] h-3.5 w-3.5 ${spinning ? "animate-spin text-primary motion-reduce:animate-none" : ""}`}
				aria-hidden="true"
			/>
		</Button>
	);
}

/** Held to the QR code's height so the two sides stay level whatever the code's state. */
function PairingAside({
	header,
	action,
	children,
}: {
	header: string;
	action?: ReactNode;
	children: ReactNode;
}): JSX.Element {
	return (
		<div className="flex h-[184px] w-[360px] flex-col justify-between">
			<div className="-mr-2 flex min-h-7 items-center justify-between gap-2">
				<p className="line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">{header}</p>
				{action}
			</div>
			{children}
		</div>
	);
}

function PairingPanel({ model }: { model: RemotePairingSettingsModel }): JSX.Element {
	const [manualOpen, setManualOpen] = useState(false);
	const { pairing, labels } = model;
	const code = pairing.code;
	const codeStatus =
		code?.status === "preparing" ? labels.pairing.codePreparing : code?.status === "ready" ? undefined : labels.pairing.codeFailed;
	// While a refresh is in flight the current code is already being withdrawn.
	const showLiveQr = Boolean(pairing.qrDataUrl) && !pairing.renewing;
	const showPreparing = !showLiveQr && (pairing.preparing || pairing.renewing);
	const refreshSpinning = pairing.preparing || pairing.renewing;
	const refreshButton =
		pairing.hasInvite || pairing.renewing ? (
			<RefreshInviteButton
				label={labels.pairing.cancel}
				spinning={refreshSpinning}
				disabled={model.busy || refreshSpinning}
				onClick={model.actions.cancelInvite}
			/>
		) : null;

	return (
		<div>
			{!pairing.vaultAvailable ? (
				<p className="mb-3 text-[12px] text-destructive">{labels.pairing.vaultUnavailable}</p>
			) : null}

			<div className="flex items-center gap-8">
				<div
					className={`flex h-[184px] w-[184px] shrink-0 items-center justify-center rounded-2xl ${showLiveQr || showPreparing ? "" : "bg-muted/60"}`}
				>
					{showLiveQr && pairing.qrDataUrl ? (
						<div className="relative h-full w-full rounded-2xl bg-white p-3">
							<img src={pairing.qrDataUrl} alt={labels.pairing.qrAlt} className="block h-full w-full" />
							{pairing.qrBadge ? (
								<span
									aria-hidden="true"
									className="absolute top-1/2 left-1/2 flex aspect-square -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-white"
									style={{ width: `calc((100% - 1.5rem) * ${pairing.qrBadge})`, background: "var(--chart-2)" }}
								>
									<span className="icon-[solar--link-round-linear] h-1/2 w-1/2" />
								</span>
							) : null}
						</div>
					) : showPreparing ? (
						<PreparingQr label={labels.pairing.generating} />
					) : (
						<div className="flex flex-col items-center px-3 text-center text-muted-foreground">
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

				{showLiveQr ? (
					<PairingAside header={labels.pairing.codeHint} action={pairing.hasInvite ? refreshButton : null}>
						{code?.status === "ready" ? (
							<dl className="flex flex-col gap-3">
								<CodeBoxes label={labels.pairing.code} value={code.code} />
								<div className="flex flex-col">
									<dt className="text-[11px] text-muted-foreground">{labels.pairing.password}</dt>
									<dd className="mt-1.5 flex h-11 items-center self-start rounded-lg border border-border bg-card pr-[calc(1rem-0.3em)] pl-4 font-mono text-[20px] font-semibold tracking-[0.3em] text-foreground select-all">
										{code.password}
									</dd>
								</div>
							</dl>
						) : code?.status === "preparing" ? (
							<PreparingCodes codeLabel={labels.pairing.code} passwordLabel={labels.pairing.password} />
						) : (
							<div className="flex h-[144px] items-center justify-center rounded-xl border border-border bg-card px-4 text-center text-[12px] text-muted-foreground">
								{codeStatus}
							</div>
						)}
					</PairingAside>
				) : showPreparing ? (
					<PairingAside header={labels.pairing.codePreparing} action={refreshButton}>
						<PreparingCodes codeLabel={labels.pairing.code} passwordLabel={labels.pairing.password} />
					</PairingAside>
				) : null}
			</div>

			{pairing.endpoints.length > 0 ? (
				<div className="mt-4 -ml-2.5">
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
						<div id="remote-manual-endpoints" className="mt-1 flex flex-col gap-1 pl-2.5">
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

/** Same rhythm as a paired-phone row, so the empty section is a place a phone will land. */
function EmptyPhones({ title, hint }: { title: string; hint: string }): JSX.Element {
	return (
		<div className="flex items-center gap-3.5 rounded-xl bg-muted/40 px-3 py-3">
			<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-dashed border-border bg-background text-muted-foreground">
				<span className="icon-[solar--smartphone-2-linear] h-4.5 w-4.5" aria-hidden="true" />
			</span>
			<div className="min-w-0">
				<p className="text-[13px] font-medium text-foreground">{title}</p>
				<p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{hint}</p>
			</div>
		</div>
	);
}

/** One borderless row: a round icon, what it is, and its control on the right. */
function Row({
	icon,
	title,
	detail,
	detailClassName = "text-muted-foreground",
	children,
}: {
	icon: string;
	title: string;
	detail: ReactNode;
	detailClassName?: string;
	children?: ReactNode;
}): JSX.Element {
	return (
		<div className="flex items-center gap-3.5 rounded-xl px-3 py-2.5 transition-colors duration-200 hover:bg-accent/40">
			<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
				<span className={`${icon} h-4.5 w-4.5`} aria-hidden="true" />
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
		<div className="mx-auto w-full max-w-[680px] px-8 pt-2 pb-12">
			<h1 className="text-[20px] font-bold text-foreground">{labels.title}</h1>
			<p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{labels.description}</p>

			{model.error ? (
				<div role="alert" className="mt-5 rounded-xl bg-destructive/10 px-4 py-3 text-[12px] text-destructive">
					{model.error}
				</div>
			) : null}

			{model.approvals.length > 0 ? (
				<section id="remote-approvals" className="mt-6 flex flex-col gap-2.5">
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

			<section id="remote-pairing" className="mt-8">
				<PairingPanel model={model} />
			</section>

			<section id="remote-devices" className="mt-8">
				<SectionTitle count={model.devices.length}>{labels.devices.title}</SectionTitle>
				{model.devices.length === 0 ? (
					<EmptyPhones title={labels.devices.empty} hint={labels.devices.emptyHint} />
				) : (
					<ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-x-2">
						{model.devices.map((device) => (
							<li key={device.id}>
								<Row
									icon="icon-[solar--smartphone-2-linear]"
									title={device.name}
									detail={device.status}
									detailClassName={device.online ? "text-foreground" : "text-muted-foreground"}
								>
									<div className="flex shrink-0 items-center gap-0.5">
										{/* Screen control needs the phone connected and the relay on; otherwise the button would do nothing. */}
										{device.online && model.cloud.enabled ? (
											<Button
												variant="ghost"
												size="icon-sm"
												aria-pressed={device.desktopControl}
												aria-label={`${device.name} · ${labels.devices.desktop}`}
												title={labels.devices.desktop}
												className="overflow-visible text-foreground"
												disabled={model.busy}
												onClick={() => model.actions.setDesktopControl(device.id, !device.desktopControl)}
											>
												<span className="relative h-4 w-4">
													<span className="icon-[solar--monitor-linear] h-4 w-4" aria-hidden="true" />
													<span
														aria-hidden="true"
														className={`absolute -right-1 -bottom-1 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-background ${device.desktopControl ? "text-emerald-500" : "text-red-500"}`}
													>
														<span
															className={
																device.desktopControl
																	? "icon-[solar--check-circle-bold] h-2.5 w-2.5"
																	: "icon-[solar--close-circle-bold] h-2.5 w-2.5"
															}
														/>
													</span>
												</span>
											</Button>
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
									</div>
								</Row>
							</li>
						))}
					</ul>
				)}
			</section>

			<section id="remote-cloud" className="mt-8">
				<SectionTitle>{labels.cloud.section}</SectionTitle>
				<Row
					icon="icon-[solar--global-linear]"
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
