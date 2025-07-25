# 🌐 LinguaBridge Implementation Plan

## Overview

Transform the existing GetAutoCue codebase into LinguaBridge - a real-time bidirectional voice translation app using AssemblyAI STT, Gemini translation, and Cartesia TTS.

**Target Latency**: Sub-500ms round-trip (goal: ~300ms)

## Architecture Flow

```
User A (Language A) → Mic → AssemblyAI STT → Gemini Translation → Cartesia TTS → Speaker → User B (Language B)
                                                ↑                                               ↓
                                                └───────────────────────────────────────────────┘
```

## Phase 1: Project Setup & Dependencies

### 1.1 Update Dependencies
```json
{
  "dependencies": {
    "@google/generative-ai": "^0.21.0",  // For Gemini API
    "eventsource-parser": "^1.1.2",      // For SSE parsing
    "iso-639-1": "^3.1.3"                // Language code utilities
  }
}
```

### 1.2 Environment Variables
```env
NEXT_PUBLIC_ASSEMBLYAI_API_KEY=your_assemblyai_key
ASSEMBLYAI_API_KEY=your_assemblyai_key
GEMINI_API_KEY=your_gemini_key
CARTESIA_API_KEY=your_cartesia_key
```

### 1.3 Remove Unused Code
- Remove teleprompter-specific functionality
- Remove fuse_matching.ts (not needed for translation)
- Simplify UI components

## Phase 2: Core Services Implementation

### 2.1 AssemblyAI Streaming Service
**File**: `lib/services/assemblyai-streaming.ts`

```typescript
class AssemblyAIStreamingService {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;

  async connect(
    language: string,
    onPartialTranscript: (text: string) => void,
    onFinalTranscript: (text: string) => void
  ) {
    // Get temporary auth token
    const tokenResponse = await fetch('/api/assemblyai/token');
    const { token } = await tokenResponse.json();

    // Connect WebSocket with Universal model
    this.ws = new WebSocket(
      `wss://api.assemblyai.com/v2/realtime/ws?sample_rate=16000&token=${token}&language_code=${language}`
    );

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.message_type === 'PartialTranscript') {
        onPartialTranscript(data.text);
      } else if (data.message_type === 'FinalTranscript') {
        onFinalTranscript(data.text);
      }
    };
  }

  sendAudioData(audioData: ArrayBuffer) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(audioData);
    }
  }

  disconnect() {
    this.ws?.close();
  }
}
```

### 2.2 Gemini Translation Service
**File**: `lib/services/gemini-translation.ts`

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';

class GeminiTranslationService {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    this.model = this.genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.1,  // Low temperature for consistent translations
        maxOutputTokens: 256,
      }
    });
  }

  async translateStream(
    text: string,
    sourceLang: string,
    targetLang: string,
    onTranslation: (translated: string) => void
  ) {
    const prompt = `Translate the following ${sourceLang} text to ${targetLang}.
    Only output the translation, nothing else.
    Keep the tone and style natural for spoken conversation.
    Text: "${text}"`;

    try {
      const result = await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 256,
        },
        safetySettings: [
          {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_NONE",
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_NONE",
          }
        ]
      });

      const translation = result.response.text();
      onTranslation(translation);
    } catch (error) {
      console.error('Translation error:', error);
    }
  }
}
```

### 2.3 Cartesia TTS Service
**File**: `lib/services/cartesia-tts.ts`

