/**
 * useTranslation Hook
 *
 * This hook orchestrates the real-time translation flow between:
 * - AssemblyAI for speech-to-text
 * - Gemini for translation
 * - Cartesia for text-to-speech
 */

import { useState, useCallback, useRef, useEffect } from 'react';
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

interface TranslationServices {
  assemblyAI: AssemblyAIStreamingService;
  gemini: GeminiTranslationService;
  cartesia: CartesiaTTSService;
  audioProcessor: AudioProcessor;
}

// Smart buffering configuration
const TRANSLATION_BUFFER_DELAY = 300; // ms
const MIN_TRANSLATION_LENGTH = 5; // characters
const MAX_SILENCE_DURATION = 1500; // ms

export function useTranslation(options: UseTranslationOptions) {
  // Status states
  const [isActive, setIsActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [currentSpeaker, setCurrentSpeaker] = useState<'A' | 'B'>('A');
  const [error, setError] = useState<string | null>(null);
  const [isPreWarmed, setIsPreWarmed] = useState(false);

  // State for transcripts and translations
  const [transcriptA, setTranscriptA] = useState('');
  const [transcriptB, setTranscriptB] = useState('');
  const [translationA, setTranslationA] = useState('');
  const [translationB, setTranslationB] = useState('');

  // Service instances
  const servicesRef = useRef<TranslationServices>({
    assemblyAI: new AssemblyAIStreamingService(),
    gemini: new GeminiTranslationService(),
    cartesia: new CartesiaTTSService(),
    audioProcessor: new AudioProcessor()
  });

  // Translation buffering
  const translationBufferRef = useRef('');
  const translationTimerRef = useRef<NodeJS.Timeout>();
  const lastActivityRef = useRef<number>(Date.now());
  const silenceTimerRef = useRef<NodeJS.Timeout>();
  const isSpeakingRef = useRef<boolean>(false);

  // Pre-warm services when options change
  useEffect(() => {
    // Only pre-warm if we have valid options
    if (options.voiceIdA && options.voiceIdB) {
      preWarmServices();
    }

    // Cleanup function
    return () => {
      if (translationTimerRef.current) {
        clearTimeout(translationTimerRef.current);
      }

      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }

      // Clean up all services
      servicesRef.current.cartesia.cleanup();
    };
  }, [options.voiceIdA, options.voiceIdB, options.speakerALanguage, options.speakerBLanguage]);

  /**
   * Pre-warm all services to reduce initial latency
   */
  const preWarmServices = async () => {
    if (isPreWarmed) return;

    try {
      console.log('Pre-warming services...');

      // Pre-warm services in parallel
      await Promise.all([
        servicesRef.current.assemblyAI.preWarm(),
        servicesRef.current.gemini.preWarm(),
        servicesRef.current.cartesia.preWarm(options.voiceIdA, options.speakerALanguage),
        servicesRef.current.cartesia.preWarm(options.voiceIdB, options.speakerBLanguage)
      ]);

      setIsPreWarmed(true);
      console.log('Services pre-warmed successfully');
    } catch (error) {
      console.warn('Failed to pre-warm services:', error);
      // Non-critical error, can continue without pre-warming
    }
  };

  /**
   * Handle partial transcript from AssemblyAI
   */
  const handlePartialTranscript = useCallback((text: string, speaker: 'A' | 'B') => {
    // Update transcript state
    if (speaker === 'A') {
      setTranscriptA(text);
    } else {
      setTranscriptB(text);
    }

    // Update last activity timestamp
    lastActivityRef.current = Date.now();

    // Set speaking flag
    if (text.trim().length > 0) {
      isSpeakingRef.current = true;

      // Reset silence timer if exists
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }
    }

    // Buffer partial transcripts for better translation chunks
    translationBufferRef.current = text;

    // Debounce translation requests
    clearTimeout(translationTimerRef.current);
    translationTimerRef.current = setTimeout(() => {
      const bufferText = translationBufferRef.current;

      // Only translate if buffer has meaningful content
      if (bufferText.trim().length >= MIN_TRANSLATION_LENGTH) {
        translateAndSpeak(bufferText, speaker);

        // Start silence detection timer
        silenceTimerRef.current = setTimeout(() => {
          if (isSpeakingRef.current) {
            isSpeakingRef.current = false;

            // Final translation after silence
            if (translationBufferRef.current.trim().length > 0) {
              translateAndSpeak(translationBufferRef.current, speaker);
            }
          }
        }, MAX_SILENCE_DURATION);
      }
    }, TRANSLATION_BUFFER_DELAY);
  }, [options]);

  /**
   * Translate text and convert to speech
   */
  const translateAndSpeak = async (text: string, speaker: 'A' | 'B') => {
    if (!text.trim()) return;

    try {
      // Determine source/target languages and voice based on speaker
      const sourceLang = speaker === 'A' ? options.speakerALanguage : options.speakerBLanguage;
      const targetLang = speaker === 'A' ? options.speakerBLanguage : options.speakerALanguage;
      const voiceId = speaker === 'A' ? options.voiceIdB : options.voiceIdA;

      // Translate text
      await servicesRef.current.gemini.translateStream(
        text,
        sourceLang,
        targetLang,
        async (translation) => {
          // Update translation state
          if (speaker === 'A') {
            setTranslationB(translation);
          } else {
            setTranslationA(translation);
          }

          // Convert to speech if we have a valid translation
          if (translation.trim()) {
            await servicesRef.current.cartesia.streamText(translation);
          }
        }
      );
    } catch (error) {
      console.error('Translation error:', error);
      setError('Translation failed. Please try again.');
    }
  };

  /**
   * Start the translation session
   */
  const start = async () => {
    try {
      setIsConnecting(true);
      setError(null);

      // Initialize audio processor
      await servicesRef.current.audioProcessor.startMicrophoneCapture(
        (audioData) => {
          servicesRef.current.assemblyAI.sendAudioData(audioData);
        }
      );

      // Connect AssemblyAI with appropriate language
      await servicesRef.current.assemblyAI.connect(
        currentSpeaker === 'A' ? options.speakerALanguage : options.speakerBLanguage,
        (partial) => handlePartialTranscript(partial, currentSpeaker),
        (final) => handlePartialTranscript(final, currentSpeaker)
      );

      // Connect Cartesia with appropriate voice and language
      await servicesRef.current.cartesia.connectWebSocket(
        currentSpeaker === 'A' ? options.voiceIdB : options.voiceIdA,
        currentSpeaker === 'A' ? options.speakerBLanguage : options.speakerALanguage,
        (audioData) => {
          servicesRef.current.audioProcessor.playAudioBuffer(audioData);
        }
      );

      // Set active state
      setIsActive(true);
      setIsConnecting(false);

      // Reset activity tracking
      lastActivityRef.current = Date.now();
      isSpeakingRef.current = false;
    } catch (error) {
      console.error('Failed to start translation:', error);
      setError('Failed to start translation. Please check your microphone and try again.');
      setIsConnecting(false);

      // Clean up any partial connections
      stop();
    }
  };

  /**
   * Stop the translation session
   */
  const stop = () => {
    // Disconnect all services
    servicesRef.current.assemblyAI.disconnect();
    servicesRef.current.cartesia.disconnect();
    servicesRef.current.audioProcessor.stop();

    // Clear any pending translation timers
    if (translationTimerRef.current) {
      clearTimeout(translationTimerRef.current);
    }

    // Clear silence timer
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }

    // Reset active state
    setIsActive(false);
    isSpeakingRef.current = false;
  };

  /**
   * Switch between speakers
   */
  const switchSpeaker = () => {
    setCurrentSpeaker(current => current === 'A' ? 'B' : 'A');

    // If active, reconnect with new language settings
    if (isActive) {
      stop();
      setTimeout(start, 100);
    }
  };

  /**
   * Clear transcripts and translations
   */
  const clearTranscripts = () => {
    setTranscriptA('');
    setTranscriptB('');
    setTranslationA('');
    setTranslationB('');
    translationBufferRef.current = '';
  };

  return {
    // Status
    isActive,
    isConnecting,
    error,
    currentSpeaker,
    isPreWarmed,

    // Transcripts and translations
    transcriptA,
    transcriptB,
    translationA,
    translationB,

    // Actions
    start,
    stop,
    switchSpeaker,
    clearTranscripts,
    preWarmServices
  };
}