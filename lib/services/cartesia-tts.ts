/**
 * Cartesia TTS Service
 *
 * This service handles real-time text-to-speech using Cartesia's WebSocket and SSE APIs.
 * It's optimized for ultra-low latency using Sonic Turbo model.
 */

interface ConnectionPool {
  [key: string]: {
    ws: WebSocket;
    lastUsed: number;
    isReady: boolean;
  };
}

export class CartesiaTTSService {
  private apiKey: string;
  private ws: WebSocket | null = null;
  private contextId: string = '';
  private audioQueue: ArrayBuffer[] = [];
  private connectionPool: ConnectionPool = {};
  private connectionTimeout = 60000; // 60 seconds
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private reconnectDelay = 500; // ms
  private currentLanguage = '';
  private currentVoiceId = '';
  private onAudioReadyCallback: ((audioData: ArrayBuffer) => void) | null = null;
  private connectionCleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.apiKey = process.env.NEXT_PUBLIC_CARTESIA_API_KEY || '';
    this.contextId = crypto.randomUUID();

    // Start connection cleanup interval
    this.connectionCleanupInterval = setInterval(() => {
      this.cleanupIdleConnections();
    }, 30000); // Check every 30 seconds
  }

  /**
   * Connect to Cartesia's WebSocket API for lowest latency TTS
   *
   * @param voiceId - Cartesia voice ID
   * @param language - Language code (e.g., 'en', 'es', 'fr')
   * @param onAudioReady - Callback for audio data
   */
  async connectWebSocket(
    voiceId: string,
    language: string,
    onAudioReady: (audioData: ArrayBuffer) => void
  ): Promise<void> {
    try {
      // Store callback and current settings
      this.onAudioReadyCallback = onAudioReady;
      this.currentLanguage = language;
      this.currentVoiceId = voiceId;

      // Generate a connection key
      const connectionKey = `${voiceId}-${language}`;

      // Check if we already have a connection for this voice/language pair
      if (this.connectionPool[connectionKey] && this.connectionPool[connectionKey].isReady) {
        console.log('Reusing existing WebSocket connection');
        this.ws = this.connectionPool[connectionKey].ws;
        this.connectionPool[connectionKey].lastUsed = Date.now();
        return;
      }

      // Close existing connection if any
      if (this.ws) {
        this.disconnect();
      }

      // Generate a new context ID for this session
      this.contextId = crypto.randomUUID();
      this.reconnectAttempts = 0;

      await this.createWebSocketConnection(voiceId, language, connectionKey);
    } catch (error) {
      console.error('Error connecting to Cartesia WebSocket:', error);
      throw error;
    }
  }

  /**
   * Create a new WebSocket connection
   */
  private async createWebSocketConnection(
    voiceId: string,
    language: string,
    connectionKey: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Connect to Cartesia WebSocket
        const ws = new WebSocket('wss://api.cartesia.ai/tts/websocket');
        this.ws = ws;

        // Add to connection pool (marked as not ready yet)
        this.connectionPool[connectionKey] = {
          ws,
          lastUsed: Date.now(),
          isReady: false
        };

        // Set up connection timeout
        const connectionTimeout = setTimeout(() => {
          if (!this.connectionPool[connectionKey]?.isReady) {
            console.error('WebSocket connection timeout');
            ws.close();
            reject(new Error('WebSocket connection timeout'));
          }
        }, 10000);

        ws.onopen = () => {
          console.log('Cartesia WebSocket connected');
          clearTimeout(connectionTimeout);

          // Send initial configuration
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              context_id: this.contextId,
              model_id: "sonic-turbo",  // Use Sonic Turbo for lowest latency
              voice: {
                mode: "id",
                id: voiceId
              },
              language: language,
              output_format: {
                container: "raw",
                encoding: "pcm_f32le",
                sample_rate: 44100
              },
              // Required header for Cartesia API
              headers: {
                'X-API-Key': this.apiKey,
                'Cartesia-Version': '2024-11-13'
              }
            }));

            // Mark connection as ready
            this.connectionPool[connectionKey].isReady = true;
            resolve();
          }
        };

        ws.onmessage = async (event) => {
          if (event.data instanceof Blob) {
            try {
              const arrayBuffer = await event.data.arrayBuffer();
              // Process audio data
              if (this.onAudioReadyCallback) {
                this.onAudioReadyCallback(arrayBuffer);
              }

              // Update last used timestamp
              if (this.connectionPool[connectionKey]) {
                this.connectionPool[connectionKey].lastUsed = Date.now();
              }
            } catch (error) {
              console.error('Error processing audio data:', error);
            }
          } else {
            try {
              // Handle JSON messages (like errors or status updates)
              const data = JSON.parse(event.data);
              if (data.error) {
                console.error('Cartesia WebSocket error:', data.error);
              }
            } catch (error) {
              console.error('Error parsing WebSocket message:', error);
            }
          }
        };

        ws.onerror = (error) => {
          console.error('Cartesia WebSocket error:', error);
          clearTimeout(connectionTimeout);

          // Remove from connection pool
          delete this.connectionPool[connectionKey];

          reject(error);
        };

        ws.onclose = (event) => {
          console.log(`Cartesia WebSocket closed: ${event.code} ${event.reason}`);

          // Remove from connection pool
          delete this.connectionPool[connectionKey];

          // Try to reconnect if unexpected close
          if (event.code !== 1000 && event.code !== 1001) {
            this.handleReconnect(voiceId, language);
          }
        };
      } catch (error) {
        console.error('Error creating WebSocket connection:', error);
        reject(error);
      }
    });
  }

  /**
   * Handle WebSocket reconnection
   */
  private async handleReconnect(voiceId: string, language: string): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(async () => {
      try {
        const connectionKey = `${voiceId}-${language}`;
        await this.createWebSocketConnection(voiceId, language, connectionKey);
      } catch (error) {
        console.error('Reconnection failed:', error);
      }
    }, delay);
  }

  /**
   * Clean up idle connections
   */
  private cleanupIdleConnections(): void {
    const now = Date.now();

    Object.entries(this.connectionPool).forEach(([key, connection]) => {
      if (now - connection.lastUsed > this.connectionTimeout) {
        console.log(`Closing idle connection: ${key}`);
        connection.ws.close();
        delete this.connectionPool[key];
      }
    });
  }

  /**
   * Stream text to Cartesia for TTS conversion
   *
   * @param text - Text to convert to speech
   */
  async streamText(text: string): Promise<void> {
    if (!text.trim()) return;

    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({
          transcript: text,
          continue: true,  // Keep connection open for more text
          context_id: this.contextId
        }));
      } catch (error) {
        console.error('Error sending text to Cartesia:', error);

        // Try to reconnect
        if (this.currentVoiceId && this.currentLanguage && this.onAudioReadyCallback) {
          this.handleReconnect(this.currentVoiceId, this.currentLanguage);
        }
      }
    } else {
      console.error('WebSocket not connected');

      // Try to reconnect
      if (this.currentVoiceId && this.currentLanguage && this.onAudioReadyCallback) {
        await this.connectWebSocket(
          this.currentVoiceId,
          this.currentLanguage,
          this.onAudioReadyCallback
        );

        // Retry sending text
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.streamText(text);
        }
      }
    }
  }

  /**
   * Use SSE endpoint as an alternative to WebSocket
   *
   * @param text - Text to convert to speech
   * @param voiceId - Cartesia voice ID
   * @param language - Language code (e.g., 'en', 'es', 'fr')
   * @param onAudioChunk - Callback for audio chunks
   */
  async useSSEEndpoint(
    text: string,
    voiceId: string,
    language: string,
    onAudioChunk: (chunk: ArrayBuffer) => void
  ): Promise<void> {
    if (!text.trim()) return;

    try {
      // Use SSE endpoint for simpler implementation
      const response = await fetch('https://api.cartesia.ai/tts/sse', {
        method: 'POST',
        headers: {
          'X-API-Key': this.apiKey,
          'Cartesia-Version': '2024-11-13',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model_id: 'sonic-turbo',
          transcript: text,
          voice: {
            mode: 'id',
            id: voiceId
          },
          language: language,
          output_format: {
            container: 'raw',
            encoding: 'pcm_s16le',
            sample_rate: 44100
          },
          stream: true
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Parse SSE stream
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('Failed to get reader from response');
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.audio) {
                const audioData = Uint8Array.from(atob(data.audio), c => c.charCodeAt(0));
                onAudioChunk(audioData.buffer);
              }
            } catch (error) {
              console.error('Error parsing SSE data:', error);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error using Cartesia SSE endpoint:', error);
    }
  }

  /**
   * Pre-warm the TTS service connection
   * This can reduce cold start latency for the first speech synthesis
   */
  async preWarm(voiceId: string, language: string): Promise<void> {
    try {
      const connectionKey = `${voiceId}-${language}`;

      // Create a WebSocket connection but don't store it in the main ws property
      const ws = new WebSocket('wss://api.cartesia.ai/tts/websocket');

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error('Pre-warm connection timeout'));
        }, 5000);

        ws.onopen = () => {
          ws.send(JSON.stringify({
            context_id: crypto.randomUUID(),
            model_id: "sonic-turbo",
            voice: {
              mode: "id",
              id: voiceId
            },
            language: language,
            output_format: {
              container: "raw",
              encoding: "pcm_f32le",
              sample_rate: 44100
            },
            headers: {
              'X-API-Key': this.apiKey,
              'Cartesia-Version': '2024-11-13'
            }
          }));

          // Store in connection pool for potential reuse
          this.connectionPool[connectionKey] = {
            ws,
            lastUsed: Date.now(),
            isReady: true
          };

          clearTimeout(timeout);
          console.log('TTS service pre-warmed');
          resolve();
        };

        ws.onerror = (error) => {
          clearTimeout(timeout);
          console.warn('Failed to pre-warm TTS service:', error);
          ws.close();
          reject(error);
        };
      });
    } catch (error) {
      console.warn('Failed to pre-warm TTS service:', error);
      // Non-critical error, can continue without pre-warming
    }
  }

  /**
   * Disconnect from Cartesia's WebSocket API
   */
  disconnect(): void {
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }

    // Don't clear the connection pool here, just set current connection to null

    // Clear audio queue
    this.audioQueue = [];
    this.onAudioReadyCallback = null;
  }

  /**
   * Clean up all resources
   */
  cleanup(): void {
    // Clear the cleanup interval
    if (this.connectionCleanupInterval) {
      clearInterval(this.connectionCleanupInterval);
      this.connectionCleanupInterval = null;
    }

    // Close all connections
    Object.values(this.connectionPool).forEach(connection => {
      if (connection.ws.readyState === WebSocket.OPEN ||
          connection.ws.readyState === WebSocket.CONNECTING) {
        connection.ws.close();
      }
    });

    // Clear the connection pool
    this.connectionPool = {};

    // Disconnect current connection
    this.disconnect();
  }
}