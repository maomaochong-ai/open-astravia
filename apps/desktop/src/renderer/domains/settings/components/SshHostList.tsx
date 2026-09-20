import { Button } from "@shared/components/ui/button";
import type { SshConnectionStatus } from "@vetta/ssh-transport";
import { SshHostForm } from "./SshHostForm";
import type { SshHostRowMessage, SshHostsSettingsModel } from "./useSshHostsSettingsModel";

export function SshHostList({ model }: { model: SshHostsSettingsModel }): JSX.Element {
	const { labels, actions } = model;
	return (
		<ul className="flex flex-col">
			{model.hosts.map((host) => {
				const editing = model.editingId === host.id;
				const testing = model.testingId === host.id;
				const message = model.rowMessage[host.id];
				return (
					<li key={host.id} className="border-b border-border last:border-b-0">
						<div className="flex items-center justify-between gap-6 px-5 py-4">
							<div className="min-w-0">
								<div className="flex items-center gap-2">
									<span className="truncate text-[13px] font-medium text-foreground">{host.label}</span>
									<StatusBadge status={host.status} labels={labels} />
								</div>
								<p className="truncate text-[12px] text-muted-foreground">
									{host.target}
									{host.port === undefined ? "" : `:${host.port}`}
								</p>
								{message !== undefined && <RowMessage message={message} detailsLabel={labels.testDetails} />}
							</div>
							<div className="flex shrink-0 items-center gap-1">
								<Button
									variant="ghost"
									size="sm"
									onClick={() => void actions.test(host)}
									disabled={testing}
									aria-label={labels.test}
								>
									<span
										className={`icon-[solar--refresh-linear] h-3.5 w-3.5 ${testing ? "animate-spin" : ""}`}
									/>
									{testing ? labels.testing : labels.test}
								</Button>
								<Button
									variant="ghost"
									size="icon-sm"
									onClick={() => actions.startEdit(host)}
									aria-label={labels.edit}
								>
									<span className="icon-[solar--pen-2-linear] h-3.5 w-3.5" />
								</Button>
								<Button
									variant="ghost"
									size="icon-sm"
									onClick={() => actions.remove(host)}
									aria-label={labels.remove}
								>
									<span className="icon-[solar--trash-bin-trash-linear] h-3.5 w-3.5" />
								</Button>
							</div>
						</div>
						{editing && <SshHostForm model={model} heading={labels.editTitle} />}
					</li>
				);
			})}
		</ul>
	);
}

/**
 * 连接状态。
 *
 * `unverifiable` 单独成一档，不并进「未连接」：它的含义是「刚才问不到」，可能只是
 * 网络抖了一下，而不是主机不可用（ADR-0124）。把它显示成失败会让用户白跑一趟去查
 * 一台其实好好的机器。
 */
function StatusBadge({
	status,
	labels,
}: {
	status: SshConnectionStatus;
	labels: SshHostsSettingsModel["labels"];
}): JSX.Element | null {
	if (status === "connected") {
		return <Badge className="bg-emerald-500/15 text-emerald-400">{labels.statusConnected}</Badge>;
	}
	if (status === "unverifiable") {
		return <Badge className="bg-amber-500/15 text-amber-400">{labels.statusUnverifiable}</Badge>;
	}
	if (status === "connecting") {
		return <Badge className="bg-accent/60 text-muted-foreground">{labels.testing}</Badge>;
	}
	// 从未连接过不需要一枚徽标：列表默认就是这个状态，标上去只是噪音。
	return null;
}

function Badge({ className, children }: { className: string; children: React.ReactNode }): JSX.Element {
	return <span className={`rounded-full px-2 py-0.5 text-[10px] ${className}`}>{children}</span>;
}

function RowMessage({ message, detailsLabel }: { message: SshHostRowMessage; detailsLabel: string }): JSX.Element {
	return (
		<div className="mt-1.5">
			<p className={`text-[12px] ${message.tone === "success" ? "text-emerald-400" : "text-destructive"}`}>
				{message.text}
			</p>
			{/* 原始 stderr 折叠起来：定位问题时有用，但不该当作首行文案。 */}
			{message.details !== undefined && message.details.length > 0 && (
				<details className="mt-1">
					<summary className="cursor-pointer text-[11px] text-muted-foreground">{detailsLabel}</summary>
					<pre className="mt-1 max-h-32 overflow-auto rounded-lg bg-muted px-2 py-1.5 text-[11px] whitespace-pre-wrap text-muted-foreground">
						{message.details}
					</pre>
				</details>
			)}
		</div>
	);
}
