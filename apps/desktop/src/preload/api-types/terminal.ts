import type {
	OpenTerminalRequest,
	OpenTerminalResult,
	TerminalCapabilities,
	TerminalEventEnvelope,
} from "../../shared/terminal-ipc.js";

export interface DesktopTerminalApi {
	/** 本机 PTY 是否可用；为否时底部面板不提供终端入口。 */
	capabilities(): Promise<TerminalCapabilities>;
	open(request: OpenTerminalRequest): Promise<OpenTerminalResult>;
	write(terminalId: string, data: string): Promise<void>;
	resize(terminalId: string, cols: number, rows: number): Promise<void>;
	/** 前台进程名；null 表示没有或问不出来。关闭确认用。 */
	foregroundProcess(terminalId: string): Promise<string | null>;
	close(terminalId: string): Promise<void>;
	/** 按 tab 保存/读取回滚缓冲快照；tabId 跨会话稳定。 */
	saveSnapshot(tabId: string, text: string): Promise<void>;
	loadSnapshot(tabId: string): Promise<string | null>;
	/** 所有终端的增量共用一个频道，回调里按 terminalId 分发。 */
	onEvent(listener: (envelope: TerminalEventEnvelope) => void): () => void;
}
