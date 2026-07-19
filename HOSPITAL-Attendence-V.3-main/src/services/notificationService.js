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
const telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN || 'dummy_token');

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
  async sendDirectTelegram(telegramChatId, message) {
    try {
      if (telegramChatId && process.env.TELEGRAM_BOT_TOKEN) {
        await telegramBot.sendMessage(telegramChatId, message);
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
  async sendDirectNotification(lineUserId, telegramChatId, message) {
    let lineSuccess = false;
    let telegramSuccess = false;

    if (telegramChatId && process.env.TELEGRAM_BOT_TOKEN) {
      try {
        await telegramBot.sendMessage(telegramChatId, message);
        telegramSuccess = true;
      } catch (err) {
        console.error(`[NotificationService] Failed to send Telegram notification: ${err.message}`);
      }
    }

    if (lineUserId && process.env.LINE_CHANNEL_ACCESS_TOKEN) {
      try {
        await lineClient.pushMessage({
          to: lineUserId,
          messages: [{
            type: 'text',
            text: message,
          }]
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
        await lineClient.replyMessage({
          replyToken: replyToken,
          messages: [{
            type: 'text',
            text: message,
          }]
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
