/**
 * useTranslation Hook
 *
 * This hook orchestrates the real-time translation flow between:
 * - AssemblyAI for speech-to-text
 * - Gemini for translation
 * - Cartesia for text-to-speech
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AssemblyAIStreamingService } from '@/lib/services/assemblyai-streaming';
import { GeminiTranslationService } from '@/lib/services/gemini-translation';
import { CartesiaTTSService } from '@/lib/services/cartesia-tts';
import { AudioProcessor } from '@/lib/services/audio-processor';

interface TranslationState {
  isActive: boolean;
  isLoading: boolean;
  error: string | null;
  transcript: string;
  translation: string;
  isConnecting: boolean;
}

export const useTranslation = () => {
  const [state, setState] = useState<TranslationState>({
    isActive: false,
    isLoading: false,
    error: null,
    transcript: '',
    translation: '',
    isConnecting: false,
  });

  // Services
  const assemblyAIRef = useRef<AssemblyAIStreamingService | null>(null);
  const geminiRef = useRef<GeminiTranslationService | null>(null);
  const cartesiaRef = useRef<CartesiaTTSService | null>(null);
  const audioProcessorRef = useRef<AudioProcessor | null>(null);

  // Metrics
  const [latency, setLatency] = useState<{
    stt: number;
    translation: number;
    tts: number;
    total: number;
  }>({
    stt: 0,
    translation: 0,
    tts: 0,
    total: 0,
  });

  // Initialize services
  useEffect(() => {
    assemblyAIRef.current = new AssemblyAIStreamingService();
    geminiRef.current = new GeminiTranslationService();
    cartesiaRef.current = new CartesiaTTSService();
    audioProcessorRef.current = new AudioProcessor();

    // Cleanup on unmount
    return () => {
      assemblyAIRef.current?.disconnect();
      cartesiaRef.current?.disconnect();
      audioProcessorRef.current?.stopCapture();
    };
  }, []);

  // Start translation
  const start = useCallback(async (
    speakerALang: string,
    speakerBLang: string,
    voiceA: string,
    voiceB: string,
    isSpeakerA: boolean
  ) => {
    try {
      setState(prev => ({ ...prev, isLoading: true, isConnecting: true, error: null }));

      const sourceLang = isSpeakerA ? speakerALang : speakerBLang;
      const targetLang = isSpeakerA ? speakerBLang : speakerALang;
      const voice = isSpeakerA ? voiceB : voiceA; // Use opposite voice

      // Initialize audio processor
      await audioProcessorRef.current?.initializeAudioContext();

      // Start timestamp for latency measurement
      let startTime = 0;
      let sttTime = 0;
      let translationTime = 0;

      // Handle partial transcripts
      const handlePartialTranscript = (text: string) => {
        if (!startTime) startTime = Date.now();
        sttTime = Date.now() - startTime;

        setState(prev => ({
          ...prev,
          transcript: text,
          isConnecting: false
        }));

        // Update latency metrics
        setLatency(prev => ({
          ...prev,
          stt: sttTime
        }));

        // Translate partial transcript
        if (geminiRef.current && text.trim()) {
          geminiRef.current.translateStream(text, sourceLang, targetLang)
            .then(translation => {
              translationTime = Date.now() - startTime - sttTime;

              setState(prev => ({
                ...prev,
                translation
              }));

              // Update latency metrics
              setLatency(prev => ({
                ...prev,
                translation: translationTime
              }));

              // Speak translation
              if (cartesiaRef.current && translation.trim()) {
                cartesiaRef.current.streamText(translation, voice)
                  .then(() => {
                    const ttsTime = Date.now() - startTime - sttTime - translationTime;
                    const totalTime = Date.now() - startTime;

                    // Update latency metrics
                    setLatency({
                      stt: sttTime,
                      translation: translationTime,
                      tts: ttsTime,
                      total: totalTime
                    });
                  })
                  .catch(error => {
                    console.error('TTS error:', error);
                  });
              }
            })
            .catch(error => {
              console.error('Translation error:', error);
            });
        }
      };

      // Handle final transcripts
      const handleFinalTranscript = (text: string) => {
        // Final transcripts are handled the same way as partial for now
        handlePartialTranscript(text);
      };

      // Connect to AssemblyAI
      await assemblyAIRef.current?.connect(
        sourceLang,
        handlePartialTranscript,
        handleFinalTranscript
      );

      // Connect to Cartesia TTS
      await cartesiaRef.current?.connectWebSocket();

      // Start audio capture
      await audioProcessorRef.current?.startCapture((audioData) => {
        assemblyAIRef.current?.sendAudioData(audioData);
      });

      setState(prev => ({
        ...prev,
        isActive: true,
        isLoading: false,
        transcript: '',
        translation: ''
      }));
    } catch (error) {
      console.error('Failed to start translation:', error);
      setState(prev => ({
        ...prev,
        isLoading: false,
        isConnecting: false,
        error: `Failed to start translation: ${error instanceof Error ? error.message : 'Unknown error'}`
      }));
    }
  }, []);

  // Stop translation
  const stop = useCallback(() => {
    try {
      audioProcessorRef.current?.stopCapture();
      assemblyAIRef.current?.disconnect();
      cartesiaRef.current?.disconnect();

      setState(prev => ({
        ...prev,
        isActive: false,
        transcript: '',
        translation: ''
      }));

      // Reset latency metrics
      setLatency({
        stt: 0,
        translation: 0,
        tts: 0,
        total: 0
      });
    } catch (error) {
      console.error('Error stopping translation:', error);
    }
  }, []);

  return {
    ...state,
    start,
    stop,
    latency
  };
};