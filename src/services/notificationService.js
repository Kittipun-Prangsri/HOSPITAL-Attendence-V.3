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
const isPollingEnabled = isTelegramConfigured && process.env.ENABLE_TELEGRAM_POLLING === 'true';
const telegramBot = new TelegramBot(botToken || 'dummy_token', isPollingEnabled ? { polling: true } : {});

if (isTelegramConfigured) {
  if (isPollingEnabled) {
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

    telegramBot.on('polling_error', (err) => {
      if (err.message && err.message.includes('409 Conflict')) {
        // Polling conflict handled silently when multiple script instances run
        return;
      }
      console.error('[TelegramBot] Polling error:', err.message);
    });

    console.log('[TelegramBot] Polling listener initialized successfully.');
  } else {
    console.log('[TelegramBot] Running in sender-only mode (Polling disabled).');
  }
}

const lineConfigured = () => {
  const t = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  return Boolean(t && !t.startsWith('your_'));
};

/** Human-readable reason for a failed LINE push; the monthly free quota is the usual culprit. */
function describeLineError(err) {
  const status = err.status || err.statusCode || err.originalError?.response?.status || err.response?.status;
  const body = err.body || err.originalError?.response?.data || err.response?.data;
  const text = typeof body === 'string' ? body : JSON.stringify(body || {});
  if (status === 429 && /monthly limit/i.test(text)) return 'LINE: ใช้โควตาข้อความรายเดือนหมดแล้ว (429 monthly limit)';
  if (status === 429) return 'LINE: ส่งถี่เกินไป (429)';
  if (status === 401) return 'LINE: Channel access token ไม่ถูกต้องหรือหมดอายุ (401)';
  if (status === 400 && /'to'|\bto\b.*invalid|not found/i.test(text)) return 'LINE: User ID ไม่ถูกต้อง หรือผู้ใช้ยังไม่ได้เพิ่มเพื่อน OA (400)';
  if (status === 403) return 'LINE: ไม่มีสิทธิ์ส่ง หรือผู้ใช้บล็อก OA (403)';
  return `LINE: ${status || ''} ${text !== '{}' ? text : err.message}`.trim();
}

/**
 * Telegram send that survives Markdown in names/device labels ("_", "*", "[").
 * Telegram rejects the whole message on a parse error, so retry once as plain text.
 */
async function telegramSend(chatId, text, options = {}) {
  try {
    return await telegramBot.sendMessage(chatId, text, options);
  } catch (err) {
    if (options.parse_mode && /can't parse entities/i.test(err.message || '')) {
      const { parse_mode, ...plain } = options;
      return telegramBot.sendMessage(chatId, text, plain);
    }
    throw err;
  }
}

// Mapping path
const MAPPING_PATH = path.join(__dirname, '../../data/notification_mappings.json');