```typescript
class CartesiaTTSService {
  private apiKey: string;
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private audioQueue: Float32Array[] = [];

  constructor() {
    this.apiKey = process.env.NEXT_PUBLIC_CARTESIA_API_KEY!;
  }

  async connectWebSocket(
    voiceId: string,
    language: string,
    onAudioReady: (audioData: ArrayBuffer) => void
  ) {
    // Use WebSocket for lowest latency
    this.ws = new WebSocket('wss://api.cartesia.ai/tts/websocket');

    this.ws.onopen = () => {
      // Send initial configuration
      this.ws?.send(JSON.stringify({
        context_id: crypto.randomUUID(),
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
        }
      }));
    };

    this.ws.onmessage = async (event) => {
      if (event.data instanceof Blob) {
        const arrayBuffer = await event.data.arrayBuffer();
        onAudioReady(arrayBuffer);
      }
    };
  }

  async streamText(text: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        transcript: text,
        continue: true,  // Keep connection open for more text
        context_id: this.contextId
      }));
    }
  }

  async useSSEEndpoint(
    text: string,
    voiceId: string,
    language: string,
    onAudioChunk: (chunk: ArrayBuffer) => void
  ) {
    // Alternative: Use SSE endpoint for simpler implementation
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

    // Parse SSE stream
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6));
          if (data.audio) {
            const audioData = Uint8Array.from(atob(data.audio), c => c.charCodeAt(0));
            onAudioChunk(audioData.buffer);
          }
        }
      }
    }
  }
}
```

### 2.4 Audio Processing Service
**File**: `lib/services/audio-processor.ts`

```typescript
class AudioProcessor {
  private audioContext: AudioContext;
  private mediaStream: MediaStream | null = null;
  private audioWorkletNode: AudioWorkletNode | null = null;

  constructor() {
    this.audioContext = new AudioContext({ sampleRate: 16000 });
  }

  async startMicrophoneCapture(onAudioData: (data: ArrayBuffer) => void) {
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    const source = this.audioContext.createMediaStreamSource(this.mediaStream);

    // Create processor for 16-bit PCM conversion
    await this.audioContext.audioWorklet.addModule('/audio-processor.js');
    this.audioWorkletNode = new AudioWorkletNode(this.audioContext, 'audio-processor');

    this.audioWorkletNode.port.onmessage = (event) => {
      if (event.data.audioData) {
        onAudioData(event.data.audioData);
      }
    };

    source.connect(this.audioWorkletNode);
    this.audioWorkletNode.connect(this.audioContext.destination);
  }

  async playAudioBuffer(audioData: ArrayBuffer) {
    const audioBuffer = await this.audioContext.decodeAudioData(audioData);
    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);
    source.start();
  }

  stop() {
    this.mediaStream?.getTracks().forEach(track => track.stop());
    this.audioWorkletNode?.disconnect();
  }
}
```

## Phase 3: API Routes

### 3.1 Update AssemblyAI Token Route
**File**: `app/api/assemblyai/token/route.ts`

```typescript
export async function POST(request: Request) {
  const { language } = await request.json();

  const response = await fetch('https://api.assemblyai.com/v2/realtime/token', {
    method: 'POST',
    headers: {
      'Authorization': process.env.ASSEMBLYAI_API_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      expires_in: 3600,
      // Enable Universal model for multilingual support
      language_code: language || 'automatic'
    }),
  });

  const data = await response.json();
  return Response.json({ token: data.token });
}
```

### 3.2 Gemini Translation Route
**File**: `app/api/translate/route.ts`

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(request: Request) {
  const { text, sourceLang, targetLang } = await request.json();

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 256,
    }
  });

  const prompt = `Translate from ${sourceLang} to ${targetLang}: "${text}"
  Output only the translation.`;

  const result = await model.generateContent(prompt);
  const translation = result.response.text();

  return Response.json({ translation });
}
```

### 3.3 Cartesia Voices Route
**File**: `app/api/cartesia/voices/route.ts`

```typescript
export async function GET() {
  const response = await fetch('https://api.cartesia.ai/voices', {
    headers: {
      'X-API-Key': process.env.CARTESIA_API_KEY!,
      'Cartesia-Version': '2024-11-13'
    }
  });

  const voices = await response.json();
  return Response.json(voices);
}
```

## Phase 4: Custom Hook for Translation

### 4.1 Translation Hook
**File**: `hooks/use-translation.ts`

```typescript
import { useState, useCallback, useRef } from 'react';
import { AssemblyAIStreamingService } from '@/lib/services/assemblyai-streaming';
import { GeminiTranslationService } from '@/lib/services/gemini-translation';
import { CartesiaTTSService } from '@/lib/services/cartesia-tts';
import { AudioProcessor } from '@/lib/services/audio-processor';

