import { NextResponse } from 'next/server';

/**
 * POST /api/cartesia/token
 *
 * Generates a short-lived access token for Cartesia API client authentication
 * This allows us to avoid exposing the API key to the client
 */
export async function POST(request: Request) {
  try {
    const apiKey = process.env.CARTESIA_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: 'Cartesia API key not configured' }, { status: 500 });
    }

    // Generate a short-lived access token (1 hour max)
    const response = await fetch('https://api.cartesia.ai/access-token', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Cartesia-Version': '2025-04-16',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        grants: {
          tts: true  // Only grant TTS access
        },
        expires_in: 600  // 10 minutes (in seconds)
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Cartesia token error (${response.status}):`, errorText);
      return NextResponse.json({
        error: `Failed to generate token: ${response.status}`,
        details: errorText
      }, { status: response.status });
    }

    const data = await response.json();

    if (!data.token) {
      console.error('No token in Cartesia response:', data);
      return NextResponse.json({ error: 'Invalid token response from Cartesia' }, { status: 500 });
    }

    console.log('Successfully generated Cartesia access token');
    return NextResponse.json({ token: data.token });
  } catch (error) {
    console.error('Error generating Cartesia token:', error);
    return NextResponse.json({
      error: 'Failed to generate token',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}

/**
 * OPTIONS /api/cartesia/token
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