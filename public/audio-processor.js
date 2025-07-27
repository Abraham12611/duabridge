/**
 * Audio Processor Worklet
 *
 * This audio worklet processes microphone input and converts it to 16-bit PCM
 * for AssemblyAI's speech-to-text service.
 */

class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Buffer size for processing audio chunks
    this.bufferSize = 2048;
    // Buffer for accumulating audio samples
    this.buffer = new Float32Array(this.bufferSize);
    // Current position in the buffer
    this.bufferIndex = 0;
  }

  /**
   * Process audio data
   *
   * @param {Array} inputs - Input audio data
   * @param {Array} outputs - Output audio data
   * @param {Object} parameters - Audio parameters
   * @returns {boolean} - Whether to continue processing
   */
  process(inputs, outputs, parameters) {
    // Get the first input channel
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const inputChannel = input[0];

    // Process each sample
    for (let i = 0; i < inputChannel.length; i++) {
      // Store the sample in the buffer
      this.buffer[this.bufferIndex++] = inputChannel[i];

      // When the buffer is full, convert and send the data
      if (this.bufferIndex >= this.bufferSize) {
        // Convert Float32 audio data to 16-bit PCM
        const pcmData = new Int16Array(this.bufferSize);
        for (let j = 0; j < this.bufferSize; j++) {
          // Clamp values to [-1, 1] range
          const sample = Math.max(-1, Math.min(1, this.buffer[j]));
          // Convert to 16-bit PCM (-32768 to 32767)
          pcmData[j] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        }

        // Send the PCM data to the main thread
        this.port.postMessage({
          audioData: pcmData.buffer
        }, [pcmData.buffer]); // Transfer buffer ownership for better performance

        // Reset buffer index for the next chunk
        this.bufferIndex = 0;
      }
    }

    // Return true to keep the processor alive
    return true;
  }
}

// Register the processor
registerProcessor('audio-processor', AudioProcessor);