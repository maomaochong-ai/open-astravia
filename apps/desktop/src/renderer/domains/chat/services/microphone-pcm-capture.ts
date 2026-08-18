import pcmCaptureWorkletUrl from "./pcm-capture-worklet.ts?worker&url";

const SPEECH_SAMPLE_RATE = 16_000;

export class MicrophonePcmCapture {
	private stream: MediaStream | null = null;
	private context: AudioContext | null = null;
	private source: MediaStreamAudioSourceNode | null = null;
	private worklet: AudioWorkletNode | null = null;
	private sink: GainNode | null = null;

	async start(onSamples: (samples: Float32Array) => void): Promise<void> {
		if (this.stream) return;
		try {
			this.stream = await navigator.mediaDevices.getUserMedia({
				audio: {
					channelCount: 1,
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true,
				},
				video: false,
			});
			this.context = new AudioContext({ sampleRate: SPEECH_SAMPLE_RATE });
			if (this.context.sampleRate !== SPEECH_SAMPLE_RATE) {
				throw new Error("AudioContext did not honor the requested speech sample rate");
			}
			await this.context.audioWorklet.addModule(pcmCaptureWorkletUrl);
			this.source = this.context.createMediaStreamSource(this.stream);
			this.worklet = new AudioWorkletNode(this.context, "vetta-pcm-capture", {
				numberOfInputs: 1,
				numberOfOutputs: 1,
				outputChannelCount: [1],
			});
			this.sink = this.context.createGain();
			this.sink.gain.value = 0;
			this.worklet.port.onmessage = (event: MessageEvent<unknown>) => {
				if (event.data instanceof Float32Array) onSamples(event.data);
			};
			this.source.connect(this.worklet).connect(this.sink).connect(this.context.destination);
		} catch (error) {
			await this.stop();
			throw error;
		}
	}

	async stop(): Promise<void> {
		this.worklet?.port.close();
		this.source?.disconnect();
		this.worklet?.disconnect();
		this.sink?.disconnect();
		for (const track of this.stream?.getTracks() ?? []) track.stop();
		if (this.context && this.context.state !== "closed") await this.context.close();
		this.stream = null;
		this.context = null;
		this.source = null;
		this.worklet = null;
		this.sink = null;
	}
}
