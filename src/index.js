require('dotenv').config();
process.env.TZ = process.env.APP_TIMEZONE || 'Asia/Bangkok';
const app = require('./app');
require('../scripts/attendance_cron'); // Initialize attendance cron job
const realtimeNotifier = require('./services/realtimeNotifier');

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server is running at http://localhost:${PORT}`);
      console.log('Login is integrated with HOSoffice hr_person (using HR_CID as username).');
      realtimeNotifier.start(5000); // Start real-time notifications (5s interval)
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`❌ Error: Port ${PORT} is already in use!`);
        console.error(`👉 Please kill the running process on port ${PORT} or change PORT in your .env file.`);
        process.exit(1);
      }
      console.error('Server error:', err);
      process.exit(1);
    });
  } catch (err) {
    console.error('Initialization error:', err);
    process.exit(1);
  }
}

startServer();
