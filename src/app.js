const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const helmet = require('helmet');
const MySQLStore = require('express-mysql-session')(session);
const { forceUtf8mb4 } = require('./config/db');
const { captureRawBody, verifyLineSignature } = require('./middleware/lineSignature');
const { csrfProtection } = require('./middleware/csrf');
const healthController = require('./controllers/healthController');
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
// Behind ngrok / nginx the app sees plain HTTP; trusting one proxy hop lets Express read
// X-Forwarded-Proto/For so secure cookies, req.ip (rate limit, audit) and HTTPS detection work.
// TRUST_PROXY=0 disables this when the app is exposed directly with no proxy in front.
app.set('trust proxy', process.env.TRUST_PROXY === undefined ? 1 : (Number(process.env.TRUST_PROXY) || false));
// Security headers. Pages still use inline <script> and onclick handlers, so script-src keeps
// 'unsafe-inline'; external sources are limited to the CDNs actually used.
// upgrade-insecure-requests is off because the intranet may be served over plain HTTP.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      // LIFF SDK (mobile face scan) is served from LINE's CDN; tfjs may compile WASM in the browser
      scriptSrc: ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", 'https://cdnjs.cloudflare.com', 'https://static.line-scdn.net'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdn.jsdelivr.net'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'https://*.line.me', 'https://*.line-scdn.net'],
      mediaSrc: ["'self'", 'blob:'],
      workerSrc: ["'self'", 'blob:'],
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
  // Camera and location only on the mobile face-scan pages (/m/*); every other page keeps them off
  res.setHeader('Permissions-Policy', req.path.startsWith('/m/')
    ? 'camera=(self), microphone=(), geolocation=(self)'
    : 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(null, false);
  },
  credentials: true
}));
// Cache-busting for our own CSS/JS: the proxy in front of the site tells phones to keep static files for
// hours, so a deploy would otherwise show new pages with old styles. asset('/css/erp.css') →
// '/css/erp.css?v=<content hash>' changes only when the file does.
{
  const crypto = require('crypto');
  const fs = require('fs');
  const versions = new Map();
  app.locals.asset = urlPath => {
    if (!versions.has(urlPath)) {
      let v = '';
      try { v = crypto.createHash('sha1').update(fs.readFileSync(path.join(__dirname, '..', 'public', urlPath))).digest('hex').slice(0, 10); } catch (e) { /* missing file: plain url */ }
      versions.set(urlPath, v);
    }
    const v = versions.get(urlPath);
    return v ? `${urlPath}?v=${v}` : urlPath;
  };
}
app.use(express.static(path.join(__dirname, '..', 'public')));
// Face library + models for the browser, from the same pinned npm package the server uses
{
  const humanDir = path.resolve(path.dirname(require.resolve('@vladmandic/human')), '..');
  app.get('/vendor/human/human.esm.js', (req, res) => res.sendFile(path.join(humanDir, 'dist', 'human.esm.js'), { maxAge: '7d' }));
  app.use('/vendor/human/models', express.static(path.join(humanDir, 'models'), { maxAge: '7d', fallthrough: false }));
  app.use('/vendor/tfjs-wasm', express.static(path.join(path.dirname(require.resolve('@tensorflow/tfjs-backend-wasm/package.json')), 'dist'), { maxAge: '7d', fallthrough: false }));
}
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
// Leave requests may carry a base64 medical certificate (≤4 MB file → ~5.4 MB JSON)
app.post('/api/leaves', express.json({ limit: '6mb' }));
// Face photos (≤ 2 MB JPEG as base64)
app.post('/api/face/enroll', express.json({ limit: '3mb' }));
app.post('/api/face/scan', express.json({ limit: '6mb' }));
app.use(express.json({ limit: '100kb', verify: captureRawBody }));
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

// Exposed so tests (and graceful shutdown) can close the store's connection pool
app.locals.sessionStore = sessionStore;
// The store builds its own mysql2 pool; it needs the same SET NAMES fix or the Thai fullname inside
// each session gets re-encoded on every save and grows into garbage.
if (sessionStore && sessionStore.connection) forceUtf8mb4(sessionStore.connection);

app.use(session({
  secret: sessionSecret,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    // 'auto' = Secure flag only on HTTPS requests. A hard `true` broke login over LAN HTTP and
    // behind ngrok (which forwards plain HTTP), because express-session then never sets the cookie.
    secure: 'auto',
    maxAge: SESSION_TTL_MS
  }
}));
app.use(csrfProtection);

const chatbotService = require('./services/chatbotService');
const notificationService = require('./services/notificationService');

