import { useCallback, useEffect, useState } from "react";

/**
 * 收藏只存本机：它是「我这台机器常用的那几个条目」，跨设备同步反而会让别人的目录
 * 影响自己的面板。存储不可用时退化为会话内有效（与模型选择器的收藏同一口径）。
 */
export const ADD_PANEL_FAVORITES_STORAGE_KEY = "astravia-add-panel-favorites";

function parseFavorites(raw: string | null): string[] {
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((value): value is string => typeof value === "string" && value.length > 0);
	} catch {
		return [];
	}
}

function serializeFavorites(favorites: readonly string[]): string {
	return JSON.stringify(favorites);
}

export interface AddPanelFavoritesModel {
	/** 已收藏的全局键（`${category}:${id}`）。 */
	readonly favorites: readonly string[];
	readonly isFavorite: (key: string) => boolean;
	readonly toggle: (key: string) => void;
}

export function useAddPanelFavorites(): AddPanelFavoritesModel {
	const [favorites, setFavorites] = useState<string[]>(() => {
		if (typeof localStorage === "undefined") return [];
		try {
			return parseFavorites(localStorage.getItem(ADD_PANEL_FAVORITES_STORAGE_KEY));
		} catch {
			return [];
		}
	});

	// 同期其它窗口改了收藏：跟着刷新，避免两条面板显示不同的星标。
	useEffect(() => {
		const onStorage = (event: StorageEvent): void => {
			if (event.key !== ADD_PANEL_FAVORITES_STORAGE_KEY) return;
			setFavorites(parseFavorites(event.newValue));
		};
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, []);

	const toggle = useCallback((key: string) => {
		setFavorites((previous) => {
			const next = previous.includes(key) ? previous.filter((item) => item !== key) : [...previous, key];
			try {
				localStorage.setItem(ADD_PANEL_FAVORITES_STORAGE_KEY, serializeFavorites(next));
			} catch {
				// 存储不可用（隐私模式、配额满）：本次会话内仍然生效。
			}
			return next;
		});
	}, []);

	const isFavorite = useCallback((key: string) => favorites.includes(key), [favorites]);

	return { favorites, isFavorite, toggle };
}
