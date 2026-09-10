import { useAtom } from "jotai";
import { useCallback } from "react";
import { heroOrnamentAtom } from "../store/atoms";
import { type OrnamentId, setStoredOrnamentId } from "../theme/ornament";

/** 新会话页装饰件位的选择；与 cursor/sidebar 一致：写 localStorage + 同步 atom。 */
export function useHeroOrnament() {
	const [ornamentId, setOrnamentAtom] = useAtom(heroOrnamentAtom);

	const setOrnament = useCallback(
		(value: OrnamentId) => {
			setStoredOrnamentId(value);
			setOrnamentAtom(value);
		},
		[setOrnamentAtom],
	);

	return { ornamentId, setOrnament };
}
