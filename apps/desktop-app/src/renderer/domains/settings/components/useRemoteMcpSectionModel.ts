import { abilityToMarketMcpServer, fetchMarketAbilities, type MarketMcpServer } from "@shared/lib/api";
import { authTokenAtom } from "@shared/store/auth-atoms";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export type RemoteMcpSectionModel = {
	items: MarketMcpServer[] | null;
	loading: boolean;
	error: string | null;
	busy: string | null;
	load: () => void;
	handleAction: (server: MarketMcpServer, action: "add" | "remove") => Promise<void>;
};

export function useRemoteMcpSectionModel({
	onAdd,
	onRemove,
}: {
	onAdd: (server: MarketMcpServer) => Promise<void> | void;
	onRemove: (name: string) => Promise<void> | void;
}): RemoteMcpSectionModel {
	const { t } = useTranslation("settings");
	const token = useAtomValue(authTokenAtom);
	const [items, setItems] = useState<MarketMcpServer[] | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);

	const load = useCallback(() => {
		if (!token) {
			setError(t("loginRequired"));
			setItems([]);
			return;
		}
		setLoading(true);
		setError(null);
		// MCP 已并入统一的能力市场（ADR-0049），这里只取 type=mcp 的行再适配成 mcp.json 条目。
		void fetchMarketAbilities(token)
			.then((list) => {
				setItems(list.filter((entry) => entry.type === "mcp").map(abilityToMarketMcpServer));
				setError(null);
			})
			.catch((err: Error) => {
				setError(err.message || t("loadFailed"));
				setItems([]);
			})
			.finally(() => setLoading(false));
	}, [token, t]);

	useEffect(() => {
		load();
	}, [load]);

	const handleAction = useCallback(
		async (server: MarketMcpServer, action: "add" | "remove") => {
			setBusy(server.name);
			try {
				if (action === "add") {
					await onAdd(server);
				} else {
					await onRemove(server.name);
				}
			} finally {
				setBusy(null);
			}
		},
		[onAdd, onRemove],
	);

	return { items, loading, error, busy, load, handleAction };
}
