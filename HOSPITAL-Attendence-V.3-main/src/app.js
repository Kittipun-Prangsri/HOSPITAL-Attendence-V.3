const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const authRoutes = require('./routes/authRoutes');
const apiRoutes = require('./routes/apiRoutes');
const viewRoutes = require('./routes/viewRoutes');
const { errorHandler, notFound } = require('./middleware/errorMiddleware');

const app = express();
const isProduction = process.env.NODE_ENV === 'production';

// A guessable, hardcoded fallback would let anyone forge session cookies.
// Generate a random one instead so a missing SESSION_SECRET fails safe
// (sessions just won't survive a restart) rather than being exploitable.
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  sessionSecret = crypto.randomBytes(32).toString('hex');
  console.warn('[app] SESSION_SECRET is not set — using a random secret for this run. ' +
    'Set SESSION_SECRET in .env before deploying to production, or every restart invalidates all sessions.');
}

// Basic Middleware
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);
if (allowedOrigins.length > 0) {
  app.use(cors({ origin: allowedOrigins, credentials: true }));
}
// If ALLOWED_ORIGINS is unset, cors() is skipped entirely: the app is
// server-rendered and same-origin, so no cross-origin API access is needed
// by default. Set ALLOWED_ORIGINS to a comma-separated list only if an
// external client must call the API directly.

if (isProduction) app.set('trust proxy', 1);

app.use(express.static(path.join(__dirname, '..', 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true }));

// Session Configuration
app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    secure: isProduction,
    sameSite: 'lax'
  }
}));

// Routes
app.use('/', authRoutes);
app.use('/api', apiRoutes);
app.use('/', viewRoutes);

function isValidLineSignature(req) {
  const signature = req.headers['x-line-signature'];
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  if (!signature || !channelSecret || !req.rawBody) return false;
  const expected = crypto.createHmac('SHA256', channelSecret).update(req.rawBody).digest('base64');
  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  return expectedBuf.length === signatureBuf.length && crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

app.post(['/', '/webhook'], async (req, res) => {
  try {
    if (!isValidLineSignature(req)) {
      console.warn('[LINE webhook] Rejected request with invalid or missing x-line-signature');
      return res.sendStatus(401);
    }

    console.log('📌 LINE Webhook เข้ามาแล้ว!');
    const events = req.body.events;
    
    // ทดสอบดึงข้อมูลมาดูใน Console ก่อน
    console.log('Data from LINE:', JSON.stringify(events, null, 2));

    if (events && Array.isArray(events)) {
      const notificationService = require('./services/notificationService');
      
      for (const event of events) {
        // If message is text
        if (event.type === 'message' && event.message && event.message.type === 'text') {
          const replyText = `LINE User ID ของคุณคือ:\n${event.source.userId}\n\n` +
                            `คัดลอกไอดีด้านบนเพื่อนำไปวางในช่อง 'LINE ID' ในฟอร์มลงทะเบียนพนักงานเพื่อรับข้อความแจ้งเตือนครับ`;
          
          await notificationService.replyLineMessage(event.replyToken, replyText);
        } else if (event.type === 'follow') {
          const replyText = `สวัสดีครับ ยินดีต้อนรับสู่ระบบบันทึกเวลาปฏิบัติงาน KHH Attendance\n\n` +
                            `LINE User ID ของคุณคือ:\n${event.source.userId}\n\n` +
                            `คัดลอกไอดีด้านบนเพื่อนำไปวางในช่อง 'LINE ID' ในฟอร์มลงทะเบียนพนักงานเพื่อรับข้อความแจ้งเตือนครับ`;
          
          await notificationService.replyLineMessage(event.replyToken, replyText);
        }
      }
    }

    // 2. ตอบกลับ LINE ทันทีเพื่อให้ขึ้นสถานะ Success (200)
    res.sendStatus(200);
    
  } catch (error) {
    console.error('Webhook Error:', error);
    // หากพังใน try จะหลุดมาที่นี่
    res.status(500).send(error.message);
  }
});

// Error Handling
app.use(notFound);
app.use(errorHandler);

module.exports = app;
