/**
 * Audio Processor Service
 *
 * This service handles audio capture from the microphone and audio playback.
 * It's optimized for low-latency processing with Web Audio API.
 */

export class AudioProcessor {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private audioWorkletNode: AudioWorkletNode | null = null;
  private audioQueue: Float32Array[] = [];
  private isProcessing: boolean = false;

  constructor() {
    // Initialize audio context with 16kHz sample rate for AssemblyAI
    try {
      this.audioContext = new AudioContext({
        sampleRate: 16000,
        latencyHint: 'interactive'
      });
    } catch (error) {
      console.error('Failed to create AudioContext:', error);
    }
  }

  /**
   * Start capturing audio from the microphone
   *
   * @param onAudioData - Callback for processed audio data
   */
  async startMicrophoneCapture(onAudioData: (data: ArrayBuffer) => void): Promise<void> {
    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate: 16000 });
    }

    try {
      // Request microphone access with optimal settings for STT
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      // Create audio source from microphone
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);

      // Load audio worklet for PCM conversion
      await this.audioContext.audioWorklet.addModule('/audio-processor.js');

      // Create audio worklet node
      this.audioWorkletNode = new AudioWorkletNode(this.audioContext, 'audio-processor');

      // Handle audio data from worklet
      this.audioWorkletNode.port.onmessage = (event) => {
        if (event.data.audioData) {
          onAudioData(event.data.audioData);
        }
      };

      // Connect audio processing pipeline
      source.connect(this.audioWorkletNode);

      // Connect to destination for monitoring (optional)
      // this.audioWorkletNode.connect(this.audioContext.destination);

      console.log('Microphone capture started');
    } catch (error) {
      console.error('Error starting microphone capture:', error);
      throw error;
    }
  }

  /**
   * Play audio buffer through speakers
   *
   * @param audioData - Raw audio data as ArrayBuffer
   */
  async playAudioBuffer(audioData: ArrayBuffer): Promise<void> {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }

    try {
      // Resume audio context if suspended (browser policy)
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // Decode audio data
      const audioBuffer = await this.audioContext.decodeAudioData(audioData);

      // Create audio source
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;

      // Connect to destination (speakers)
      source.connect(this.audioContext.destination);

      // Start playback
      source.start();

      // Return a promise that resolves when playback is complete
      return new Promise((resolve) => {
        source.onended = () => resolve();
      });
    } catch (error) {
      console.error('Error playing audio buffer:', error);
    }
  }

  /**
   * Queue audio for sequential playback
   *
   * @param audioData - Audio data as Float32Array
   */
  queueAudio(audioData: Float32Array): void {
    this.audioQueue.push(audioData);

    // Start processing queue if not already processing
    if (!this.isProcessing) {
      this.processAudioQueue();
    }
  }

  /**
   * Process audio queue sequentially
   */
  private async processAudioQueue(): Promise<void> {
    if (this.audioQueue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;

    try {
      if (!this.audioContext) {
        this.audioContext = new AudioContext();
      }

      // Get next audio chunk
      const audioData = this.audioQueue.shift();

      if (audioData) {
        // Create audio buffer
        const audioBuffer = this.audioContext.createBuffer(
          1, // mono
          audioData.length,
          this.audioContext.sampleRate
        );

        // Fill buffer with data
        audioBuffer.getChannelData(0).set(audioData);

        // Create source
        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;

        // Connect to destination
        source.connect(this.audioContext.destination);

        // Play and wait for completion
        source.start();
        await new Promise<void>((resolve) => {
          source.onended = () => resolve();
        });
      }

      // Process next item in queue
      this.processAudioQueue();
    } catch (error) {
      console.error('Error processing audio queue:', error);
      this.isProcessing = false;
    }
  }

  /**
   * Stop audio capture and processing
   */
  stop(): void {
    // Stop all audio tracks
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    // Disconnect audio worklet
    if (this.audioWorkletNode) {
      this.audioWorkletNode.disconnect();
      this.audioWorkletNode = null;
    }

    // Clear audio queue
    this.audioQueue = [];
    this.isProcessing = false;

    console.log('Audio processing stopped');
  }
}