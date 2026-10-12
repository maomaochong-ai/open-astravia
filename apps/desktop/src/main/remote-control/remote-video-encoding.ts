import type { CommandLine } from "electron";

/** Chromium 132's Windows encoder reuse fails during size changes; recreate only the encoder (ADR-0149). */
export function configureRemoteVideoEncoding(
	commandLine: Pick<CommandLine, "getSwitchValue" | "appendSwitch">,
	platform: string,
	chromiumVersion: string,
): void {
	if (platform !== "win32" || chromiumVersion.split(".")[0] !== "132") return;
	const feature = "KeepEncoderInstanceOnRelease";
	const disabled = commandLine
		.getSwitchValue("disable-features")
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
	if (disabled.some((value) => value.split(/[<:]/)[0] === feature)) return;
	commandLine.appendSwitch("disable-features", [...disabled, feature].join(","));
}
