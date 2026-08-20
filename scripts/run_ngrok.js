require('dotenv').config();
const { spawn } = require('child_process');
const port = process.env.PORT || 3002;

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
