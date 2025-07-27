/**
 * AssemblyAI Streaming Service
 *
 * This service handles real-time speech-to-text transcription using AssemblyAI's WebSocket API
 * via a local proxy server to avoid CORS and authentication issues.
 */

export class AssemblyAIStreamingService {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private currentLanguage = '';
  private onPartialCallback: ((text: string) => void) | null = null;
  private onFinalCallback: ((text: string) => void) | null = null;
  private isClosingIntentionally = false;
  private connectionTimeout: NodeJS.Timeout | null = null;

  /**
   * Connect to AssemblyAI's WebSocket API via proxy
   *
   * @param language - Language code (e.g., 'en', 'es', 'fr') or 'automatic' for auto-detection
   * @param onPartialTranscript - Callback for partial transcripts
   * @param onFinalTranscript - Callback for final transcripts
   */
  async connect(
    language: string,
    onPartialTranscript: (text: string) => void,
    onFinalTranscript: (text: string) => void
  ): Promise<void> {
    try {
      // Store callbacks and current settings
      this.onPartialCallback = onPartialTranscript;
      this.onFinalCallback = onFinalTranscript;
      this.currentLanguage = language;
      this.isClosingIntentionally = false;

      // Close existing connection if any
      this.disconnect();

      // Connect to local WebSocket proxy
      await this.createWebSocketConnection();

      console.log('Successfully connected to AssemblyAI proxy');
    } catch (error) {
      console.error('AssemblyAI connection error:', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  /**
   * Get the proxy server port from the API
   */
  private async getProxyPort(): Promise<number> {
    try {
      // Try to read the port from our Next.js API route
      if (typeof window !== 'undefined') {
        try {
          const response = await fetch('/api/proxy-port', {
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache' }
          });

          if (response.ok) {
            const port = parseInt(await response.text().trim(), 10);
            if (!isNaN(port)) {
              console.log(`Using proxy port: ${port}`);
              return port;
            }
          }
        } catch (e) {
          console.log('Could not read proxy port from API, using default port 4001');
        }
      }
    } catch (e) {
      // Ignore errors
    }

    return 4001; // Default port
  }

  /**
   * Create a new WebSocket connection to the proxy server
   */
  private async createWebSocketConnection(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        // Clear any existing connection timeout
        if (this.connectionTimeout) {
          clearTimeout(this.connectionTimeout);
        }

        // Set connection timeout
        this.connectionTimeout = setTimeout(() => {
          console.error('WebSocket connection timeout');
          reject(new Error('WebSocket connection timeout'));
          this.cleanup();
        }, 10000);

        // Get the proxy port
        const port = await this.getProxyPort();

        // Connect to local WebSocket proxy
        const wsUrl = `ws://localhost:${port}`;
        console.log(`Connecting to AssemblyAI proxy: ${wsUrl}`);

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log('AssemblyAI proxy WebSocket connected');

          // Clear connection timeout
          if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
          }

          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            // Handle v3 API message types
            if (data.type === 'Begin') {
              this.sessionId = data.id;
              console.log(`AssemblyAI session started: ${this.sessionId}, expires at: ${data.expires_at}`);
            } else if (data.type === 'Turn') {
              // Handle Turn message which contains both partial and final transcripts
              const transcript = data.transcript || '';
              const isFormatted = data.turn_is_formatted || false;
              const isEndOfTurn = data.end_of_turn || false;

              if (isFormatted || isEndOfTurn) {
                // This is a final transcript
                if (this.onFinalCallback) {
                  this.onFinalCallback(transcript);
                }
              } else {
                // This is a partial transcript
                if (this.onPartialCallback) {
                  this.onPartialCallback(transcript);
                }
              }
            } else if (data.type === 'Error') {
              console.error('AssemblyAI WebSocket error message:', data.error || 'Unknown error');
            } else if (data.type === 'Termination') {
              console.log('AssemblyAI session terminated:', data.message || '');
              this.cleanup();
            } else {
              console.log('Received message from AssemblyAI:', data);
            }
          } catch (error) {
            console.error('Error parsing AssemblyAI message:', error instanceof Error ? error.message : 'Unknown error', 'Raw data:', event.data);
          }
        };

        this.ws.onerror = (event) => {
          // Log more detailed error information
          const errorDetail = event instanceof ErrorEvent ? event.message : 'WebSocket error event';
          console.error('AssemblyAI WebSocket error:', errorDetail);

          // Clear connection timeout
          if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
          }

          reject(new Error(`WebSocket error: ${errorDetail}`));
        };

        this.ws.onclose = (event) => {
          console.log(`AssemblyAI WebSocket closed: ${event.code} ${event.reason}`);

          // Clear connection timeout
          if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
          }
        };
      } catch (error) {
        console.error('Error creating WebSocket connection:', error instanceof Error ? error.message : 'Unknown error');

        // Clear connection timeout
        if (this.connectionTimeout) {
          clearTimeout(this.connectionTimeout);
          this.connectionTimeout = null;
        }

        reject(error);
      }
    });
  }

  /**
   * Send audio data to AssemblyAI for transcription
   *
   * @param audioData - Raw audio data as ArrayBuffer
   */
  sendAudioData(audioData: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(audioData);
      } catch (error) {
        console.error('Error sending audio data:', error instanceof Error ? error.message : 'Unknown error');
      }
    } else {
      console.warn('WebSocket not connected, cannot send audio data');
    }
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    // Mark that we're intentionally closing
    this.isClosingIntentionally = true;

    // Clear connection timeout
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }

    // Close WebSocket connection
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close(1000, 'Intentional disconnect');
      } else if (this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000);
      }
      this.ws = null;
    }

    this.sessionId = null;
  }

  /**
   * Disconnect from AssemblyAI's WebSocket API
   */
  disconnect(): void {
    this.cleanup();
  }
}