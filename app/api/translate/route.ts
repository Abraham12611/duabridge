import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * POST /api/translate
 *
 * Translates text using Google's Gemini 2.5 Flash model
 *
 * Request body:
 * - text: string - Text to translate
 * - sourceLang: string - Source language code (e.g., 'en', 'es')
 * - targetLang: string - Target language code (e.g., 'en', 'es')
 */
export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ error: 'Gemini API key not configured' }, { status: 500 });
  }

  try {
    // Parse request body
    const { text, sourceLang, targetLang } = await request.json();

    // Validate required parameters
    if (!text) {
      return NextResponse.json({ error: 'Missing required parameter: text' }, { status: 400 });
    }
    if (!sourceLang) {
      return NextResponse.json({ error: 'Missing required parameter: sourceLang' }, { status: 400 });
    }
    if (!targetLang) {
      return NextResponse.json({ error: 'Missing required parameter: targetLang' }, { status: 400 });
    }

    // Initialize Gemini client
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 256,
      }
    });

    // Create translation prompt
    const prompt = `Translate from ${sourceLang} to ${targetLang}: "${text}"
    Output only the translation.`;

    // Generate translation with thinking disabled for speed
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 256,
      },
      // Disable thinking to minimize latency
      thinkingConfig: {
        thinkingBudget: 0, // Disable thinking
      },
    });

    // Extract translation from response
    const translation = result.response.text();

    // Return translation with CORS headers
    return NextResponse.json({ translation }, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  } catch (error) {
    console.error('Translation error:', error);
    return NextResponse.json({ error: 'Translation failed' }, { status: 500 });
  }
}

/**
 * OPTIONS /api/translate
 *
 * Handle CORS preflight requests
 */
export async function OPTIONS() {
  return NextResponse.json({}, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}