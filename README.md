# LinguaBridge

Real-time cross-language voice translation with ultra-low latency.

## Overview

LinguaBridge is a browser-based voice app that performs live bi-directional speech translation. Users select two languages (Speaker A and Speaker B). When a speaker talks, the app:

1. Transcribes speech with AssemblyAI's Universal-Streaming STT
2. Sends partial transcripts to Google Gemini 2.5 Flash for fast translation
3. Streams the translated output through Cartesia Sonic 2 or Sonic Turbo for ultra-fast TTS playback in the listener's language

All interactions are streamed with sub-300ms latency to enable fluid cross-language voice conversations.

## Setup

### 1. Environment Variables

Create a `.env.local` file in the root directory with the following variables:

```
# AssemblyAI API Keys
# Get your API key from https://www.assemblyai.com/app/account
ASSEMBLYAI_API_KEY=your_assemblyai_key

# Google Gemini API Key
# Get your API key from https://aistudio.google.com/app/apikey
GEMINI_API_KEY=your_gemini_key

# Cartesia API Key
# Get your API key from https://cartesia.ai
CARTESIA_API_KEY=your_cartesia_key
```

### 2. Install Dependencies

```bash
npm install
```

## Running the Application

LinguaBridge requires two processes to run:

### 1. Start the WebSocket Proxy Server

The proxy server handles WebSocket connections to AssemblyAI, avoiding CORS and authentication issues:

```bash
npm run proxy
```

You should see:
```
🚀 Server running at http://localhost:4000
🔌 WebSocket proxy available at ws://localhost:4000
✅ Port 4000 saved to .proxy-port file
```

> **Note**: If port 4000 is already in use, the server will automatically try the next available port. The client will automatically detect which port the server is using.

### 2. Start the Next.js Application

In a new terminal window:

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

## How It Works

1. The WebSocket proxy server handles authentication with AssemblyAI using your API key
2. The browser connects to the local proxy server instead of directly to AssemblyAI
3. Audio from your microphone is sent to AssemblyAI via the proxy
4. Transcription results are sent back to the browser
5. The text is translated using Google Gemini
6. The translated text is converted to speech using Cartesia TTS

## Troubleshooting

- **WebSocket Connection Issues**: Make sure the proxy server is running before starting the application
- **Port Already in Use**: The server will automatically try the next available port if 4000 is in use
- **No Sound**: Check your microphone and speaker permissions in your browser
- **Slow Performance**: Try using a wired internet connection for better latency

## API Keys

- **AssemblyAI**: Sign up at [assemblyai.com](https://www.assemblyai.com/)
- **Google Gemini**: Get API keys from [Google AI Studio](https://aistudio.google.com/)
- **Cartesia**: Sign up at [cartesia.ai](https://cartesia.ai/)

## License

MIT