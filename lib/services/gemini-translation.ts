/**
 * Gemini Translation Service
 *
 * This service handles real-time text translation using Google's Gemini 2.5 Flash model
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

export class GeminiTranslationService {
  private genAI: GoogleGenerativeAI | null = null;
  private model: any = null;
  private translationCache = new Map<string, string>();

  constructor() {
    // Initialize only if we have an API key
    const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
      this.model = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: {
          temperature: 0.1, // Low temperature for consistent translations
          topK: 1,
          topP: 0.1,
          maxOutputTokens: 1024,
        }
      });
    }
  }

  /**
   * Translate text from source language to target language
   *
   * @param text - Text to translate
   * @param sourceLang - Source language code (e.g., 'en', 'es')
   * @param targetLang - Target language code
   * @param onPartialResult - Optional callback for streaming partial results
   */
  async translateStream(
    text: string,
    sourceLang: string,
    targetLang: string,
    onPartialResult?: (translation: string) => void
  ): Promise<string> {
    if (!this.model) {
      throw new Error('Gemini API not initialized');
    }

    // Skip translation if languages are the same
    if (sourceLang === targetLang) {
      return text;
    }

    // Check cache first
    const cacheKey = `${sourceLang}-${targetLang}-${text}`;
    if (this.translationCache.has(cacheKey)) {
      const cached = this.translationCache.get(cacheKey)!;
      if (onPartialResult) {
        onPartialResult(cached);
      }
      return cached;
    }

    try {
      const prompt = `Translate the following text from ${sourceLang} to ${targetLang}.
      Provide only the translation without any explanations or additional text.
      Preserve the tone and meaning as accurately as possible.

      Text: ${text}`;

      const result = await this.model.generateContent(prompt);

      const translation = result.response.text().trim();

      // Cache the result
      this.translationCache.set(cacheKey, translation);

      // Clear old cache entries if too many
      if (this.translationCache.size > 100) {
        const firstKey = this.translationCache.keys().next().value;
        this.translationCache.delete(firstKey);
      }

      if (onPartialResult) {
        onPartialResult(translation);
      }

      return translation;
    } catch (error) {
      console.error('Translation error:', error);

      // Retry once on error
      try {
        await new Promise(resolve => setTimeout(resolve, 500));

        const result = await this.model.generateContent(
          `Translate: "${text}" from ${sourceLang} to ${targetLang}`
        );

        const translation = result.response.text().trim();
        this.translationCache.set(cacheKey, translation);

        if (onPartialResult) {
          onPartialResult(translation);
        }

        return translation;
      } catch (retryError) {
        console.error('Translation retry failed:', retryError);
        throw retryError;
      }
    }
  }

  /**
   * Clear the translation cache
   */
  clearCache(): void {
    this.translationCache.clear();
  }
}