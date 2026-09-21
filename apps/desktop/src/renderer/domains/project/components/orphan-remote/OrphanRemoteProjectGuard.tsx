import { useNavigate } from "@tanstack/react-router";
import { Button } from "@vetta-org/ui";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { type OrphanRemoteProject, useOrphanRemoteProject } from "./useOrphanRemoteProject";

/**
 * 远程项目的主机已不在列表里时，用「重新绑定」卡片替换整个页面。
 *
 * 整页替换而不是在页内插一条提示：这种项目上一切都会失败（读文件、建会话、扫技能），
 * 页面照常挂载只会接连打出一串 `Unknown SSH host`，会话还会被退回欢迎页，而用户始终
 * 看不到该怎么办。children 在判定出孤儿后不再挂载，那些注定失败的调用也就不会发出去。
 */
export function OrphanRemoteProjectGuard({ cwd, children }: { cwd: string | null | undefined; children: ReactNode }) {
	const orphan = useOrphanRemoteProject(cwd);
	if (!orphan) return <>{children}</>;
	return <OrphanRemoteProjectCard orphan={orphan} />;
}

export function OrphanRemoteProjectCard({ orphan }: { orphan: OrphanRemoteProject }): JSX.Element {
	const { t } = useTranslation("project");
	const navigate = useNavigate();
	const openSettings = (): void => {
		void navigate({ to: "/settings/$tab", params: { tab: "sshHosts" }, search: {} });
	};

	return (
		<div className="flex h-full w-full items-center justify-center p-6">
			<div className="flex w-full max-w-[460px] flex-col gap-4 rounded-2xl border border-border bg-card p-6">
				<div className="flex flex-col gap-1.5">
					<span className="icon-[solar--server-minimalistic-linear] h-7 w-7 text-muted-foreground" />
					<h2 className="text-[15px] font-medium text-foreground">{t("orphanRemote.title")}</h2>
					<p className="text-[12px] leading-relaxed text-muted-foreground">{t("orphanRemote.description")}</p>
					<p className="truncate font-mono text-[11px] text-muted-foreground" title={orphan.remotePath}>
						{orphan.remotePath}
					</p>
				</div>

				{orphan.hosts.length === 0 ? (
					<p className="text-[12px] text-muted-foreground">{t("orphanRemote.noHosts")}</p>
				) : (
					<fieldset className="flex flex-col gap-1">
						<legend className="mb-1 text-[12px] text-foreground">{t("orphanRemote.pickHost")}</legend>
						{orphan.hosts.map((host) => {
							const selected = orphan.selectedHostId === host.id;
							return (
								<label
									key={host.id}
									className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 transition-colors ${
										selected ? "bg-accent" : "hover:bg-accent/50"
									}`}
								>
									<input
										type="radio"
										name="orphan-remote-host"
										className="sr-only"
										checked={selected}
										onChange={() => orphan.select(host.id)}
									/>
									<span
										className={`h-3.5 w-3.5 shrink-0 ${
											selected
												? "icon-[solar--check-circle-bold] text-primary"
												: "icon-[solar--server-linear] text-muted-foreground"
										}`}
									/>
									<span className="min-w-0 flex-1">
										<span className="block truncate text-[13px] text-foreground">{host.label}</span>
										<span className="block truncate text-[12px] text-muted-foreground">{host.target}</span>
									</span>
								</label>
							);
						})}
					</fieldset>
				)}

				{orphan.error && (
					<p role="alert" className="text-[12px] text-destructive">
						{orphan.error.kind === "host-in-use"
							? t("orphanRemote.hostInUse", { count: orphan.error.projectCount })
							: orphan.error.kind === "not-orphaned"
								? t("orphanRemote.notOrphaned")
								: orphan.error.message}
					</p>
				)}

				<div className="flex items-center justify-end gap-2">
					<Button variant="ghost" size="sm" onClick={openSettings}>
						{t("orphanRemote.addHost")}
					</Button>
					<Button
						size="sm"
						onClick={() => void orphan.rebind()}
						disabled={orphan.selectedHostId === null || orphan.rebinding}
					>
						{orphan.rebinding ? t("orphanRemote.rebinding") : t("orphanRemote.rebind")}
					</Button>
				</div>
				<p className="text-[11px] leading-relaxed text-muted-foreground">{t("orphanRemote.footnote")}</p>
			</div>
		</div>
	);
}
