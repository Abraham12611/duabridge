/**
 * Audio Processor Service
 *
 * This service handles microphone input and audio playback using the Web Audio API.
 */

export class AudioProcessor {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private audioWorkletNode: AudioWorkletNode | null = null;
  private audioQueue: Float32Array[] = [];
  private isProcessing: boolean = false;

  constructor() {
    // Don't create AudioContext in constructor - it will be created on demand
    // This avoids issues with server-side rendering
  }

  /**
   * Initialize the audio context if not already created
   */
  async initializeAudioContext(): Promise<AudioContext> {
    if (!this.audioContext) {
      // Check if we're in a browser environment
      if (typeof window === 'undefined' || !window.AudioContext) {
        throw new Error('AudioContext not available - are you running in a browser?');
      }

      // Create AudioContext with optimal settings for speech
      this.audioContext = new window.AudioContext({
        sampleRate: 16000,
        latencyHint: 'interactive'
      });

      console.log('AudioContext initialized with sample rate:', this.audioContext.sampleRate);
    }

    return this.audioContext;
  }

  /**
   * Start capturing audio from the microphone
   *
   * @param onAudioData - Callback function for audio data
   */
  async startCapture(onAudioData: (data: ArrayBuffer) => void): Promise<void> {
    try {
      // Initialize audio context on demand
      const audioContext = await this.initializeAudioContext();

      // Request microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      // Create media stream source
      const source = audioContext.createMediaStreamSource(this.mediaStream);

      // Load audio worklet
      await audioContext.audioWorklet.addModule('/audio-processor.js');

      // Create audio worklet node
      this.audioWorkletNode = new AudioWorkletNode(audioContext, 'audio-processor');

      // Set up message handler for audio data
      this.audioWorkletNode.port.onmessage = (event) => {
        if (event.data.audioData) {
          onAudioData(event.data.audioData);
        }
      };

      // Connect source to worklet
      source.connect(this.audioWorkletNode);

      console.log('Microphone capture started');
    } catch (error) {
      console.error('Error starting microphone capture:', error);
      throw error;
    }
  }

  /**
   * Stop capturing audio from the microphone
   */
  stopCapture(): void {
    // Stop media stream
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    // Disconnect audio worklet
    if (this.audioWorkletNode) {
      this.audioWorkletNode.disconnect();
      this.audioWorkletNode = null;
    }

    console.log('Microphone capture stopped');
  }

  /**
   * Play audio buffer
   *
   * @param audioData - Audio data as ArrayBuffer
   */
  async playAudioBuffer(audioData: ArrayBuffer): Promise<void> {
    try {
      // Initialize audio context on demand
      const audioContext = await this.initializeAudioContext();

      // Resume context if suspended
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      // Decode audio data
      const audioBuffer = await audioContext.decodeAudioData(audioData);

      // Create buffer source
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);

      // Start playback
      source.start();

      // Return promise that resolves when playback ends
      return new Promise((resolve) => {
        source.onended = () => resolve();
      });
    } catch (error) {
      console.error('Error playing audio buffer:', error);
    }
  }

  /**
   * Queue audio data for playback
   *
   * @param audioData - Audio data as Float32Array
   */
  queueAudio(audioData: Float32Array): void {
    this.audioQueue.push(audioData);
    if (!this.isProcessing) {
      this.processAudioQueue();
    }
  }

  /**
   * Process audio queue
   */
  private async processAudioQueue(): Promise<void> {
    if (this.audioQueue.length === 0 || this.isProcessing) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;

    try {
      // Initialize audio context on demand
      const audioContext = await this.initializeAudioContext();

      // Get next audio data
      const audioData = this.audioQueue.shift();

      if (audioData) {
        // Create buffer
        const audioBuffer = audioContext.createBuffer(
          1,
          audioData.length,
          audioContext.sampleRate
        );

        // Fill buffer with data
        audioBuffer.getChannelData(0).set(audioData);

        // Create source
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.destination);

        // Start playback
        source.start();

        // Wait for playback to end
        await new Promise(resolve => {
          source.onended = () => resolve(null);
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
   * Stop audio processing
   */
  stop(): void {
    // Stop media stream
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