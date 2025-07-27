import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // Try to fetch the port from the proxy server
    const proxyPort = process.env.PORT || 4001; // Default to 4001 as in server.js

    // Try the default port first, then try a few others if that fails
    const ports = [proxyPort, 4001];

    for (const port of ports) {
      try {
        const response = await fetch(`http://localhost:${port}/.proxy-port`, {
          cache: 'no-store',
          next: { revalidate: 0 }
        });

        if (response.ok) {
          const portText = await response.text();
          return new NextResponse(portText, {
            status: 200,
            headers: {
              'Content-Type': 'text/plain',
              'Cache-Control': 'no-cache, no-store, must-revalidate'
            }
          });
        }
      } catch (e) {
        // Try next port
        console.log(`Port ${port} not responding, trying next...`);
      }
    }

    // If we couldn't find a working port, return the default
    return new NextResponse(proxyPort.toString(), {
      status: 200,
      headers: {
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
  } catch (error) {
    console.error('Error fetching proxy port:', error);
    return new NextResponse('4001', { // Default fallback
      status: 200,
      headers: {
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
  }
}