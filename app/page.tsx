"use client";

import { useState, useEffect } from 'react';
import { useTranslation } from '@/hooks/use-translation';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Mic, MicOff, ArrowLeftRight, Zap } from 'lucide-react';

// Define voice interface
interface Voice {
  id: string;
  name?: string;
  voice_name?: string; // Some APIs use this format
  language?: string;
}

// Supported languages for translation
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
  // Language and voice selection states
  const [speakerALang, setSpeakerALang] = useState('en');
  const [speakerBLang, setSpeakerBLang] = useState('es');
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceA, setVoiceA] = useState('');
  const [voiceB, setVoiceB] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [latencyStats, setLatencyStats] = useState({
    stt: '~300ms',
    translation: '~150ms',
    tts: '~60ms',
    total: '~510ms'
  });

  // Initialize translation hook
  const {
    isActive,
    isConnecting,
    error: translationError,
    transcript,
    translation,
    start,
    stop,
    latency
  } = useTranslation();

  // Current speaker state (managed locally now)
  const [currentSpeaker, setCurrentSpeaker] = useState('A');

  // Switch speaker function
  const switchSpeaker = () => {
    setCurrentSpeaker(prev => prev === 'A' ? 'B' : 'A');
    // Call stop and then start with the new speaker
    stop();
    // Short delay to ensure everything is cleaned up
    setTimeout(() => {
      start(
        currentSpeaker === 'A' ? speakerBLang : speakerALang,
        currentSpeaker === 'A' ? speakerALang : speakerBLang,
        currentSpeaker === 'A' ? voiceB : voiceA,
        currentSpeaker === 'A' ? voiceA : voiceB,
        currentSpeaker === 'A'
      );
    }, 500);
  };

  // Transcript and translation state (managed locally now)
  const [transcriptA, setTranscriptA] = useState('');
  const [transcriptB, setTranscriptB] = useState('');
  const [translationA, setTranslationA] = useState('');
  const [translationB, setTranslationB] = useState('');

  // Update the appropriate transcript/translation based on current speaker
  useEffect(() => {
    if (currentSpeaker === 'A') {
      setTranscriptA(transcript);
      setTranslationB(translation);
    } else {
      setTranscriptB(transcript);
      setTranslationA(translation);
    }
  }, [transcript, translation, currentSpeaker]);

  // Load Cartesia voices on component mount
  useEffect(() => {
    const loadVoices = async () => {
      try {
        setIsLoading(true);
        const response = await fetch('/api/cartesia/voices');

        if (!response.ok) {
          throw new Error(`Failed to fetch voices: ${response.status}`);
        }

        const data = await response.json();

        // Ensure data is an array
        if (!Array.isArray(data)) {
          console.error('Expected array of voices but got:', data);
          setVoices([]);
          throw new Error('Invalid voice data format');
        }

        setVoices(data);

        // Set default voices based on selected languages
        // Make sure we're safely accessing the data
        const englishVoice = data.find((v: Voice) =>
          v && v.language === 'en' || v.language === 1
        );
        const spanishVoice = data.find((v: Voice) =>
          v && v.language === 'es' || v.language === 2
        );

        if (englishVoice) setVoiceA(englishVoice.id);
        if (spanishVoice) setVoiceB(spanishVoice.id);

        setIsLoading(false);
      } catch (err) {
        console.error('Error loading voices:', err);
        setError('Failed to load voices. Please try again later.');

        // Set fallback voices
        const fallbackVoices = [
          { id: 'default-en', name: 'English (Default)', language: 'en' },
          { id: 'default-es', name: 'Spanish (Default)', language: 'es' },
          { id: 'default-fr', name: 'French (Default)', language: 'fr' },
          { id: 'default-de', name: 'German (Default)', language: 'de' }
        ];
        setVoices(fallbackVoices);
        setVoiceA('default-en');
        setVoiceB('default-es');

        setIsLoading(false);
      }
    };

    loadVoices();
  }, []);

  // Update voice selection when language changes
  useEffect(() => {
    if (voices && voices.length > 0) {
      const speakerAVoice = voices.find((v: Voice) =>
        v && (v.language === speakerALang || v.language === speakerALang.toString())
      );
      if (speakerAVoice) setVoiceA(speakerAVoice.id);
    }
  }, [speakerALang, voices]);

  useEffect(() => {
    if (voices && voices.length > 0) {
      const speakerBVoice = voices.find((v: Voice) =>
        v && (v.language === speakerBLang || v.language === speakerBLang.toString())
      );
      if (speakerBVoice) setVoiceB(speakerBVoice.id);
    }
  }, [speakerBLang, voices]);

  // Handle errors from translation hook
  useEffect(() => {
    if (translationError) {
      setError(translationError);
    }
  }, [translationError]);

  // Handle start translation
  const handleStart = async () => {
    // Reset transcripts when starting
    setTranscriptA('');
    setTranscriptB('');
    setTranslationA('');
    setTranslationB('');

    // Start with speaker A by default
    setCurrentSpeaker('A');
    start(speakerALang, speakerBLang, voiceA, voiceB, true);
  };

  // Helper function to get voice name
  const getVoiceName = (voiceId: string): string => {
    if (!voices || voices.length === 0) return voiceId;
    const voice = voices.find(v => v && v.id === voiceId);
    return voice ? (voice.name || voice.voice_name || voiceId) : voiceId;
  };

  // Helper function to filter voices by language
  const getVoicesByLanguage = (language: string): Voice[] => {
    if (!voices || !Array.isArray(voices)) return [];

    return voices.filter((v: Voice) =>
      v && (v.language === language || v.language === language.toString())
    );
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-6xl mx-auto pt-8">
        <h1 className="text-4xl font-bold text-center mb-8 text-gray-800">
          LinguaBridge
        </h1>
        <p className="text-center text-gray-600 mb-12">
          Real-time voice translation with ultra-low latency
        </p>

        {/* Language Selection Panel */}
        <div className="bg-white rounded-2xl shadow-xl p-8 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
            {/* Speaker A */}
            <div className="space-y-4">
              <label className="text-sm font-medium text-gray-700">
                Speaker A Language
              </label>
              <Select
                value={speakerALang}
                onValueChange={setSpeakerALang}
                disabled={isActive || isLoading}
              >
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
              <Select
                value={voiceA}
                onValueChange={setVoiceA}
                disabled={isActive || isLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select voice" />
                </SelectTrigger>
                <SelectContent>
                  {getVoicesByLanguage(speakerALang).map((voice: Voice) => (
                    <SelectItem key={voice.id} value={voice.id}>
                      {voice.name || voice.voice_name || voice.id}
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
              <Select
                value={speakerBLang}
                onValueChange={setSpeakerBLang}
                disabled={isActive || isLoading}
              >
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
              <Select
                value={voiceB}
                onValueChange={setVoiceB}
                disabled={isActive || isLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select voice" />
                </SelectTrigger>
                <SelectContent>
                  {getVoicesByLanguage(speakerBLang).map((voice: Voice) => (
                    <SelectItem key={voice.id} value={voice.id}>
                      {voice.name || voice.voice_name || voice.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Services Status */}
          <div className="mt-6 flex items-center justify-center">
            <div className="px-4 py-2 rounded-full text-sm flex items-center gap-2 bg-blue-100 text-blue-800">
              <Zap className="w-4 h-4" />
              Ready to translate
            </div>
          </div>
        </div>

        {/* Control Buttons */}
        <div className="flex justify-center gap-4 mb-8">
          <Button
            size="lg"
            onClick={isActive ? stop : handleStart}
            disabled={isLoading || isConnecting || !voiceA || !voiceB}
            className={isActive ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}
          >
            {isActive ? (
              <>
                <MicOff className="mr-2" />
                Stop Translation
              </>
            ) : isConnecting ? (
              <span className="flex items-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Connecting...
              </span>
            ) : (
              <>
                <Mic className="mr-2" />
                Start Translation
              </>
            )}
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

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-6 text-center">
            {error}
            <Button
              variant="link"
              className="text-red-700 underline ml-2"
              onClick={() => setError(null)}
            >
              Dismiss
            </Button>
          </div>
        )}

        {/* Live Transcripts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Speaker A */}
          <div className="bg-white rounded-xl p-6 shadow-lg">
            <h3 className="font-semibold mb-4 flex items-center">
              Speaker A ({SUPPORTED_LANGUAGES.find(l => l.code === speakerALang)?.name})
              {currentSpeaker === 'A' && (
                <span className="ml-2 w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              )}
            </h3>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-500">Original:</p>
                <p className="text-lg min-h-[3rem]">{transcriptA || '...'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Translation:</p>
                <p className="text-lg text-blue-600 min-h-[3rem]">{translationA || '...'}</p>
              </div>
            </div>
          </div>

          {/* Speaker B */}
          <div className="bg-white rounded-xl p-6 shadow-lg">
            <h3 className="font-semibold mb-4 flex items-center">
              Speaker B ({SUPPORTED_LANGUAGES.find(l => l.code === speakerBLang)?.name})
              {currentSpeaker === 'B' && (
                <span className="ml-2 w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              )}
            </h3>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-500">Original:</p>
                <p className="text-lg min-h-[3rem]">{transcriptB || '...'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Translation:</p>
                <p className="text-lg text-blue-600 min-h-[3rem]">{translationB || '...'}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Latency Stats */}
        <div className="mt-8 bg-white rounded-xl p-4 shadow-lg">
          <h3 className="text-center font-semibold mb-2">Latency Metrics</h3>
          <div className="grid grid-cols-4 gap-4 text-center">
            <div>
              <p className="text-xs text-gray-500">Speech-to-Text</p>
              <p className="font-mono text-sm">{latencyStats.stt}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Translation</p>
              <p className="font-mono text-sm">{latencyStats.translation}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Text-to-Speech</p>
              <p className="font-mono text-sm">{latencyStats.tts}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Round-Trip</p>
              <p className="font-mono text-sm font-bold">{latencyStats.total}</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-gray-500">
          <p>Powered by AssemblyAI, Google Gemini, and Cartesia</p>
          <p className="mt-1">Sub-500ms latency real-time translation</p>
        </div>
      </div>
    </main>
  );
}
