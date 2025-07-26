/**
 * Cartesia TTS Service
 *
 * This service handles text-to-speech conversion using Cartesia's API
 */

import { EventSourceParserStream } from 'eventsource-parser/stream';

interface AudioChunk {
  type: string;
  data?: string;
  done?: boolean;
  status_code?: number;
  context_id?: string;
}

export class CartesiaTTSService {
  private ws: WebSocket | null = null;
  private contextId: string | null = null;
  private audioQueue: ArrayBuffer[] = [];
  private isPlaying = false;
  private audioContext: AudioContext | null = null;
  private nextStartTime = 0;
  private baseUrl = 'https://api.cartesia.ai';
  private version = '2025-04-16';
  private connectionPool = new Map<string, WebSocket>();
  private maxPoolSize = 3;
  private connectionIdleTimeout = 30000; // 30 seconds
  private connectionTimers = new Map<string, NodeJS.Timeout>();

  constructor() {
    if (typeof window !== 'undefined') {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  }

  /**
   * Get access token for WebSocket authentication
   */
  private async getAccessToken(): Promise<string> {
    try {
      const response = await fetch('/api/cartesia/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to get access token: ${response.status}`);
      }

      const data = await response.json();
      return data.token;
    } catch (error) {
      console.error('Error getting Cartesia access token:', error);
      throw error;
    }
  }

  /**
   * Connect to Cartesia WebSocket for streaming TTS
   */
  async connectWebSocket(voiceId?: string, language?: string): Promise<void> {
    try {
      // Get access token first
      const accessToken = await this.getAccessToken();

      // Create connection key for pooling
      const connectionKey = `${voiceId || 'default'}-${language || 'en'}`;

      // Check if we have an existing connection
      if (this.connectionPool.has(connectionKey)) {
        const existingWs = this.connectionPool.get(connectionKey)!;
        if (existingWs.readyState === WebSocket.OPEN) {
          console.log('Reusing existing WebSocket connection');
          this.ws = existingWs;

          // Reset idle timer
          this.resetConnectionIdleTimer(connectionKey);
          return;
        } else {
          // Remove stale connection
          this.connectionPool.delete(connectionKey);
          this.clearConnectionIdleTimer(connectionKey);
        }
      }

      // Check pool size limit
      if (this.connectionPool.size >= this.maxPoolSize) {
        // Close the oldest connection
        const oldestKey = this.connectionPool.keys().next().value;
        const oldestWs = this.connectionPool.get(oldestKey)!;
        oldestWs.close();
        this.connectionPool.delete(oldestKey);
        this.clearConnectionIdleTimer(oldestKey);
      }

      const wsUrl = `wss://api.cartesia.ai/tts/websocket?access_token=${accessToken}&cartesia_version=${this.version}`;
      console.log('Connecting to Cartesia WebSocket...');

      this.ws = new WebSocket(wsUrl);
      this.contextId = `ctx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Add to connection pool
      this.connectionPool.set(connectionKey, this.ws);
      this.resetConnectionIdleTimer(connectionKey);

      return new Promise((resolve, reject) => {
        if (!this.ws) {
          reject(new Error('WebSocket not initialized'));
          return;
        }

        this.ws.onopen = () => {
          console.log('Cartesia WebSocket connected');
          resolve();
        };

        this.ws.onerror = (error) => {
          console.error('Cartesia WebSocket error:', error);
          reject(error);
        };

        this.ws.onmessage = async (event) => {
          try {
            const data = JSON.parse(event.data);

            if (data.type === 'chunk' && data.data) {
              // Decode base64 audio data
              const audioData = this.base64ToArrayBuffer(data.data);
              this.audioQueue.push(audioData);

              // Start playing if not already playing
              if (!this.isPlaying) {
                this.playAudioQueue();
              }
            } else if (data.type === 'done') {
              console.log('TTS generation complete');
            } else if (data.type === 'error') {
              console.error('TTS error:', data);
            }
          } catch (error) {
            console.error('Error processing TTS message:', error);
          }
        };

        this.ws.onclose = () => {
          console.log('Cartesia WebSocket closed');
          this.connectionPool.delete(connectionKey);
          this.clearConnectionIdleTimer(connectionKey);
        };
      });
    } catch (error) {
      console.error('Error connecting to Cartesia WebSocket:', error);
      throw error;
    }
  }

  /**
   * Reset the idle timer for a connection
   */
  private resetConnectionIdleTimer(connectionKey: string): void {
    // Clear existing timer
    this.clearConnectionIdleTimer(connectionKey);

    // Set new timer
    const timer = setTimeout(() => {
      const ws = this.connectionPool.get(connectionKey);
      if (ws && ws.readyState === WebSocket.OPEN) {
        console.log(`Closing idle connection: ${connectionKey}`);
        ws.close();
        this.connectionPool.delete(connectionKey);
      }
    }, this.connectionIdleTimeout);

    this.connectionTimers.set(connectionKey, timer);
  }

  /**
   * Clear the idle timer for a connection
   */
  private clearConnectionIdleTimer(connectionKey: string): void {
    const timer = this.connectionTimers.get(connectionKey);
    if (timer) {
      clearTimeout(timer);
      this.connectionTimers.delete(connectionKey);
    }
  }

  /**
   * Stream text to TTS via WebSocket
   */
  async streamText(text: string, voiceId: string, language: string = 'en'): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connectWebSocket(voiceId, language);
    }

    if (!this.ws) {
      throw new Error('WebSocket not connected');
    }

    const message = {
      model_id: 'sonic-turbo',
      voice: {
        mode: 'id',
        id: voiceId
      },
      transcript: text,
      language: language,
      context_id: this.contextId,
      output_format: {
        container: 'raw',
        encoding: 'pcm_s16le',
        sample_rate: 16000
      },
      add_timestamps: false,
      continue: false
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Use SSE endpoint for simpler TTS (alternative to WebSocket)
   */
  async useSSEEndpoint(text: string, voiceId: string, language: string = 'en'): Promise<void> {
    try {
      const accessToken = await this.getAccessToken();

      const response = await fetch(`${this.baseUrl}/tts/sse`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Cartesia-Version': this.version,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model_id: 'sonic-turbo',
          voice: {
            mode: 'id',
            id: voiceId
          },
          transcript: text,
          language: language,
          output_format: {
            container: 'raw',
            encoding: 'pcm_s16le',
            sample_rate: 16000
          }
        })
      });

      if (!response.ok) {
        throw new Error(`SSE request failed: ${response.status}`);
      }

      const reader = response.body!
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new EventSourceParserStream())
        .getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (value.data) {
          try {
            const chunk: AudioChunk = JSON.parse(value.data);
            if (chunk.type === 'chunk' && chunk.data) {
              const audioData = this.base64ToArrayBuffer(chunk.data);
              this.audioQueue.push(audioData);

              if (!this.isPlaying) {
                this.playAudioQueue();
              }
            }
          } catch (error) {
            console.error('Error parsing SSE chunk:', error);
          }
        }
      }
    } catch (error) {
      console.error('SSE TTS error:', error);
      throw error;
    }
  }

  /**
   * Convert base64 to ArrayBuffer
   */
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Play audio queue
   */
  private async playAudioQueue(): Promise<void> {
    if (!this.audioContext || this.isPlaying || this.audioQueue.length === 0) {
      return;
    }

    this.isPlaying = true;

    while (this.audioQueue.length > 0) {
      const audioData = this.audioQueue.shift()!;
      await this.playAudioChunk(audioData);
    }

    this.isPlaying = false;
  }

  /**
   * Play a single audio chunk
   */
  private async playAudioChunk(audioData: ArrayBuffer): Promise<void> {
    if (!this.audioContext) return;

    try {
      // Convert PCM to audio buffer
      const audioBuffer = this.audioContext.createBuffer(
        1, // mono
        audioData.byteLength / 2, // 16-bit samples
        16000 // sample rate
      );

      const channelData = audioBuffer.getChannelData(0);
      const int16Array = new Int16Array(audioData);

      for (let i = 0; i < int16Array.length; i++) {
        channelData[i] = int16Array[i] / 32768; // Convert to float
      }

      // Create and play source
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext.destination);

      const currentTime = this.audioContext.currentTime;
      const startTime = Math.max(currentTime, this.nextStartTime);

      source.start(startTime);
      this.nextStartTime = startTime + audioBuffer.duration;

      // Wait for playback to complete
      await new Promise(resolve => {
        source.onended = resolve;
      });
    } catch (error) {
      console.error('Error playing audio chunk:', error);
    }
  }

  /**
   * Disconnect WebSocket
   */
  disconnect(): void {
    // Close all connections in the pool
    this.connectionPool.forEach((ws, key) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      this.clearConnectionIdleTimer(key);
    });

    this.connectionPool.clear();
    this.ws = null;
    this.contextId = null;
    this.audioQueue = [];
    this.isPlaying = false;
    this.nextStartTime = 0;
  }

  /**
   * Clean up all resources
   */
  cleanup(): void {
    this.disconnect();

    // Close audio context
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}