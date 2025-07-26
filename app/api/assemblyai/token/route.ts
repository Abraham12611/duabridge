import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { language = 'automatic' } = await request.json();
    const apiKey = process.env.ASSEMBLYAI_API_KEY;

    if (!apiKey) {
      console.error('AssemblyAI API key not configured in environment variables');
      return NextResponse.json({ error: 'AssemblyAI API key not configured' }, { status: 500 });
    }

    console.log(`Requesting token for language: ${language}`);

    // Use the correct endpoint for v3 API with required query parameter
    // According to docs: https://www.assemblyai.com/docs/api-reference/streaming-api/generate-streaming-token
    const response = await fetch('https://streaming.assemblyai.com/v3/token?expires_in_seconds=600', {
      method: 'GET', // The correct method is GET, not POST
      headers: {
        'Authorization': apiKey,
      },
      // No body needed for this endpoint
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`AssemblyAI token error (${response.status}):`, errorText);
      return NextResponse.json({
        error: `Failed to generate token: ${response.status}`,
        details: errorText
      }, { status: response.status });
    }

    const data = await response.json();

    if (!data.token) {
      console.error('No token in AssemblyAI response:', data);
      return NextResponse.json({ error: 'Invalid token response from AssemblyAI' }, { status: 500 });
    }

    console.log('Successfully generated AssemblyAI token');
    return NextResponse.json({ token: data.token });
  } catch (error) {
    console.error('Error generating AssemblyAI token:', error);
    return NextResponse.json({
      error: 'Failed to generate token',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}

// Keep GET endpoint for backward compatibility
export async function GET() {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;

  if (!apiKey) {
    console.error('AssemblyAI API key not configured in environment variables');
    return NextResponse.json({ error: 'AssemblyAI API key not configured' }, { status: 500 });
  }

  try {
    // Use the correct endpoint for v3 API with required query parameter
    // Using same expiration time as POST method for consistency
    const response = await fetch('https://streaming.assemblyai.com/v3/token?expires_in_seconds=600', {
      method: 'GET',
      headers: {
        'Authorization': apiKey,
      },
      // No body needed for this endpoint
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`AssemblyAI token error (${response.status}):`, errorText);
      return NextResponse.json({
        error: `Failed to generate token: ${response.status}`,
        details: errorText
      }, { status: response.status });
    }

    const data = await response.json();

    if (!data.token) {
      console.error('No token in AssemblyAI response:', data);
      return NextResponse.json({ error: 'Invalid token response from AssemblyAI' }, { status: 500 });
    }

    console.log('Successfully generated AssemblyAI token');
    return NextResponse.json({ token: data.token });
  } catch (error) {
    console.error('Error generating AssemblyAI token:', error);
    return NextResponse.json({
      error: 'Failed to generate token',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
