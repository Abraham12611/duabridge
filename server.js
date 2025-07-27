const express = require('express');
const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const WebSocket = require('ws');
const cors = require('cors');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

dotenv.config();
const PORT = process.env.PORT || 4001;
const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY;

if (!ASSEMBLYAI_API_KEY) {
  console.error('❌ ASSEMBLYAI_API_KEY missing in .env');
  process.exit(1);
}

// Create Express app
const app = express();
app.use(cors());
app.use(express.json());

// Add a health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Add an endpoint to serve the port number
app.get('/.proxy-port', (req, res) => {
  try {
    if (fs.existsSync(path.join(__dirname, '.proxy-port'))) {
      const port = fs.readFileSync(path.join(__dirname, '.proxy-port'), 'utf8');
      res.setHeader('Content-Type', 'text/plain');
      res.send(port);
    } else {
      res.status(404).send('Port file not found');
    }
  } catch (error) {
    console.error('Error serving port file:', error);
    res.status(500).send('Error reading port file');
  }
});

// Create HTTP server
const server = createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ server });

// Track active connections to limit them
let activeConnections = 0;
const MAX_CONNECTIONS = 2; // Limit to 2 active connections to stay under your rate limit

// Handle WebSocket connections
wss.on('connection', (client) => {
  // Check if we're at the connection limit
  if (activeConnections >= MAX_CONNECTIONS) {
    console.log(`⚠️ Connection limit reached (${activeConnections}/${MAX_CONNECTIONS}). Rejecting new connection.`);
    client.close(1008, 'Too many connections');
    return;
  }

  console.log(`🔌 Client connected (${++activeConnections}/${MAX_CONNECTIONS})`);

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
    console.log(`🔌 Client disconnected (${--activeConnections}/${MAX_CONNECTIONS})`);

    if (upstream) {
      try {
        upstream.close(1000, 'Client disconnected');
      } catch (err) {
        console.error('Error closing upstream connection:', err);
      }
    }
  });
});

// Function to start the server with port fallback
function startServer(port) {
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.log(`⚠️ Port ${port} is in use, trying port ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('❌ Server error:', error);
      process.exit(1);
    }
  });

  server.listen(port, () => {
    const actualPort = server.address().port;
    console.log(`🚀 Server running at http://localhost:${actualPort}`);
    console.log(`🔌 WebSocket proxy available at ws://localhost:${actualPort}`);
    console.log(`⚙️ Connection limit: ${MAX_CONNECTIONS}`);

    // Write the port to a file so the client can read it
    fs.writeFileSync(path.join(__dirname, '.proxy-port'), actualPort.toString());
    console.log(`✅ Port ${actualPort} saved to .proxy-port file`);
  });
}

// Start the server with the initial port
startServer(PORT);