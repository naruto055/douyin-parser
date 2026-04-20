const express = require('express');

const AIChatService = require('../services/AIChatService');
const { aiLimiter } = require('../middleware/rateLimit');

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

module.exports = router;
