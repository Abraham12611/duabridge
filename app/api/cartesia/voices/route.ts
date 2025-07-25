import { NextResponse } from 'next/server';

/**
 * GET /api/cartesia/voices
 *
 * Fetches available voices from Cartesia API
 */
export async function GET() {
  const apiKey = process.env.CARTESIA_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ error: 'Cartesia API key not configured' }, { status: 500 });
  }

  try {
    const response = await fetch('https://api.cartesia.ai/voices', {
      headers: {
        'X-API-Key': apiKey,
        'Cartesia-Version': '2024-11-13'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    // Ensure we're returning an array of voices
    // The Cartesia API might return voices in different formats
    // It could be an array directly or nested in an object
    let voices = [];

    if (Array.isArray(data)) {
      voices = data;
    } else if (data && typeof data === 'object') {
      // Check if there's a voices property or similar
      if (Array.isArray(data.voices)) {
        voices = data.voices;
      } else if (Array.isArray(data.data)) {
        voices = data.data;
      } else {
        // If we can't find an array, try to extract voice objects from the response
        const possibleVoices = Object.values(data).filter(
          item => item && typeof item === 'object' && 'id' in item
        );
        if (possibleVoices.length > 0) {
          voices = possibleVoices;
        }
      }
    }

    // Add some default voices if none were found
    if (voices.length === 0) {
      console.warn('No voices found in API response, using fallback voices');
      voices = [
        { id: 'default-en', name: 'English (Default)', language: 'en' },
        { id: 'default-es', name: 'Spanish (Default)', language: 'es' },
        { id: 'default-fr', name: 'French (Default)', language: 'fr' },
        { id: 'default-de', name: 'German (Default)', language: 'de' }
      ];
    }

    // Return the voices with CORS headers
    return NextResponse.json(voices, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  } catch (error) {
    console.error('Error fetching Cartesia voices:', error);
    // Return a fallback array of voices on error
    const fallbackVoices = [
      { id: 'default-en', name: 'English (Default)', language: 'en' },
      { id: 'default-es', name: 'Spanish (Default)', language: 'es' },
      { id: 'default-fr', name: 'French (Default)', language: 'fr' },
      { id: 'default-de', name: 'German (Default)', language: 'de' }
    ];
    return NextResponse.json(fallbackVoices, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }
}

/**
 * OPTIONS /api/cartesia/voices
 *
 * Handle CORS preflight requests
 */
export async function OPTIONS() {
  return NextResponse.json({}, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}