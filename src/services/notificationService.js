const TelegramBot = require('node-telegram-bot-api');
const line = require('@line/bot-sdk');
const fs = require('fs');
const path = require('path');
const { pool, hosofficePool } = require('../config/db');
require('dotenv').config();

// LINE Config
const lineClient = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
});

// Telegram Config
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const isTelegramConfigured = botToken && botToken !== 'dummy_token';
const telegramBot = new TelegramBot(botToken || 'dummy_token', isTelegramConfigured ? { polling: true } : {});

if (isTelegramConfigured) {
  telegramBot.on('message', async (msg) => {
    try {
      const chatId = msg.chat.id;
      const text = msg.text;
      if (!text) return;

      // Import inside to prevent circular dependency
      const chatbotService = require('./chatbotService');
      const replyText = await chatbotService.handleMessage(text, chatId.toString());
      if (replyText) {
        if (replyText.length <= 4000) {
          await telegramBot.sendMessage(chatId, replyText, { parse_mode: 'Markdown' });
        } else {
          // Split message by lines to fit within Telegram's 4096 character limit
          const lines = replyText.split('\n');
          let chunk = '';
          for (const line of lines) {
            if (chunk.length + line.length + 1 > 4000) {
              if (chunk) await telegramBot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
              chunk = line;
            } else {
              chunk = chunk ? chunk + '\n' + line : line;
            }
          }
          if (chunk) await telegramBot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
        }
      }
    } catch (err) {
      console.error('[TelegramBot] Error handling message:', err.message);
    }
  });

  telegramBot.on('callback_query', async (callbackQuery) => {
    try {
      const message = callbackQuery.message;
      const data = callbackQuery.data;
      const user = callbackQuery.from;
      const username = user.username ? `@${user.username}` : `${user.first_name || ''} ${user.last_name || ''}`.trim();

      if (data && data.startsWith('confirm_job_')) {
        const jobId = data.replace('confirm_job_', '');

        // 1. Answer callback query to acknowledge click in Telegram UI
        await telegramBot.answerCallbackQuery(callbackQuery.id, {
          text: 'รับทราบงานแล้ว'
        });

        // 2. Edit the message to show confirmation status
        const originalText = message.text || '';
        const updatedText = `${originalText}\n\n✅ *รับทราบแล้วโดย:* ${username}`;

        await telegramBot.editMessageText(updatedText, {
          chat_id: message.chat.id,
          message_id: message.message_id,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: []
          }
        });

        console.log(`[TelegramBot] Job ${jobId} confirmed by user ${username}`);
      }
    } catch (err) {
      console.error('[TelegramBot] Error handling callback query:', err.message);
    }
  });

  console.log('[TelegramBot] Polling listener initialized successfully.');
}

// Mapping path
const MAPPING_PATH = path.join(__dirname, '../../data/notification_mappings.json');

class NotificationService {
  /**
   * Send message to Admin on both platforms
   */
  async sendToAdmin(message) {
    try {
      // Send to Telegram Admin
      if (process.env.TELEGRAM_ADMIN_CHAT_ID) {
        await telegramBot.sendMessage(process.env.TELEGRAM_ADMIN_CHAT_ID, message);
      }

      // Send to LINE Admin
      if (process.env.LINE_ADMIN_USER_ID && process.env.LINE_CHANNEL_ACCESS_TOKEN) {
        await lineClient.pushMessage({
          to: process.env.LINE_ADMIN_USER_ID,
          messages: [{
            type: 'text',
            text: message,
          }]
        });
      }
      
      console.log('Notification sent to admin successfully.');
    } catch (error) {
      console.error('Error sending notification to admin:', error.message);
    }
  }

  /**
   * Send message to specific user based on mapping
   */
  async sendPrivate(userId, message) {
    try {
      let lineUserId = null;
      let telegramChatId = null;

      // Query the database hr_person table directly
      const [rows] = await hosofficePool.query(
        'SELECT LINE_YOUR_USER_ID as line_user_id, TELEGRAM_CHAT_ID as telegram_chat_id FROM hr_person WHERE ID = ? OR HR_CID = ?',
        [userId, userId]
      );
      if (rows && rows.length > 0) {
        lineUserId = rows[0].line_user_id;
        if (rows[0].telegram_chat_id) {
          telegramChatId = rows[0].telegram_chat_id;
        }
      }

      // Send to Telegram if chat_id exists
      if (telegramChatId && process.env.TELEGRAM_BOT_TOKEN) {
        await telegramBot.sendMessage(telegramChatId, message);
      }

      // Send to LINE if user_id exists
      if (lineUserId && process.env.LINE_CHANNEL_ACCESS_TOKEN) {
        await lineClient.pushMessage({
          to: lineUserId,
          messages: [{
            type: 'text',
            text: message,
          }]
        });
      }

      console.log(`Private notification sent to user ${userId} successfully.`);
    } catch (error) {
      console.error(`Error sending private notification to user ${userId}:`, error.message);
    }
  }

