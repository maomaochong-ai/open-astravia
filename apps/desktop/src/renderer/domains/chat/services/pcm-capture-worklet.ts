declare const registerProcessor: (name: string, processorCtor: typeof AudioWorkletProcessor) => void;
declare class AudioWorkletProcessor {
	readonly port: MessagePort;
	process(inputs: Float32Array[][]): boolean;
}

const CHUNK_SAMPLES = 1_600;

class PcmCaptureProcessor extends AudioWorkletProcessor {
	private chunk = new Float32Array(CHUNK_SAMPLES);
	private offset = 0;

	process(inputs: Float32Array[][]): boolean {
		const input = inputs[0]?.[0];
		if (!input) return true;
		let sourceOffset = 0;
		while (sourceOffset < input.length) {
			const count = Math.min(input.length - sourceOffset, CHUNK_SAMPLES - this.offset);
			this.chunk.set(input.subarray(sourceOffset, sourceOffset + count), this.offset);
			this.offset += count;
			sourceOffset += count;
			if (this.offset === CHUNK_SAMPLES) {
				const samples = this.chunk;
				this.port.postMessage(samples, [samples.buffer]);
				this.chunk = new Float32Array(CHUNK_SAMPLES);
				this.offset = 0;
			}
		}
		return true;
	}
}

registerProcessor("vetta-pcm-capture", PcmCaptureProcessor);
