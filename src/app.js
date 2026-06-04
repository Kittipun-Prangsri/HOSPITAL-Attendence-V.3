const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const authRoutes = require('./routes/authRoutes');
const apiRoutes = require('./routes/apiRoutes');
const viewRoutes = require('./routes/viewRoutes');
const { errorHandler, notFound } = require('./middleware/errorMiddleware');

const app = express();

// Basic Middleware
app.use(cors());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session Configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'khh-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Routes
app.use('/', authRoutes);
app.use('/api', apiRoutes);
app.use('/', viewRoutes);

app.post(['/', '/webhook'], async (req, res) => {
  try {
    console.log('📌 LINE Webhook เข้ามาแล้ว!');
    const events = req.body.events;
    
    // ทดสอบดึงข้อมูลมาดูใน Console ก่อน
    console.log('Data from LINE:', JSON.stringify(events, null, 2));

    if (events && Array.isArray(events)) {
      const notificationService = require('./services/notificationService');
      
      for (const event of events) {
        // If message is text
        if (event.type === 'message' && event.message && event.message.type === 'text') {
          const chatbotService = require('./services/chatbotService');
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
