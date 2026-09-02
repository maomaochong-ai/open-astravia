import { useTranslation } from "@vetta-org/plugin-sdk";
import { type JSX, useState } from "react";
import { MINIMUM_BAGUETTE_VERSION } from "../runtime/baguette-version.js";
import type { RuntimeState } from "../runtime/simulator-runtime.js";
import { DeviceIcon } from "./icons.js";

export const INSTALL_COMMAND = "brew install baguette";

interface RuntimeGateProps {
	readonly state: RuntimeState;
	readonly onRecheck: () => void;
}

/**
 * 运行时不可用时的面板内引导。
 *
 * 刻意不替用户跑安装：baguette 是 Homebrew 包，装它会动全局环境；面板给出
 * 可复制的命令并让用户自己执行，比插件静默改机器更符合预期。
 */
export function RuntimeGate({ state, onRecheck }: RuntimeGateProps): JSX.Element {
	const { t } = useTranslation();
	const [copied, setCopied] = useState(false);
	const unsupported = state.phase === "unsupported";
	const outdated = state.phase === "outdated";

	const copy = (): void => {
		void navigator.clipboard
			.writeText(INSTALL_COMMAND)
			.then(() => {
				setCopied(true);
				setTimeout(() => setCopied(false), 1500);
			})
			.catch(() => undefined);
	};

	return (
		<div className="flex h-full items-center justify-center p-5">
			<div className="ios-sim-card flex w-full max-w-sm flex-col items-center gap-3 p-6 text-center">
				<span className="text-muted-foreground/50">
					<DeviceIcon />
				</span>
				<h2 className="text-sm font-medium">
					{unsupported
						? t("gate.unsupported.title")
						: outdated
							? t("gate.outdated.title")
							: t("gate.missing.title")}
				</h2>
				<p className="text-xs leading-relaxed text-muted-foreground">
					{unsupported
						? t("gate.unsupported.body")
						: outdated
							? t("gate.outdated.body", {
									found: state.version ?? "?",
									required: MINIMUM_BAGUETTE_VERSION,
								})
							: t("gate.missing.body")}
				</p>
				{unsupported ? null : (
					<>
						<code className="ios-sim-code">{INSTALL_COMMAND}</code>
						<div className="flex flex-wrap items-center justify-center gap-2 pt-1">
							<button type="button" className="ios-sim-button" onClick={copy}>
								{copied ? t("gate.copied") : t("gate.copy")}
							</button>
							<button type="button" className="ios-sim-button-ghost" onClick={onRecheck}>
								{t("gate.recheck")}
							</button>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