interface UseTranslationOptions {
  speakerALanguage: string;
  speakerBLanguage: string;
  voiceIdA: string;
  voiceIdB: string;
}

export function useTranslation(options: UseTranslationOptions) {
  const [isActive, setIsActive] = useState(false);
  const [currentSpeaker, setCurrentSpeaker] = useState<'A' | 'B'>('A');
  const [transcriptA, setTranscriptA] = useState('');
  const [transcriptB, setTranscriptB] = useState('');
  const [translationA, setTranslationA] = useState('');
  const [translationB, setTranslationB] = useState('');

  const servicesRef = useRef({
    assemblyAI: new AssemblyAIStreamingService(),
    gemini: new GeminiTranslationService(),
    cartesia: new CartesiaTTSService(),
    audioProcessor: new AudioProcessor()
  });

  const translationBufferRef = useRef('');
  const translationTimerRef = useRef<NodeJS.Timeout>();

  const handlePartialTranscript = useCallback((text: string, speaker: 'A' | 'B') => {
    if (speaker === 'A') {
      setTranscriptA(text);
    } else {
      setTranscriptB(text);
    }

    // Buffer partial transcripts for better translation chunks
    translationBufferRef.current = text;

    // Debounce translation requests (300ms)
    clearTimeout(translationTimerRef.current);
    translationTimerRef.current = setTimeout(() => {
      if (translationBufferRef.current.length > 0) {
        translateAndSpeak(translationBufferRef.current, speaker);
      }
    }, 300);
  }, [options]);

  const translateAndSpeak = async (text: string, speaker: 'A' | 'B') => {
    const sourceLang = speaker === 'A' ? options.speakerALanguage : options.speakerBLanguage;
    const targetLang = speaker === 'A' ? options.speakerBLanguage : options.speakerALanguage;
    const voiceId = speaker === 'A' ? options.voiceIdB : options.voiceIdA;

    // Translate
    await servicesRef.current.gemini.translateStream(
      text,
      sourceLang,
      targetLang,
      async (translation) => {
        if (speaker === 'A') {
          setTranslationB(translation);
        } else {
          setTranslationA(translation);
        }

        // Convert to speech
        await servicesRef.current.cartesia.streamText(translation);
      }
    );
  };

  const start = async () => {
    setIsActive(true);

    // Initialize audio
    await servicesRef.current.audioProcessor.startMicrophoneCapture(
      (audioData) => {
        servicesRef.current.assemblyAI.sendAudioData(audioData);
      }
    );

    // Connect AssemblyAI
    await servicesRef.current.assemblyAI.connect(
      currentSpeaker === 'A' ? options.speakerALanguage : options.speakerBLanguage,
      (partial) => handlePartialTranscript(partial, currentSpeaker),
      (final) => handlePartialTranscript(final, currentSpeaker)
    );

    // Connect Cartesia
    await servicesRef.current.cartesia.connectWebSocket(
      currentSpeaker === 'A' ? options.voiceIdB : options.voiceIdA,
      currentSpeaker === 'A' ? options.speakerBLanguage : options.speakerALanguage,
      (audioData) => {
        servicesRef.current.audioProcessor.playAudioBuffer(audioData);
      }
    );
  };

  const stop = () => {
    setIsActive(false);
    servicesRef.current.assemblyAI.disconnect();
    servicesRef.current.audioProcessor.stop();
    clearTimeout(translationTimerRef.current);
  };

  const switchSpeaker = () => {
    setCurrentSpeaker(current => current === 'A' ? 'B' : 'A');
    // Reconnect with new language settings
    if (isActive) {
      stop();
      setTimeout(start, 100);
    }
  };

  return {
    isActive,
    currentSpeaker,
    transcriptA,
    transcriptB,
    translationA,
    translationB,
    start,
    stop,
    switchSpeaker
  };
}
```

## Phase 5: UI Implementation

### 5.1 Main Page Component
**File**: `app/page.tsx`

```typescript
'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from '@/hooks/use-translation';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Mic, MicOff, ArrowLeftRight } from 'lucide-react';

