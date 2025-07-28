const { Server } = require('ws');
const dotenv = require('dotenv');
const WebSocket = require('ws');

dotenv.config();
const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY;

if (!ASSEMBLYAI_API_KEY) {
  console.error('❌ ASSEMBLYAI_API_KEY missing in environment variables');
}

module.exports = (req, res) => {
  if (req.method === 'GET' && req.headers.upgrade === 'websocket') {
    // This is a WebSocket request
    const wss = new Server({ noServer: true });

    wss.on('connection', (client) => {
      console.log('🔌 Client connected to proxy');

      // Configure AssemblyAI WebSocket parameters
      const params = new URLSearchParams({
        sample_rate: 16000,
        format_turns: true
      });

      // Connect to AssemblyAI
      const upstream = new WebSocket(
        `wss://streaming.assemblyai.com/v3/ws?${params}`,
        { headers: { authorization: ASSEMBLYAI_API_KEY } }
      );

      // Buffer for audio data until upstream connection is ready
      const backlog = [];
      let upstreamReady = false;

      // Handle upstream connection open
      upstream.once('open', () => {
        upstreamReady = true;
        console.log('▲ Upstream open → AssemblyAI');

        // Send any buffered audio data
        if (backlog.length > 0) {
          console.log(`Sending ${backlog.length} buffered messages`);
          backlog.forEach(buf => upstream.send(buf));
          backlog.length = 0;
        }
      });

      // Forward messages from AssemblyAI to client
      upstream.on('message', (data) => {
        try {
          if (client.readyState === WebSocket.OPEN) {
            client.send(data.toString());
          }
        } catch (err) {
          console.error('Error forwarding message to client:', err);
        }
      });

      // Handle upstream connection close
      upstream.on('close', (code, reason) => {
        console.log(`▲ Upstream closed: ${code} ${reason || ''}`);

        // Only close the client if it's still open
        if (client.readyState === WebSocket.OPEN) {
          client.close(code, reason);
        }
      });

      // Handle upstream errors
      upstream.on('error', (error) => {
        console.error('▲ Upstream error:', error);
      });

      // Handle messages from client (audio data)
      client.on('message', (data) => {
        if (upstreamReady) {
          try {
            upstream.send(data);
          } catch (err) {
            console.error('Error sending data to upstream:', err);
            backlog.push(data);
          }
        } else {
          // Buffer the data until connection is ready
          backlog.push(data);
        }
      });

      // Handle client disconnection
      client.on('close', () => {
        console.log('🔌 Client disconnected');

        if (upstream) {
          try {
            upstream.close(1000, 'Client disconnected');
          } catch (err) {
            console.error('Error closing upstream connection:', err);
          }
        }
      });
    });

    // Handle WebSocket upgrade
    wss.handleUpgrade(req, res.socket, Buffer.alloc(0), (client) => {
      wss.emit('connection', client, req);
    });
  } else {
    // For non-WebSocket requests, return a health check
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'ok', message: 'WebSocket proxy server is running' }));
  }
};