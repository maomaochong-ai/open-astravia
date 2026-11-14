import { Button } from "@astravia-org/ui/button";
import { SplashFooter, SplashTitleHeader } from "@astravia-org/theme-ui/overlays";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { type RemoteProjectPickerModel, useRemoteProjectPickerModel } from "./useRemoteProjectPickerModel";
import { useEscapeKey } from "./useEscapeKey";

interface AddProjectRemoteStepProps {
	onConfirm: (hostId: string, remotePath: string) => void;
	onBack: () => void;
}

type Translate = ReturnType<typeof useTranslation<"project">>["t"];

const ROW_CLASS =
	"flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors hover:bg-primary/10 focus-visible:bg-primary/10";

/**
 * 从远程主机添加：先选主机，再浏览目录，两步都在 Splash 里完成。
 * 主机列表为空时不留一个空面板，而是解释为什么空并指路去设置页登记。
 */
export function AddProjectRemoteStep({ onConfirm, onBack }: AddProjectRemoteStepProps): JSX.Element {
	const { t } = useTranslation("project");
	const model = useRemoteProjectPickerModel();
	const navigate = useNavigate();
	const inDirectory = model.selectedHostId !== null;
	// 目录浏览里 Esc / 返回键先退回选主机，再退回入口列表。
	const back = inDirectory ? model.back : onBack;
	useEscapeKey(back);

	const openSettings = (): void => {
		void navigate({ to: "/settings/$tab", params: { tab: "sshHosts" }, search: {} });
	};

	return (
		<>
			<SplashTitleHeader
				title={inDirectory ? model.remotePath || t("remotePicker.loading") : t("remotePicker.title")}
				// 目录浏览时标题位是当前路径，不是面板标题，保持常规字重。
				variant={inDirectory ? "plain" : "title"}
				backLabel={t("addProjectSplash.back")}
				onBack={back}
			/>
			<div className="max-h-[min(320px,50vh)] overflow-y-auto overscroll-contain px-1.5 py-1.5">
				{inDirectory ? (
					<DirectoryList model={model} t={t} />
				) : (
					<HostList model={model} t={t} onOpenSettings={openSettings} />
				)}
			</div>
			<SplashFooter>
				{inDirectory ? (
					<>
						<span>{t("addProjectSplash.hintBack")}</span>
						<Button
							variant="primary"
							size="sm"
							className="ml-auto"
							disabled={!model.canSubmit}
							onClick={() => {
								if (model.selectedHostId !== null) onConfirm(model.selectedHostId, model.remotePath);
							}}
						>
							{t("remotePicker.confirm")}
						</Button>
					</>
				) : (
					<>
						<span>{t("remotePicker.pickHost")}</span>
						<span className="ml-auto">{t("addProjectSplash.hintBack")}</span>
					</>
				)}
			</SplashFooter>
		</>
	);
}

function HostList({
	model,
	t,
	onOpenSettings,
}: {
	model: RemoteProjectPickerModel;
	t: Translate;
	onOpenSettings: () => void;
}): JSX.Element {
	if (model.hostsLoading) {
		return <p className="px-2.5 py-6 text-center text-[13px] text-muted-foreground">{t("remotePicker.loading")}</p>;
	}
	if (model.hosts.length === 0) {
		return (
			<div className="flex flex-col items-center gap-2 px-3 py-6 text-center">
				<span className="icon-[solar--server-linear] size-8 text-muted-foreground" />
				<p className="text-[13px] text-foreground">{t("remotePicker.noHosts")}</p>
				<p className="max-w-[360px] text-[12px] text-muted-foreground">{t("remotePicker.noHostsHint")}</p>
				<Button variant="outline" size="sm" onClick={onOpenSettings}>
					{t("remotePicker.openSettings")}
				</Button>
			</div>
		);
	}
	return (
		<ul className="flex flex-col gap-0.5">
			{model.hosts.map((host) => (
				<li key={host.id}>
					<button type="button" onClick={() => model.selectHost(host.id)} className={ROW_CLASS}>
						<span className="icon-[solar--server-linear] size-4 shrink-0 text-muted-foreground" />
						<span className="min-w-0 flex-1">
							<span className="block truncate text-[13px] text-foreground">{host.label}</span>
							<span className="block truncate text-[11px] text-muted-foreground">{host.target}</span>
						</span>
					</button>
				</li>
			))}
		</ul>
	);
}

function DirectoryList({ model, t }: { model: RemoteProjectPickerModel; t: Translate }): JSX.Element {
	if (model.error !== null) {
		return (
			<div className="px-2.5 py-5 text-center">
				<p className="text-[13px] text-destructive">{t("remotePicker.browseFailed")}</p>
				{/* 原始 SSH 报错收进二级披露：它能定位问题，但不该当作首行文案。 */}
				<details className="mt-2 text-left">
					<summary className="cursor-pointer text-[11px] text-muted-foreground">{t("remotePicker.details")}</summary>
					<pre className="mt-1 max-h-32 overflow-auto rounded-lg bg-muted px-2 py-1.5 text-[11px] whitespace-pre-wrap text-muted-foreground">
						{model.error}
					</pre>
				</details>
				<Button variant="ghost" size="sm" className="mt-2" onClick={model.goToParent} disabled={model.remotePath === "/"}>
					{t("remotePicker.parent")}
				</Button>
			</div>
		);
	}
	return (
		<ul className="flex flex-col gap-0.5">
			<li>
				<button
					type="button"
					onClick={model.goToParent}
					disabled={model.remotePath === "/" || model.browsing}
					className={ROW_CLASS}
				>
					<span className="icon-[solar--alt-arrow-up-linear] size-4 shrink-0 text-muted-foreground" />
					<span className="text-[13px] text-muted-foreground">{t("remotePicker.parent")}</span>
				</button>
			</li>
			{model.browsing && (
				<li className="px-2.5 py-2 text-[13px] text-muted-foreground">{t("remotePicker.loading")}</li>
			)}
			{!model.browsing && model.entries.length === 0 && (
				<li className="px-2.5 py-2 text-[13px] text-muted-foreground">{t("remotePicker.emptyDir")}</li>
			)}
			{!model.browsing &&
				model.entries.map((entry) => (
					<li key={entry.name}>
						<button type="button" onClick={() => model.enterDirectory(entry.name)} className={ROW_CLASS}>
							<span className="icon-[solar--folder-linear] size-4 shrink-0 text-muted-foreground" />
							<span className="truncate text-[13px] text-foreground">{entry.name}</span>
						</button>
					</li>
				))}
		</ul>
	);
}
