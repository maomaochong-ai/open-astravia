import { useSshHosts } from "@shared/hooks/useSshHost";
import type { SshHost } from "@vetta/ssh-transport";
import { parseProjectLocation } from "@vetta/ssh-transport/project-uri";
import { useCallback, useMemo, useState } from "react";

export type OrphanRebindError =
	| { kind: "host-in-use"; projectCount: number }
	| { kind: "not-orphaned" }
	| { kind: "failed"; message: string };

export interface OrphanRemoteProject {
	/** 项目路径里写着、却已不在主机列表里的 hostId。 */
	orphanId: string;
	remotePath: string;
	hosts: readonly SshHost[];
	selectedHostId: string | null;
	select: (hostId: string) => void;
	rebind: () => Promise<void>;
	rebinding: boolean;
	error: OrphanRebindError | null;
}

function safeParse(cwd: string): ReturnType<typeof parseProjectLocation> | null {
	try {
		return parseProjectLocation(cwd);
	} catch {
		return null;
	}
}

/**
 * 这个 cwd 是不是一个「主机已不在列表里」的远程项目；是的话给出把它接回某台主机的操作。
 *
 * 本地项目、主机列表尚未读到、主机仍在，都返回 null——调用方照常渲染页面。
 */
export function useOrphanRemoteProject(cwd: string | null | undefined): OrphanRemoteProject | null {
	const location = useMemo(() => (cwd ? safeParse(cwd) : null), [cwd]);
	const remote = location?.kind === "ssh" ? location : null;
	const { hosts, loaded } = useSshHosts(remote !== null);
	const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
	const [rebinding, setRebinding] = useState(false);
	const [error, setError] = useState<OrphanRebindError | null>(null);

	const orphaned = remote !== null && loaded && !hosts.some((host) => host.id === remote.hostId);
	// 只剩一台可选时替用户选好；用户选过就以用户的为准。
	const effectiveSelection = selectedHostId ?? (hosts.length === 1 ? (hosts[0]?.id ?? null) : null);

	const select = useCallback((hostId: string) => {
		setSelectedHostId(hostId);
		setError(null);
	}, []);

	const rebind = useCallback(async () => {
		if (!remote || !effectiveSelection) return;
		setRebinding(true);
		setError(null);
		try {
			const result = await window.vetta.ssh.rebindHost({ hostId: effectiveSelection, orphanId: remote.hostId });
			if (!result.ok) {
				setError(
					result.reason === "host-in-use"
						? { kind: "host-in-use", projectCount: result.projectCount }
						: { kind: "not-orphaned" },
				);
			}
			// 成功后主进程广播主机变更，useSshHosts 重读列表，orphaned 自然转为 false。
		} catch (cause) {
			setError({ kind: "failed", message: cause instanceof Error ? cause.message : String(cause) });
		} finally {
			setRebinding(false);
		}
	}, [effectiveSelection, remote]);

	if (!orphaned || !remote) return null;
	return {
		orphanId: remote.hostId,
		remotePath: remote.remotePath,
		hosts,
		selectedHostId: effectiveSelection,
		select,
		rebind,
		rebinding,
		error,
	};
}
