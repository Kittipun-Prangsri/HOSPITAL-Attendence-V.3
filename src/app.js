const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const authRoutes = require('./routes/authRoutes');
const apiRoutes = require('./routes/apiRoutes');
const viewRoutes = require('./routes/viewRoutes');
const { errorHandler, notFound } = require('./middleware/errorMiddleware');

const app = express();
const sessionSecret = process.env.SESSION_SECRET;
const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map(origin => origin.trim()).filter(Boolean);

if (!sessionSecret) {
  throw new Error('SESSION_SECRET must be configured before starting the server');
}

// Basic Middleware
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(null, false);
  },
  credentials: true
}));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Session Configuration
app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

const chatbotService = require('./services/chatbotService');
const notificationService = require('./services/notificationService');

// LINE Webhook Route (Highest Priority)
app.post(['/', '/webhook'], async (req, res) => {
  try {
    console.log('📌 LINE Webhook เข้ามาแล้ว!');
    const events = req.body.events;
    
    // Log incoming LINE event data
    console.log('Data from LINE:', JSON.stringify(events, null, 2));

    if (events && Array.isArray(events)) {
      for (const event of events) {
        try {
          // If message is text
          if (event.type === 'message' && event.message && event.message.type === 'text') {
            const incomingText = event.message.text;
            const lineUserId = event.source.userId;

            // Check if message matches chatbot commands
            let replyText = await chatbotService.handleMessage(incomingText, lineUserId);

            // Fallback to default message showing LINE ID if no command matched
            if (!replyText) {
              replyText = `LINE User ID ของคุณคือ:\n${lineUserId}\n\n` +
                          `คัดลอกไอดีด้านบนเพื่อนำไปวางในช่อง 'LINE ID' ในฟอร์มลงทะเบียนพนักงานเพื่อรับข้อความแจ้งเตือนครับ`;
            }
            
            await notificationService.replyLineMessage(event.replyToken, replyText);
          } else if (event.type === 'postback' && event.postback && event.postback.data) {
            const lineUserId = event.source.userId;
            const replyText = await chatbotService.handlePostback(event.postback.data, lineUserId);

            if (replyText) {
              await notificationService.replyLineMessage(event.replyToken, replyText);
            }
          } else if (event.type === 'follow') {
            const replyText = `สวัสดีครับ ยินดีต้อนรับสู่ระบบบันทึกเวลาปฏิบัติงาน KHH Attendance\n\n` +
                              `LINE User ID ของคุณคือ:\n${event.source.userId}\n\n` +
                              `คัดลอกไอดีด้านบนเพื่อนำไปวางในช่อง 'LINE ID' ในฟอร์มลงทะเบียนพนักงานเพื่อรับข้อความแจ้งเตือนครับ`;
            
            await notificationService.replyLineMessage(event.replyToken, replyText);
          }
        } catch (eventErr) {
          console.error(`[Webhook Event Processing Error]:`, eventErr);
        }
      }
    }

    // ตอบกลับ LINE ทันทีเพื่อให้ขึ้นสถานะ Success (200)
    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook Error:', error);
    res.status(500).send(error.message);
  }
});

// Routes
app.use('/', authRoutes);
app.use('/api', apiRoutes);
app.use('/', viewRoutes);

// Error Handling
app.use(notFound);
app.use(errorHandler);

module.exports = app;
