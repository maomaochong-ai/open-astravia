import type { PluginAiModelListResult } from "@vetta-org/plugin-sdk";
import { createContext, useContext } from "react";
import type { ChessStore } from "./game/store";

/**
 * 一次 `activate()` 的运行态。视图从 context 里拿它，**不要**回头去读模块级单例：
 * 宿主重载插件时先 activate 新实例、再 dispose 旧实例，模块级变量会被旧实例的
 * `deactivate()` 清成 null，已挂载的视图就会连同棋局一起失效。
 */
export interface ChessRuntime {
	store: ChessStore;
	/** 模型列表；缺权限或没有可用 Provider 时返回 null（选择器随之隐藏）。 */
	listModels(): Promise<PluginAiModelListResult | null>;
}

const ChessRuntimeContext = createContext<ChessRuntime | null>(null);

export const ChessRuntimeProvider = ChessRuntimeContext.Provider;

export function useChessRuntime(): ChessRuntime {
	const runtime = useContext(ChessRuntimeContext);
	if (!runtime) throw new Error("ChessRuntimeProvider is missing above this view");
	return runtime;
}
