/**
 * 预览一个文件所需的全部 I/O。
 *
 * 「这份内容该怎么呈现」（按扩展名走 base64、探测是不是文本、嗅探 MIME、大小上限）与
 * 「字节从哪台机器来」是两件事。把后者收成这个小接口，本地与远程项目共用同一套呈现
 * 判断——否则远程项目要么整套预览不可用，要么得把这些判断再抄一遍然后慢慢走样。
 */
export interface PreviewFileSource {
	/** 用来取扩展名的路径；远程项目给远端路径，不带 URI 前缀。 */
	readonly path: string;
	/** 文件不存在时返回 null。 */
	stat(): Promise<{ readonly size: number; readonly isFile: boolean } | null>;
	read(): Promise<Buffer>;
	readHead(byteCount: number): Promise<Buffer>;
}
