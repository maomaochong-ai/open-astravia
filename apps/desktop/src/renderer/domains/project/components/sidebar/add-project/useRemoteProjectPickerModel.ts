import type { SshHostSummary } from "@preload/api-types/ssh";
import type { RemoteDirectoryEntry } from "@vetta/ssh-transport";
import { useCallback, useEffect, useState } from "react";

export interface RemoteProjectPickerModel {
	/** 已登记的主机。为空时不弹一个空对话框，而是给出去设置页登记的出口。 */
	hosts: readonly SshHostSummary[];
	hostsLoading: boolean;
	selectedHostId: string | null;
	/** 当前浏览的远端绝对路径（`~` 已由主进程展开）。 */
	remotePath: string;
	entries: readonly RemoteDirectoryEntry[];
	browsing: boolean;
	/** 列目录失败的原因。连不上主机时这里是唯一能解释「为什么是空的」的地方。 */
	error: string | null;
	canSubmit: boolean;
	selectHost: (hostId: string) => void;
	enterDirectory: (name: string) => void;
	goToParent: () => void;
	back: () => void;
}

export function useRemoteProjectPickerModel(): RemoteProjectPickerModel {
	const [hosts, setHosts] = useState<readonly SshHostSummary[]>([]);
	const [hostsLoading, setHostsLoading] = useState(true);
	const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
	const [remotePath, setRemotePath] = useState("");
	const [entries, setEntries] = useState<readonly RemoteDirectoryEntry[]>([]);
	const [browsing, setBrowsing] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		void window.vetta.ssh
			.listHosts()
			.then(setHosts)
			.finally(() => setHostsLoading(false));
	}, []);

	const browse = useCallback(async (hostId: string, path: string | undefined) => {
		setBrowsing(true);
		setError(null);
		try {
			const listing = await window.vetta.ssh.listRemoteDirectory({ hostId, remotePath: path });
			setRemotePath(listing.remotePath);
			// 只留目录：这里在选项目根，文件不是可选项，列出来只会让用户误点。
			setEntries(listing.entries.filter((entry) => entry.kind === "directory"));
		} catch (caught) {
			// 保留当前路径不变，让用户能原地退回上一级重试，而不是被踢回起点。
			setEntries([]);
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBrowsing(false);
		}
	}, []);

	const selectHost = useCallback(
		(hostId: string) => {
			setSelectedHostId(hostId);
			// 从远端家目录起步而不是 `/`：项目几乎总在家目录下。
			void browse(hostId, undefined);
		},
		[browse],
	);

	const enterDirectory = useCallback(
		(name: string) => {
			if (selectedHostId === null) return;
			void browse(selectedHostId, `${remotePath.replace(/\/+$/, "")}/${name}`);
		},
		[browse, remotePath, selectedHostId],
	);

	const goToParent = useCallback(() => {
		if (selectedHostId === null || remotePath === "/") return;
		const parent = remotePath.replace(/\/+$/, "").replace(/\/[^/]*$/, "");
		void browse(selectedHostId, parent.length === 0 ? "/" : parent);
	}, [browse, remotePath, selectedHostId]);

	const back = useCallback(() => {
		setSelectedHostId(null);
		setEntries([]);
		setRemotePath("");
		setError(null);
	}, []);

	return {
		hosts,
		hostsLoading,
		selectedHostId,
		remotePath,
		entries,
		browsing,
		error,
		// 路径没拿到之前不能提交：那会登记一个空路径的项目。
		canSubmit: selectedHostId !== null && remotePath.length > 0 && !browsing,
		selectHost,
		enterDirectory,
		goToParent,
		back,
	};
}
