import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { language = 'automatic' } = await request.json();
    const apiKey = process.env.ASSEMBLYAI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: 'AssemblyAI API key not configured' }, { status: 500 });
    }

    const response = await fetch('https://api.assemblyai.com/v2/realtime/token', {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expires_in: 3600, // 1 hour expiration
        // Enable Universal model for multilingual support
        language_code: language
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json({ token: data.token });
  } catch (error) {
    console.error('Error generating AssemblyAI token:', error);
    return NextResponse.json({ error: 'Failed to generate token' }, { status: 500 });
  }
}

// Keep GET endpoint for backward compatibility
export async function GET() {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ error: 'AssemblyAI API key not configured' }, { status: 500 });
  }

  try {
    const response = await fetch('https://api.assemblyai.com/v2/realtime/token', {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expires_in: 3600,
        language_code: 'automatic'
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json({ token: data.token });
  } catch (error) {
    console.error('Error generating AssemblyAI token:', error);
    return NextResponse.json({ error: 'Failed to generate token' }, { status: 500 });
  }
}