// Buttons under every bot reply. Each one is a postback answered with a reply message, which LINE does
// not count against the monthly push quota, so the scan card stays available on the free plan.
// Labels ≤ 20 characters (LINE limit); links appear only when LIFF_ID / SYSTEM_URL are configured.
function lineQuickReply() {
  const pb = (label, data, displayText) => ({ type: 'action', action: { type: 'postback', label, data, displayText } });
  const uri = (label, url) => ({ type: 'action', action: { type: 'uri', label, uri: url } });
  const liffId = (process.env.LIFF_ID || '').trim();
  const base = (process.env.SYSTEM_URL || '').trim().replace(/\/+$/, '');
  const items = [
    liffId && uri('📸 สแกนใบหน้า', `https://liff.line.me/${liffId}`),
    liffId && uri('📅 เดือนนี้ของฉัน', `https://liff.line.me/${liffId}?tab=month`),
    pb('📇 สแกนล่าสุด', 'action=latest_scan', 'สแกนล่าสุด'),
    pb('📋 ประวัติวันนี้', 'action=today_history', 'ดูประวัติการเข้างาน'),
    pb('🏖️ สิทธิ์ลาคงเหลือ', 'action=leave_balance', 'สิทธิ์ลาคงเหลือ'),
    pb('📝 ยื่นใบลา', 'action=excuse', 'ยื่นใบลา'),
    base.startsWith('http') && uri('🗓️ ตารางเวร', `${base}/schedule`),
    { type: 'action', action: { type: 'message', label: '🔑 ขอไอดี', text: 'ขอไอดี' } }
  ].filter(Boolean);
  return { items };
}

// LINE Webhook Route (Highest Priority)
app.post(['/', '/webhook'], verifyLineSignature, async (req, res) => {
  try {
    const events = req.body.events;
    // Event types only: message text and user ids are personal data and don't belong in PM2 logs
    if (Array.isArray(events) && events.length) console.log(`[LINE] webhook: ${events.map(e => e.type).join(', ')}`);

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
            const balanceTextMatch = /^(?:สิทธิ์ลาคงเหลือ|สิทธิ์ลา|สิทธิลา|วันลาคงเหลือ|วันลาเหลือ|เหลือวันลา)$/i.test(cleanText);
            const latestTextMatch = /^(?:สแกนล่าสุด|แสกนล่าสุด|ล่าสุด|การ์ด|การ์ดสแกน|latest)$/i.test(cleanText);
            const excuseTextMatch = /^(?:ยื่นใบลา\s*\/\s*แจ้งเหตุสาย|ยื่นใบลา|แจ้งเหตุสาย|แจ้งเหตุ|ขอใบลา|ใบลา|แก้ต่าง)$/i.test(cleanText);

            let flexReply = null;
            if (balanceTextMatch) {
              flexReply = await chatbotService.handlePostback('action=leave_balance', lineUserId);
            } else if (latestTextMatch) {
              flexReply = await chatbotService.handlePostback('action=latest_scan', lineUserId);
            } else if (historyTextMatch) {
              flexReply = await chatbotService.handlePostback('action=today_history', lineUserId);
            } else if (excuseTextMatch) {
              flexReply = await chatbotService.handlePostback('action=excuse', lineUserId);
            }

            if (flexReply) {
              await notificationService.replyLineMessage(event.replyToken, flexReply, lineQuickReply());
            } else {
              // Check if message matches chatbot commands
              let replyText = await chatbotService.handleMessage(incomingText, lineUserId);

              // Fallback to default message showing LINE ID if no command matched
              if (!replyText) {
                replyText = `LINE User ID ของคุณคือ:\n${lineUserId}\n\n` +
                            `คัดลอกไอดีด้านบนเพื่อนำไปวางในช่อง 'LINE ID' ในฟอร์มลงทะเบียนพนักงานเพื่อรับข้อความแจ้งเตือนครับ`;
              }

              await notificationService.replyLineMessage(event.replyToken, replyText, lineQuickReply());
            }
          } else if (event.type === 'postback' && event.postback && event.postback.data) {
            const lineUserId = event.source.userId;
            const replyText = await chatbotService.handlePostback(event.postback.data, lineUserId);

            if (replyText) {
              await notificationService.replyLineMessage(event.replyToken, replyText, lineQuickReply());
            }
          } else if (event.type === 'follow') {
            const replyText = `สวัสดีครับ ยินดีต้อนรับสู่ระบบบันทึกเวลาปฏิบัติงาน KHH Attendance\n\n` +
                              `LINE User ID ของคุณคือ:\n${event.source.userId}\n\n` +
                              `คัดลอกไอดีด้านบนเพื่อนำไปวางในช่อง 'LINE ID' ในฟอร์มลงทะเบียนพนักงานเพื่อรับข้อความแจ้งเตือนครับ`;
            
            await notificationService.replyLineMessage(event.replyToken, replyText, lineQuickReply());
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

// Health probe for PM2 / uptime monitors (no auth, no internal details)
app.get('/health', healthController.health);

// Routes
app.use('/', authRoutes);
app.use('/api', apiRoutes);
app.use('/', viewRoutes);

// Error Handling
app.use(notFound);
app.use(errorHandler);

module.exports = app;
