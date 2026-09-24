import type { JSX } from "react";
import { SettingRow } from "./SettingChrome";

export type EnvironmentGitInstallGuideView =
	| { readonly kind: "xcode-clt" }
	| { readonly kind: "managed-download"; readonly version: string }
	| { readonly kind: "package-manager"; readonly command: string | null }
	| { readonly kind: "manual" };

export interface EnvironmentGitStatusView {
	readonly available: boolean;
	readonly source?: "managed" | "system";
	readonly version?: string;
	readonly install: EnvironmentGitInstallGuideView;
}

export interface EnvironmentGitViewLabels {
	readonly copied: string;
	readonly copy: string;
	readonly description: string;
	readonly detecting: string;
	readonly download: string;
	readonly installManaged: string;
	readonly installXcode: string;
	readonly installing: string;
	readonly managedHint: string;
	readonly managedSuffix: string;
	readonly manualHint: string;
	readonly missing: string;
	readonly packageManagerFallback: string;
	readonly packageManagerHint: string;
	readonly ready: string;
	readonly redetect: string;
	readonly xcodeHint: string;
	readonly xcodeLaunched: string;
}

export interface EnvironmentGitRowViewProps {
	readonly busy: "detect" | "install" | null;
	readonly commandCopied: boolean;
	readonly installerLaunched: boolean;
	readonly labels: EnvironmentGitViewLabels;
	readonly onCopyCommand: (command: string) => void;
	readonly onInstall: () => void;
	readonly onOpenDownload: () => void;
	readonly onRedetect: () => void;
	readonly status: EnvironmentGitStatusView;
}

const BUTTON_CLASS =
	"flex items-center gap-1.5 rounded-lg border border-input bg-secondary px-3 py-1.5 text-[12px] text-foreground transition-colors hover:bg-accent disabled:opacity-50";
const LINK_CLASS = "text-primary underline-offset-2 hover:underline";

function GitInstallHint({
	commandCopied,
	installerLaunched,
	labels,
	onCopyCommand,
	onOpenDownload,
	status,
}: EnvironmentGitRowViewProps): JSX.Element {
	const guide = status.install;
	if (guide.kind === "xcode-clt") {
		return <p>{installerLaunched ? labels.xcodeLaunched : labels.xcodeHint}</p>;
	}
	if (guide.kind === "managed-download") {
		return (
			<p>
				{labels.managedHint}{" "}
				<button type="button" className={LINK_CLASS} onClick={onOpenDownload}>
					{labels.download}
				</button>
			</p>
		);
	}
	if (guide.kind === "package-manager" && guide.command) {
		const { command } = guide;
		return (
			<div className="space-y-2">
				<p>{labels.packageManagerHint}</p>
				<div className="flex items-center gap-2">
					<code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2.5 py-1.5 font-mono text-[12px] text-foreground">
						{command}
					</code>
					<button type="button" className={BUTTON_CLASS} onClick={() => onCopyCommand(command)}>
						<span className="icon-[mdi--content-copy] h-3.5 w-3.5 text-muted-foreground" />
						{commandCopied ? labels.copied : labels.copy}
					</button>
				</div>
			</div>
		);
	}
	return (
		<p>
			{guide.kind === "package-manager" ? labels.packageManagerFallback : labels.manualHint}{" "}
			<button type="button" className={LINK_CLASS} onClick={onOpenDownload}>
				{labels.download}
			</button>
		</p>
	);
}

/** Git 行：可用时显示版本与来源，缺失时给出当前平台的安装引导。 */
export function EnvironmentGitRowView(props: EnvironmentGitRowViewProps): JSX.Element {
	const { busy, labels, onInstall, onRedetect, status } = props;
	const guide = status.install;
	const installLabel =
		guide.kind === "xcode-clt" ? labels.installXcode : guide.kind === "managed-download" ? labels.installManaged : null;
	const readyText = [labels.ready, status.version, status.source === "managed" ? labels.managedSuffix : null]
		.filter(Boolean)
		.join(" · ");

	return (
		<>
			<SettingRow title="Git" description={labels.description} border={false}>
				<div className="flex items-center gap-3">
					<div className="flex items-center gap-1.5">
						<span
							className={
								status.available
									? "icon-[mdi--check-circle] h-4 w-4 text-emerald-500"
									: "icon-[mdi--alert-circle-outline] h-4 w-4 text-amber-500"
							}
						/>
						<span className={`text-[12px] ${status.available ? "text-emerald-500" : "text-amber-500"}`}>
							{status.available ? readyText : busy === "install" ? labels.installing : labels.missing}
						</span>
					</div>
					{!status.available && installLabel && (
						<button type="button" disabled={busy !== null} onClick={onInstall} className={BUTTON_CLASS}>
							{busy === "install" ? (
								<span className="icon-[mdi--loading] h-3.5 w-3.5 animate-spin" />
							) : (
								<span className="icon-[mdi--download-outline] h-3.5 w-3.5 text-muted-foreground" />
							)}
							{installLabel}
						</button>
					)}
					{!status.available && (
						<button type="button" disabled={busy !== null} onClick={onRedetect} className={BUTTON_CLASS}>
							<span
								className={`icon-[mdi--refresh] h-3.5 w-3.5 text-muted-foreground ${busy === "detect" ? "animate-spin" : ""}`}
							/>
							{busy === "detect" ? labels.detecting : labels.redetect}
						</button>
					)}
				</div>
			</SettingRow>
			{!status.available && (
				<div className="px-5 pb-4 text-[12px] leading-relaxed text-muted-foreground">
					<GitInstallHint {...props} />
				</div>
			)}
		</>
	);
}
