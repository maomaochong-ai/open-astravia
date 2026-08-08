import { useActivityTab, useTranslation } from "@vetta-org/plugin-sdk";
import { Button, Spin } from "@vetta/ui";
import { useCallback, useEffect, useState, type JSX } from "react";
import { getPluginContext } from "../runtime";
import "./style.css";
import {
	restartRemotionStudio,
	RemotionStudioProjectError,
	startRemotionStudio,
} from "./studio-manager";

type PanelState =
	| { kind: "no-cwd" }
	| { kind: "starting" }
	| { kind: "not-project" }
	| { kind: "dependencies-missing" }
	| { kind: "ready"; url: string }
	| { kind: "error"; message: string };

function projectErrorState(error: RemotionStudioProjectError): PanelState {
	if (error.inspection.reason === "package-json-missing" || error.inspection.reason === "entry-point-missing") {
		return { kind: "not-project" };
	}
	return { kind: "dependencies-missing" };
}

export function RemotionStudioPanel(): JSX.Element {
	const { cwd } = useActivityTab();
	const { t } = useTranslation();
	const [state, setState] = useState<PanelState>(cwd ? { kind: "starting" } : { kind: "no-cwd" });
	const [reloadToken, setReloadToken] = useState(0);

	useEffect(() => {
		let cancelled = false;
		if (!cwd) {
			setState({ kind: "no-cwd" });
			return () => {
				cancelled = true;
			};
		}
		setState({ kind: "starting" });
		void startRemotionStudio(getPluginContext(), cwd)
			.then((server) => {
				if (!cancelled) setState({ kind: "ready", url: `http://127.0.0.1:${server.port}/` });
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				if (error instanceof RemotionStudioProjectError) {
					setState(projectErrorState(error));
					return;
				}
				const message = error instanceof Error ? error.message : String(error);
				setState({ kind: "error", message });
				getPluginContext().ui.notify({ message: t("studio.state.errorTitle"), error });
			});
		return () => {
			cancelled = true;
		};
	}, [cwd, reloadToken, t]);

	const restart = useCallback(async (): Promise<void> => {
		if (!cwd) return;
		setState({ kind: "starting" });
		try {
			const server = await restartRemotionStudio(getPluginContext(), cwd);
			setState({ kind: "ready", url: `http://127.0.0.1:${server.port}/` });
		} catch (error) {
			if (error instanceof RemotionStudioProjectError) setState(projectErrorState(error));
			else {
				const message = error instanceof Error ? error.message : String(error);
				setState({ kind: "error", message });
				getPluginContext().ui.notify({ message: t("studio.state.errorTitle"), error });
			}
		}
	}, [cwd, t]);

	const retry = useCallback(() => setReloadToken((current) => current + 1), []);
	const isStarting = state.kind === "starting";

	return (
		<div className="remotion-studio-panel">
			<div className="remotion-studio-toolbar">
				<span className="remotion-studio-title">{t("studio.title")}</span>
				<Button
					type="button"
					variant="ghost"
					size="xs"
					disabled={!cwd || isStarting}
					onClick={() => void (state.kind === "ready" ? restart() : retry())}
				>
					{t("studio.action.restart")}
				</Button>
			</div>
			{state.kind === "ready" ? (
				<iframe className="remotion-studio-frame" src={state.url} title={t("studio.iframeTitle")} />
			) : (
				<div className="remotion-studio-state">
					{state.kind === "starting" && (
						<>
							<Spin size="md" />
							<p>{t("studio.state.starting")}</p>
						</>
					)}
					{state.kind === "no-cwd" && (
						<>
							<h2>{t("studio.state.noCwdTitle")}</h2>
							<p>{t("studio.state.noCwdBody")}</p>
						</>
					)}
					{state.kind === "not-project" && (
						<>
							<h2>{t("studio.state.notProjectTitle")}</h2>
							<p>{t("studio.state.notProjectBody")}</p>
						</>
					)}
					{state.kind === "dependencies-missing" && (
						<>
							<h2>{t("studio.state.dependenciesTitle")}</h2>
							<p>{t("studio.state.dependenciesBody")}</p>
						</>
					)}
					{state.kind === "error" && (
						<>
							<h2>{t("studio.state.errorTitle")}</h2>
							<p>{t("studio.state.errorBody")}</p>
							<pre>{state.message}</pre>
						</>
					)}
				</div>
			)}
		</div>
	);
}