  /**
   * Send message directly to a LINE user ID
   */
  async sendDirectLine(lineUserId, message) {
    try {
      if (lineUserId && process.env.LINE_CHANNEL_ACCESS_TOKEN) {
        await lineClient.pushMessage({
          to: lineUserId,
          messages: [{
            type: 'text',
            text: message,
          }]
        });
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error sending direct LINE message:', error.message);
      return false;
    }
  }

  /**
   * Send message directly to a Telegram chat ID
   */
  async sendDirectTelegram(telegramChatId, message, options = {}) {
    try {
      if (telegramChatId && process.env.TELEGRAM_BOT_TOKEN) {
        await telegramBot.sendMessage(telegramChatId, message, options);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error sending direct Telegram message:', error.message);
      return false;
    }
  }

  /**
   * Send notification to a user using both LINE and Telegram (parallel/fallback)
   */
  async sendDirectNotification(lineUserId, telegramChatId, message, telegramOptions = {}, lineFlexContents = null) {
    let lineSuccess = false;
    let telegramSuccess = false;

    if (telegramChatId && process.env.TELEGRAM_BOT_TOKEN) {
      try {
        const options = {
          parse_mode: 'Markdown',
          ...telegramOptions
        };
        await telegramBot.sendMessage(telegramChatId, message, options);
        telegramSuccess = true;
      } catch (err) {
        console.error(`[NotificationService] Failed to send Telegram notification: ${err.message}`);
      }
    }

    if (lineUserId && process.env.LINE_CHANNEL_ACCESS_TOKEN) {
      try {
        const lineMessage = lineFlexContents
          ? {
              type: 'flex',
              altText: 'บันทึกเวลาปฏิบัติงาน',
              contents: lineFlexContents
            }
          : {
              type: 'text',
              text: message
            };

        await lineClient.pushMessage({
          to: lineUserId,
          messages: [lineMessage]
        });
        lineSuccess = true;
      } catch (err) {
        console.error(`[NotificationService] Failed to send LINE notification: ${err.message}`);
      }
    }

    return {
      line: lineUserId ? lineSuccess : null,
      telegram: telegramChatId ? telegramSuccess : null,
      success: lineSuccess || telegramSuccess
    };
  }

  /**
   * Reply message to LINE user using reply token
   */
  async replyLineMessage(replyToken, message) {
    try {
      if (replyToken && process.env.LINE_CHANNEL_ACCESS_TOKEN) {
        let messages = [];
        if (message.length <= 4000) {
          messages.push({
            type: 'text',
            text: message,
          });
        } else {
          // Split message by lines to fit within LINE's 5000 character limit per text block (max 5 blocks)
          const lines = message.split('\n');
          let chunk = '';
          for (const line of lines) {
            if (chunk.length + line.length + 1 > 4000) {
              if (chunk) messages.push({ type: 'text', text: chunk });
              chunk = line;
            } else {
              chunk = chunk ? chunk + '\n' + line : line;
            }
          }
          if (chunk) messages.push({ type: 'text', text: chunk });
          
          // LINE limits up to 5 messages in reply. Keep only first 5 to prevent API error
          if (messages.length > 5) {
            messages = messages.slice(0, 5);
            messages[4].text += '\n\n... (ข้อมูลถูกจำกัดการแสดงผลเนื่องจากจำนวนรายการเกินขีดจำกัด)';
          }
        }

        await lineClient.replyMessage({
          replyToken: replyToken,
          messages: messages
        });
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error replying to LINE:', error.message);
      return false;
    }
  }

  _loadMappings() {
    if (!fs.existsSync(MAPPING_PATH)) {
      return {};
    }
    const data = fs.readFileSync(MAPPING_PATH, 'utf8');
    return JSON.parse(data);
  }
}

module.exports = new NotificationService();
