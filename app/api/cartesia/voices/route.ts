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

    const voices = await response.json();

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
    return NextResponse.json({ error: 'Failed to fetch voices' }, { status: 500 });
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