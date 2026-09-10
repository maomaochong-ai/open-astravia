import { useAtom } from "jotai";
import { useCallback } from "react";
import { newSessionTextureAtom } from "../store/atoms";
import { type NewSessionTextureId, setStoredNewSessionTextureId } from "../theme/new-session-texture";

/** 新会话页底纹的选择；与装饰件/指针一致：写 localStorage + 同步 atom。 */
export function useNewSessionTexture() {
	const [textureId, setTextureAtom] = useAtom(newSessionTextureAtom);

	const setTexture = useCallback(
		(value: NewSessionTextureId) => {
			setStoredNewSessionTextureId(value);
			setTextureAtom(value);
		},
		[setTextureAtom],
	);

	return { textureId, setTexture };
}
