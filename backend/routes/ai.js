const express = require('express');

const AIChatService = require('../services/AIChatService');
const { aiLimiter } = require('../middleware/rateLimit');
const { initializeSSE, writeSSEEvent, closeSSE } = require('../utils/sse');

const router = express.Router();

router.post('/chat', aiLimiter, async (req, res, next) => {
  try {
    const { message, sessionId } = req.body || {};

    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'message is required'
      });
    }

    const data = await AIChatService.chat(message, sessionId);
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.post('/chat/stream', aiLimiter, async (req, res) => {
  const { message, sessionId } = req.body || {};

  if (!message) {
    return res.status(400).json({
      success: false,
      error: 'message is required'
    });
  }

  const cleanupHeartbeat = initializeSSE(res);
  req.on('close', () => {
    closeSSE(res, cleanupHeartbeat);
  });

  try {
    await AIChatService.chatStream(message, sessionId, {
      onEvent(event, payload) {
        writeSSEEvent(res, event, payload);
      }
    });
  } catch (error) {
    writeSSEEvent(res, 'error', {
      error: error.message || 'AI stream failed'
    });
  } finally {
    closeSSE(res, cleanupHeartbeat);
  }
});

module.exports = router;
