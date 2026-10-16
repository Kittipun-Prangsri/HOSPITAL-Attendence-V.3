const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const helmet = require('helmet');
const MySQLStore = require('express-mysql-session')(session);
const { csrfProtection } = require('./middleware/csrf');
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
// Security headers. Pages still use inline <script> and onclick handlers, so script-src keeps
// 'unsafe-inline'; external sources are limited to the CDNs actually used.
// upgrade-insecure-requests is off because the intranet may be served over plain HTTP.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdn.jsdelivr.net'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      frameSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false,
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'same-origin' },
  hsts: process.env.NODE_ENV === 'production' ? { maxAge: 180 * 24 * 60 * 60 } : false
}));
app.use((req, res, next) => {
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
// Leave requests may carry a base64 medical certificate (≤4 MB file → ~5.4 MB JSON)
app.post('/api/leaves', express.json({ limit: '6mb' }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Session Configuration — persisted in MySQL so restarts/deploys don't sign everyone out.
// SESSION_STORE=memory keeps the old in-memory store for local development without a database.
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const sessionStore = process.env.SESSION_STORE === 'memory' ? undefined : new MySQLStore({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME_HOSPITAL,
  charset: 'utf8mb4_unicode_ci',
  createDatabaseTable: true,
  clearExpired: true,
  checkExpirationInterval: 15 * 60 * 1000,
  expiration: SESSION_TTL_MS,
  schema: { tableName: 'sessions' }
});
if (sessionStore && sessionStore.onReady) {
  sessionStore.onReady().catch(err => console.error('[session] MySQL session store unavailable:', err.message));
}

app.use(session({
  secret: sessionSecret,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS
  }
}));
app.use(csrfProtection);

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
            const cleanText = incomingText.trim();

            // Typing the same label shown on a Flex button should behave like tapping it
            const historyTextMatch = /^(?:ดูประวัติการเข้างาน|ดูประวัติการสแกน|ดูประวัติ|ขอดูการสแกนวันนี้|ขอดูแสกนวันนี้)$/i.test(cleanText);
            const excuseTextMatch = /^(?:ยื่นใบลา\s*\/\s*แจ้งเหตุสาย|ยื่นใบลา|แจ้งเหตุสาย|แจ้งเหตุ|ขอใบลา|ใบลา|แก้ต่าง)$/i.test(cleanText);

            let flexReply = null;
            if (historyTextMatch) {
              flexReply = await chatbotService.handlePostback('action=today_history', lineUserId);
            } else if (excuseTextMatch) {
              flexReply = await chatbotService.handlePostback('action=excuse', lineUserId);
            }

            if (flexReply) {
              await notificationService.replyLineMessage(event.replyToken, flexReply);
            } else {
              // Check if message matches chatbot commands
              let replyText = await chatbotService.handleMessage(incomingText, lineUserId);

              // Fallback to default message showing LINE ID if no command matched
              if (!replyText) {
                replyText = `LINE User ID ของคุณคือ:\n${lineUserId}\n\n` +
                            `คัดลอกไอดีด้านบนเพื่อนำไปวางในช่อง 'LINE ID' ในฟอร์มลงทะเบียนพนักงานเพื่อรับข้อความแจ้งเตือนครับ`;
              }

              await notificationService.replyLineMessage(event.replyToken, replyText);
            }
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
