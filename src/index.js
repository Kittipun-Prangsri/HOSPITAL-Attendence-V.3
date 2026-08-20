require('dotenv').config();
process.env.TZ = process.env.APP_TIMEZONE || 'Asia/Bangkok';
const app = require('./app');
require('../scripts/attendance_cron'); // Initialize attendance cron job
const realtimeNotifier = require('./services/realtimeNotifier');

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server is running at http://localhost:${PORT}`);
      console.log('Login is integrated with HOSoffice hr_person (using HR_CID as username).');
      realtimeNotifier.start(5000); // Start real-time notifications (5s interval)
    });
  } catch (err) {
    console.error('Initialization error:', err);
    process.exit(1);
  }
}

startServer();
