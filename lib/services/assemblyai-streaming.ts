/**
 * AssemblyAI Streaming Service
 *
 * This service handles real-time speech-to-text transcription using AssemblyAI's WebSocket API.
 * It supports the Universal model for multilingual transcription.
 */

export class AssemblyAIStreamingService {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private reconnectDelay = 500; // ms
  private currentLanguage = '';
  private onPartialCallback: ((text: string) => void) | null = null;
  private onFinalCallback: ((text: string) => void) | null = null;
  private isReconnecting = false;
  private lastToken: string | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private connectionTimeout: NodeJS.Timeout | null = null;

  /**
   * Connect to AssemblyAI's WebSocket API
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
      this.reconnectAttempts = 0;

      // Close existing connection if any
      this.disconnect();

      // Get temporary auth token from our API
      const tokenResponse = await fetch('/api/assemblyai/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ language }),
      });

      if (!tokenResponse.ok) {
        throw new Error(`Failed to get token: ${tokenResponse.status}`);
      }

      const { token } = await tokenResponse.json();

      if (!token) {
        throw new Error('No token received from API');
      }

      // Store token for reconnection
      this.lastToken = token;

      // Connect WebSocket with Universal model
      await this.createWebSocketConnection(token, language);

      // Set up heartbeat to keep connection alive
      this.setupHeartbeat();
    } catch (error) {
      console.error('AssemblyAI connection error:', error);
      throw error;
    }
  }

  /**
   * Create a new WebSocket connection
   */
  private async createWebSocketConnection(token: string, language: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Clear any existing connection timeout
        if (this.connectionTimeout) {
          clearTimeout(this.connectionTimeout);
        }

        // Set connection timeout
        this.connectionTimeout = setTimeout(() => {
          reject(new Error('WebSocket connection timeout'));
          this.handleReconnect();
        }, 10000);

        // Connect WebSocket with Universal model
        this.ws = new WebSocket(
          `wss://api.assemblyai.com/v2/realtime/ws?sample_rate=16000&token=${token}&language_code=${language}`
        );

        this.ws.onopen = () => {
          console.log('AssemblyAI WebSocket connected');

          // Clear connection timeout
          if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
          }

          // Reset reconnect attempts on successful connection
          this.reconnectAttempts = 0;
          this.isReconnecting = false;

          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            if (data.message_type === 'SessionBegins') {
              this.sessionId = data.session_id;
              console.log(`AssemblyAI session started: ${this.sessionId}`);
            } else if (data.message_type === 'PartialTranscript') {
              if (this.onPartialCallback) {
                this.onPartialCallback(data.text || '');
              }
            } else if (data.message_type === 'FinalTranscript') {
              if (this.onFinalCallback) {
                this.onFinalCallback(data.text || '');
              }
            } else if (data.message_type === 'SessionTerminated') {
              console.log('AssemblyAI session terminated:', data.message || '');

              // Try to reconnect if session terminated unexpectedly
              if (!this.isReconnecting) {
                this.handleReconnect();
              }
            }
          } catch (error) {
            console.error('Error parsing AssemblyAI message:', error);
          }
        };

        this.ws.onerror = (error) => {
          console.error('AssemblyAI WebSocket error:', error);

          // Clear connection timeout
          if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
          }

          reject(error);

          // Try to reconnect
          if (!this.isReconnecting) {
            this.handleReconnect();
          }
        };

        this.ws.onclose = (event) => {
          console.log(`AssemblyAI WebSocket closed: ${event.code} ${event.reason}`);

          // Clear connection timeout
          if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
          }

          // Try to reconnect if not a normal closure
          if (event.code !== 1000 && event.code !== 1001 && !this.isReconnecting) {
            this.handleReconnect();
          }
        };
      } catch (error) {
        console.error('Error creating WebSocket connection:', error);

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
   * Set up heartbeat to keep connection alive
   */
  private setupHeartbeat(): void {
    // Clear any existing heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Send heartbeat every 30 seconds
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        // Send empty message as heartbeat
        this.ws.send(JSON.stringify({ type: 'heartbeat' }));
      } else {
        // Connection lost, try to reconnect
        if (!this.isReconnecting) {
          this.handleReconnect();
        }
      }
    }, 30000);
  }

  /**
   * Handle WebSocket reconnection
   */
  private async handleReconnect(): Promise<void> {
    if (this.isReconnecting || this.reconnectAttempts >= this.maxReconnectAttempts) {
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.error('Max reconnect attempts reached');
      }
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(`Reconnecting to AssemblyAI in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(async () => {
      try {
        if (this.lastToken) {
          await this.createWebSocketConnection(this.lastToken, this.currentLanguage);
        } else {
          // If we don't have a token, we need to get a new one
          await this.connect(
            this.currentLanguage,
            this.onPartialCallback || (() => {}),
            this.onFinalCallback || (() => {})
          );
        }
      } catch (error) {
        console.error('AssemblyAI reconnection failed:', error);
        this.isReconnecting = false;
      }
    }, delay);
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
        console.error('Error sending audio data:', error);

        // Try to reconnect if send fails
        if (!this.isReconnecting) {
          this.handleReconnect();
        }
      }
    } else if (!this.isReconnecting) {
      console.warn('WebSocket not connected, attempting to reconnect...');
      this.handleReconnect();
    }
  }

  /**
   * Disconnect from AssemblyAI's WebSocket API
   */
  disconnect(): void {
    // Clear heartbeat interval
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Clear connection timeout
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }

    // Close WebSocket connection
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }

    this.sessionId = null;
    this.isReconnecting = false;
  }

  /**
   * Pre-warm the connection to reduce initial latency
   */
  async preWarm(): Promise<void> {
    try {
      // Get temporary auth token
      const tokenResponse = await fetch('/api/assemblyai/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ language: 'en' }), // Default to English for pre-warming
      });

      if (!tokenResponse.ok) {
        throw new Error(`Failed to get token: ${tokenResponse.status}`);
      }

      const { token } = await tokenResponse.json();

      if (!token) {
        throw new Error('No token received from API');
      }

      // Store token for later use
      this.lastToken = token;

      // Create a temporary connection
      const ws = new WebSocket(
        `wss://api.assemblyai.com/v2/realtime/ws?sample_rate=16000&token=${token}`
      );

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error('Pre-warm connection timeout'));
        }, 5000);

        ws.onopen = () => {
          clearTimeout(timeout);
          console.log('AssemblyAI service pre-warmed');

          // Close the connection after a short delay
          setTimeout(() => {
            ws.close();
            resolve();
          }, 1000);
        };

        ws.onerror = (error) => {
          clearTimeout(timeout);
          console.warn('Failed to pre-warm AssemblyAI service:', error);
          ws.close();
          reject(error);
        };
      });
    } catch (error) {
      console.warn('Failed to pre-warm AssemblyAI service:', error);
      // Non-critical error, can continue without pre-warming
    }
  }
}