const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ru', name: 'Russian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'zh', name: 'Chinese (Mandarin)' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
];

export default function Home() {
  const [speakerALang, setSpeakerALang] = useState('en');
  const [speakerBLang, setSpeakerBLang] = useState('es');
  const [voices, setVoices] = useState<any[]>([]);
  const [voiceA, setVoiceA] = useState('');
  const [voiceB, setVoiceB] = useState('');

  const {
    isActive,
    currentSpeaker,
    transcriptA,
    transcriptB,
    translationA,
    translationB,
    start,
    stop,
    switchSpeaker
  } = useTranslation({
    speakerALanguage: speakerALang,
    speakerBLanguage: speakerBLang,
    voiceIdA: voiceA,
    voiceIdB: voiceB
  });

  // Load Cartesia voices
  useEffect(() => {
    fetch('/api/cartesia/voices')
      .then(res => res.json())
      .then(data => {
        setVoices(data);
        // Set default voices
        const englishVoice = data.find((v: any) => v.language === 'en');
        const spanishVoice = data.find((v: any) => v.language === 'es');
        if (englishVoice) setVoiceA(englishVoice.id);
        if (spanishVoice) setVoiceB(spanishVoice.id);
      });
  }, []);

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold text-center mb-8 text-gray-800">
          LinguaBridge
        </h1>
        <p className="text-center text-gray-600 mb-12">
          Real-time voice translation with ultra-low latency
        </p>

        {/* Language Selection */}
        <div className="bg-white rounded-2xl shadow-xl p-8 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
            {/* Speaker A */}
            <div className="space-y-4">
              <label className="text-sm font-medium text-gray-700">
                Speaker A Language
              </label>
              <Select value={speakerALang} onValueChange={setSpeakerALang}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_LANGUAGES.map(lang => (
                    <SelectItem key={lang.code} value={lang.code}>
                      {lang.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <label className="text-sm font-medium text-gray-700">
                Voice A
              </label>
              <Select value={voiceA} onValueChange={setVoiceA}>
                <SelectTrigger>
                  <SelectValue placeholder="Select voice" />
                </SelectTrigger>
                <SelectContent>
                  {voices
                    .filter(v => v.language === speakerALang)
                    .map(voice => (
                      <SelectItem key={voice.id} value={voice.id}>
                        {voice.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {/* Arrow */}
            <div className="flex justify-center">
              <ArrowLeftRight className="w-8 h-8 text-gray-400" />
            </div>

            {/* Speaker B */}
            <div className="space-y-4">
              <label className="text-sm font-medium text-gray-700">
                Speaker B Language
              </label>
              <Select value={speakerBLang} onValueChange={setSpeakerBLang}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_LANGUAGES.map(lang => (
                    <SelectItem key={lang.code} value={lang.code}>
                      {lang.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <label className="text-sm font-medium text-gray-700">
                Voice B
              </label>
              <Select value={voiceB} onValueChange={setVoiceB}>
                <SelectTrigger>
                  <SelectValue placeholder="Select voice" />
                </SelectTrigger>
                <SelectContent>
                  {voices
                    .filter(v => v.language === speakerBLang)
                    .map(voice => (
                      <SelectItem key={voice.id} value={voice.id}>
                        {voice.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Control Buttons */}
        <div className="flex justify-center gap-4 mb-8">
          <Button
            size="lg"
            onClick={isActive ? stop : start}
            className={isActive ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}
          >
            {isActive ? <MicOff className="mr-2" /> : <Mic className="mr-2" />}
            {isActive ? 'Stop Translation' : 'Start Translation'}
          </Button>

          {isActive && (
            <Button
              size="lg"
              variant="outline"
              onClick={switchSpeaker}
            >
              Switch to Speaker {currentSpeaker === 'A' ? 'B' : 'A'}
            </Button>
          )}
        </div>

        {/* Live Transcripts */}
        {isActive && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Speaker A */}
            <div className="bg-white rounded-xl p-6 shadow-lg">
              <h3 className="font-semibold mb-4 flex items-center">
                Speaker A
                {currentSpeaker === 'A' && (
                  <span className="ml-2 w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                )}
              </h3>
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-gray-500">Original:</p>
                  <p className="text-lg">{transcriptA || '...'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Translation:</p>
                  <p className="text-lg text-blue-600">{translationA || '...'}</p>
                </div>
              </div>
            </div>

            {/* Speaker B */}
            <div className="bg-white rounded-xl p-6 shadow-lg">
              <h3 className="font-semibold mb-4 flex items-center">
                Speaker B
                {currentSpeaker === 'B' && (
                  <span className="ml-2 w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                )}
              </h3>
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-gray-500">Original:</p>
                  <p className="text-lg">{transcriptB || '...'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Translation:</p>
                  <p className="text-lg text-blue-600">{translationB || '...'}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
```

### 5.2 Audio Worklet Processor
**File**: `public/audio-processor.js`

```javascript
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 2048;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const inputChannel = input[0];

    for (let i = 0; i < inputChannel.length; i++) {
      this.buffer[this.bufferIndex++] = inputChannel[i];

      if (this.bufferIndex >= this.bufferSize) {
        // Convert to 16-bit PCM
        const pcmData = new Int16Array(this.bufferSize);
        for (let j = 0; j < this.bufferSize; j++) {
          const sample = Math.max(-1, Math.min(1, this.buffer[j]));
          pcmData[j] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        }

        this.port.postMessage({
          audioData: pcmData.buffer
        });

        this.bufferIndex = 0;
      }
    }

    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
```

## Phase 6: Optimization & Performance

### 6.1 Translation Optimization
- Implement smart buffering for partial transcripts
- Use context caching for repeated phrases
- Batch small transcript chunks for better translation quality

### 6.2 Latency Reduction
- Pre-warm API connections on page load
- Use Cartesia Sonic Turbo for fastest TTS
- Implement audio pre-buffering for smoother playback
- Use WebSocket connections instead of REST where possible

### 6.3 Error Handling
- Implement reconnection logic for WebSocket disconnections
- Add fallback to REST endpoints if WebSocket fails
- Show user-friendly error messages
- Implement retry logic with exponential backoff

## Phase 7: Testing & Deployment

### 7.1 Testing Checklist
- [ ] Test with all supported language pairs
- [ ] Verify sub-500ms latency target
- [ ] Test WebSocket reconnection
- [ ] Test audio quality in different environments
- [ ] Test browser compatibility (Chrome, Firefox, Safari)
- [ ] Test mobile responsiveness

### 7.2 Performance Metrics
- Measure STT latency (AssemblyAI partial transcripts)
- Measure translation latency (Gemini API)
- Measure TTS first-byte latency (Cartesia)
- Monitor total round-trip time

### 7.3 Deployment
- Deploy to Vercel/Netlify with environment variables
- Enable CORS for API routes
- Set up monitoring and error tracking
- Implement usage analytics

## Key Implementation Notes

1. **Why No LiveKit**: Direct API connections provide lower latency and simpler architecture for this use case. LiveKit adds unnecessary complexity for 1-to-1 translation.

2. **Latency Targets**:
   - AssemblyAI STT: ~300ms partial transcripts
   - Gemini Translation: ~100-200ms
   - Cartesia TTS: 40-90ms first byte
   - Total: ~440-590ms round-trip

3. **Critical Success Factors**:
   - Proper audio buffering and streaming
   - Smart transcript chunking for translation
   - WebSocket connection management
   - Efficient audio playback queue

4. **Future Enhancements**:
   - Add voice activity detection
   - Implement conversation history
   - Add custom vocabulary support
   - Support for multiple speakers
   - Add recording functionality