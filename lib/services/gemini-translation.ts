/**
 * Gemini Translation Service
 *
 * This service handles real-time translation using Google's Gemini 2.5 Flash model.
 * It's optimized for low-latency translation with minimal thinking time.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

export class GeminiTranslationService {
  private genAI: GoogleGenerativeAI;
  private model: any;
  private maxRetries = 2;
  private retryDelay = 300; // ms

  constructor() {
    // Initialize Gemini API client
    const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY || '';
    this.genAI = new GoogleGenerativeAI(apiKey);

    // Configure the model for translation
    this.model = this.genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.1,  // Low temperature for consistent translations
        maxOutputTokens: 256,
      }
    });
  }

  /**
   * Translate text from one language to another
   *
   * @param text - Text to translate
   * @param sourceLang - Source language (e.g., 'en', 'es', 'fr')
   * @param targetLang - Target language (e.g., 'en', 'es', 'fr')
   * @param onTranslation - Callback for translated text
   */
  async translateStream(
    text: string,
    sourceLang: string,
    targetLang: string,
    onTranslation: (translated: string) => void
  ): Promise<void> {
    if (!text.trim()) {
      onTranslation('');
      return;
    }

    // Skip translation if source and target languages are the same
    if (sourceLang === targetLang) {
      onTranslation(text);
      return;
    }

    // Create a prompt optimized for translation
    const prompt = `Translate the following ${sourceLang} text to ${targetLang}.
    Only output the translation, nothing else.
    Keep the tone and style natural for spoken conversation.
    Text: "${text}"`;

    try {
      // Disable thinking for faster response
      const result = await this.translateWithRetry(prompt, 0);

      // Extract the translation from the response
      const translation = result.response.text();
      onTranslation(translation);
    } catch (error) {
      console.error('Translation error:', error);
      // Return original text if translation fails
      onTranslation(text);
    }
  }

  /**
   * Translate with retry logic
   *
   * @param prompt - Translation prompt
   * @param retryCount - Current retry count
   * @returns Translation result
   */
  private async translateWithRetry(prompt: string, retryCount: number) {
    try {
      return await this.model.generateContent({
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
        ],
        // Disable thinking to minimize latency
        thinkingConfig: {
          thinkingBudget: 0, // Disable thinking
        },
      });
    } catch (error) {
      // Retry on network errors or rate limits
      if (retryCount < this.maxRetries) {
        console.log(`Translation retry ${retryCount + 1}/${this.maxRetries}`);
        // Exponential backoff
        const delay = this.retryDelay * Math.pow(2, retryCount);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.translateWithRetry(prompt, retryCount + 1);
      }
      throw error;
    }
  }

  /**
   * Pre-warm the translation service connection
   * This can reduce cold start latency for the first translation
   */
  async preWarm(): Promise<void> {
    try {
      // Make a minimal request to initialize the connection
      await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 10,
        },
        thinkingConfig: {
          thinkingBudget: 0,
        },
      });
      console.log('Translation service pre-warmed');
    } catch (error) {
      console.warn('Failed to pre-warm translation service:', error);
      // Non-critical error, can continue without pre-warming
    }
  }

  /**
   * Stream translation with real-time updates (for future implementation)
   * Note: This would require using generateContentStream instead
   */
  async translateStreamReal(
    text: string,
    sourceLang: string,
    targetLang: string,
    onPartialTranslation: (partial: string) => void,
    onCompleteTranslation: (complete: string) => void
  ): Promise<void> {
    // This is a placeholder for future implementation
    // Would use generateContentStream for streaming responses
    // Currently not implemented as it adds complexity without significant latency benefit
    this.translateStream(text, sourceLang, targetLang, onCompleteTranslation);
  }
}