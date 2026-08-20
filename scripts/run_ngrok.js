require('dotenv').config();
const { spawn } = require('child_process');
const http = require('http');
const port = process.env.PORT || 3010;

console.log(`Starting ngrok tunnel for port ${port}...`);
const ngrok = spawn('ngrok', ['http', port.toString()], { shell: true });

ngrok.stdout.on('data', (data) => {
  process.stdout.write(data);
});

ngrok.stderr.on('data', (data) => {
  process.stderr.write(data);
});

ngrok.on('close', (code) => {
  console.log(`ngrok process exited with code ${code}`);
});

// Poll ngrok local API (http://127.0.0.1:4040/api/tunnels) to fetch the public HTTPS URL
function fetchTunnelUrl() {
  http.get('http://127.0.0.1:4040/api/tunnels', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (json.tunnels && json.tunnels.length > 0) {
          const httpsTunnel = json.tunnels.find(t => t.proto === 'https') || json.tunnels[0];
          console.log('\n============================================================');
          console.log(`🚀 ngrok Tunnel Online!`);
          console.log(`🔗 Public URL: ${httpsTunnel.public_url}`);
          console.log(`📌 LINE Webhook URL: ${httpsTunnel.public_url}/webhook`);
          console.log('============================================================\n');
        } else {
          setTimeout(fetchTunnelUrl, 2000);
        }
      } catch (e) {
        setTimeout(fetchTunnelUrl, 2000);
      }
    });
  }).on('error', () => {
    setTimeout(fetchTunnelUrl, 2000);
  });
}

setTimeout(fetchTunnelUrl, 2000);