class NotificationService {
  /**
   * Send message to Admin on both platforms
   */
  async sendToAdmin(message) {
    // Each channel independently: a Telegram outage must not stop the LINE copy (and vice versa)
    const result = { telegram: null, line: null };
    if (process.env.TELEGRAM_ADMIN_CHAT_ID && isTelegramConfigured) {
      try {
        await telegramSend(process.env.TELEGRAM_ADMIN_CHAT_ID, message);
        result.telegram = true;
      } catch (error) {
        result.telegram = false;
        console.error('[NotificationService] admin Telegram failed:', error.message);
      }
    }
    if (process.env.LINE_ADMIN_USER_ID && lineConfigured()) {
      try {
        await lineClient.pushMessage({ to: process.env.LINE_ADMIN_USER_ID, messages: [{ type: 'text', text: message }] });
        result.line = true;
      } catch (error) {
        result.line = false;
        console.error('[NotificationService] admin LINE failed:', describeLineError(error));
      }
    }
    return result;
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
        await telegramSend(telegramChatId, message, options);
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
    let lineError = null;
    let telegramError = null;

    // Validate IDs to prevent sending to dummy values like '-' or invalid formats
    const cleanLineId = lineUserId && typeof lineUserId === 'string' && /^U[0-9a-fA-F]{32}$/.test(lineUserId.trim()) ? lineUserId.trim() : null;
    const cleanTelegramId = telegramChatId && /^-?\d+$/.test(String(telegramChatId).trim()) ? String(telegramChatId).trim() : null;

    if (cleanTelegramId && process.env.TELEGRAM_BOT_TOKEN) {
      try {
        const options = {
          parse_mode: 'Markdown',
          ...telegramOptions
        };
        await telegramSend(cleanTelegramId, message, options);
        telegramSuccess = true;
      } catch (err) {
        telegramError = `Telegram: ${err.message}`;
        console.error(`[NotificationService] Failed to send Telegram notification: ${err.message}`);
      }
    }

    if (cleanLineId && process.env.LINE_CHANNEL_ACCESS_TOKEN) {
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
          to: cleanLineId,
          messages: [lineMessage]
        });
        lineSuccess = true;
      } catch (err) {
        lineError = describeLineError(err);
        console.error(`[NotificationService] Failed to send LINE notification: ${lineError}`);
      }
    }

    return {
      line: lineUserId ? lineSuccess : null,
      telegram: telegramChatId ? telegramSuccess : null,
      success: lineSuccess || telegramSuccess,
      error: [lineError, telegramError].filter(Boolean).join(' · ') || null
    };
  }

  /**
   * Channel health for the admin page: is each bot configured and reachable, and how much of the
   * LINE monthly push quota is left (realtime scan cards use push, so the free plan runs out fast).
   */
  async getStatus() {
    const status = { line: { configured: lineConfigured() }, telegram: { configured: Boolean(isTelegramConfigured), polling: Boolean(isPollingEnabled) } };
    if (status.line.configured) {
      try {
        const [bot, quota, used] = await Promise.all([lineClient.getBotInfo(), lineClient.getMessageQuota(), lineClient.getMessageQuotaConsumption()]);
        Object.assign(status.line, {
          ok: true,
          name: bot.displayName,
          basicId: bot.basicId,
          quotaType: quota.type,
          quota: quota.type === 'limited' ? quota.value : null,
          used: used.totalUsage
        });
      } catch (err) {
        Object.assign(status.line, { ok: false, error: describeLineError(err) });
      }
    }
    if (status.telegram.configured) {
      try {
        const me = await telegramBot.getMe();
        Object.assign(status.telegram, { ok: true, name: me.first_name, username: me.username });
      } catch (err) {
        Object.assign(status.telegram, { ok: false, error: err.message });
      }
    }
    status.adminTargets = { telegram: Boolean(process.env.TELEGRAM_ADMIN_CHAT_ID), line: Boolean(process.env.LINE_ADMIN_USER_ID) };
    return status;
  }

  /**
   * Reply message to LINE user using reply token
   */
  async replyLineMessage(replyToken, message) {
    try {
      if (replyToken && process.env.LINE_CHANNEL_ACCESS_TOKEN) {
        let messages = [];

        // Check if message is a Flex Message object or JSON bubble
        if (typeof message === 'object' && message !== null) {
          if (message.type === 'flex' || message.type === 'text') {
            messages.push(message);
          } else if (message.type === 'bubble' || message.type === 'carousel') {
            messages.push({
              type: 'flex',
              altText: 'ประวัติการเข้างาน โรงพยาบาลคลองหาด',
              contents: message
            });
          }
        } else if (typeof message === 'string') {
          if (message.length <= 4000) {
            messages.push({
              type: 'text',
              text: message,
            });
          } else {
            // Split message by lines to fit within LINE's character limit per text block (max 5 blocks)
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
            
            if (messages.length > 5) {
              messages = messages.slice(0, 5);
              messages[4].text += '\n\n... (ข้อมูลถูกจำกัดการแสดงผลเนื่องจากจำนวนรายการเกินขีดจำกัด)';
            }
          }
        }

        if (messages.length > 0) {
          await lineClient.replyMessage({
            replyToken: replyToken,
            messages: messages
          });
          return true;
        }
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
module.exports.describeLineError = describeLineError;
