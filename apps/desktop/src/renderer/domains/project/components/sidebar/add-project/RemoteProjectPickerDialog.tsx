import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@vetta-org/ui";
import { useTranslation } from "react-i18next";
import { useRemoteProjectPickerModel } from "./useRemoteProjectPickerModel";

/**
 * 从远程主机选一个目录登记成项目。
 *
 * 两步：先选主机，再浏览目录。主机列表为空时不弹一个空壳，而是解释为什么空并指路
 * 去设置页登记——否则用户只会看到一个没有任何可点内容的对话框。
 */
export function RemoteProjectPickerDialog({
	onConfirm,
	onCancel,
}: {
	onConfirm: (hostId: string, remotePath: string) => void;
	onCancel: () => void;
}): JSX.Element {
	const { t } = useTranslation("project");
	const model = useRemoteProjectPickerModel();

	return (
		<Dialog open onOpenChange={(open) => !open && onCancel()}>
			<DialogContent className="max-w-[520px]">
				<DialogHeader>
					<DialogTitle>{t("remotePicker.title")}</DialogTitle>
					<DialogDescription>
						{model.selectedHostId === null ? t("remotePicker.pickHost") : model.remotePath}
					</DialogDescription>
				</DialogHeader>

				{model.selectedHostId === null ? (
					<HostStep model={model} t={t} />
				) : (
					<DirectoryStep model={model} t={t} />
				)}

				<DialogFooter>
					{model.selectedHostId !== null && (
						<Button variant="ghost" onClick={model.back}>
							{t("remotePicker.backToHosts")}
						</Button>
					)}
					<Button variant="outline" onClick={onCancel}>
						{t("remotePicker.cancel")}
					</Button>
					<Button
						variant="primary"
						disabled={!model.canSubmit}
						onClick={() => {
							if (model.selectedHostId !== null) onConfirm(model.selectedHostId, model.remotePath);
						}}
					>
						{t("remotePicker.confirm")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

type Model = ReturnType<typeof useRemoteProjectPickerModel>;
type Translate = ReturnType<typeof useTranslation<"project">>["t"];

function HostStep({ model, t }: { model: Model; t: Translate }): JSX.Element {
	if (model.hostsLoading) {
		return <p className="px-1 py-6 text-center text-[13px] text-muted-foreground">{t("remotePicker.loading")}</p>;
	}
	if (model.hosts.length === 0) {
		return (
			<div className="flex flex-col items-center gap-2 px-1 py-6 text-center">
				<span className="icon-[solar--server-linear] h-8 w-8 text-muted-foreground" />
				<p className="text-[13px] text-foreground">{t("remotePicker.noHosts")}</p>
				<p className="max-w-[360px] text-[12px] text-muted-foreground">{t("remotePicker.noHostsHint")}</p>
			</div>
		);
	}
	return (
		<ul className="flex max-h-[320px] flex-col gap-1 overflow-auto">
			{model.hosts.map((host) => (
				<li key={host.id}>
					<button
						type="button"
						onClick={() => model.selectHost(host.id)}
						className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent/50"
					>
						<span className="icon-[solar--server-linear] h-4 w-4 shrink-0 text-muted-foreground" />
						<span className="min-w-0 flex-1">
							<span className="block truncate text-[13px] text-foreground">{host.label}</span>
							<span className="block truncate text-[12px] text-muted-foreground">{host.target}</span>
						</span>
					</button>
				</li>
			))}
		</ul>
	);
}

function DirectoryStep({ model, t }: { model: Model; t: Translate }): JSX.Element {
	return (
		<div className="flex flex-col gap-2">
			<Button
				variant="ghost"
				size="sm"
				className="self-start"
				onClick={model.goToParent}
				disabled={model.remotePath === "/" || model.browsing}
			>
				<span className="icon-[solar--alt-arrow-up-linear] h-3.5 w-3.5" />
				{t("remotePicker.parent")}
			</Button>

			{model.error !== null ? (
				<div className="px-1 py-6 text-center">
					<p className="text-[13px] text-destructive">{t("remotePicker.browseFailed")}</p>
					{/* 原始 SSH 报错收进二级披露：它能定位问题，但不该当作首行文案。 */}
					<details className="mt-2 text-left">
						<summary className="cursor-pointer text-[11px] text-muted-foreground">
							{t("remotePicker.details")}
						</summary>
						<pre className="mt-1 max-h-32 overflow-auto rounded-lg bg-muted px-2 py-1.5 text-[11px] whitespace-pre-wrap text-muted-foreground">
							{model.error}
						</pre>
					</details>
				</div>
			) : (
				<ul className="flex max-h-[280px] flex-col gap-1 overflow-auto">
					{model.browsing && (
						<li className="px-3 py-2.5 text-[13px] text-muted-foreground">{t("remotePicker.loading")}</li>
					)}
					{!model.browsing && model.entries.length === 0 && (
						<li className="px-3 py-2.5 text-[13px] text-muted-foreground">{t("remotePicker.emptyDir")}</li>
					)}
					{!model.browsing &&
						model.entries.map((entry) => (
							<li key={entry.name}>
								<button
									type="button"
									onClick={() => model.enterDirectory(entry.name)}
									className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent/50"
								>
									<span className="icon-[solar--folder-linear] h-4 w-4 shrink-0 text-muted-foreground" />
									<span className="truncate text-[13px] text-foreground">{entry.name}</span>
								</button>
							</li>
						))}
				</ul>
			)}
		</div>
	);
}
