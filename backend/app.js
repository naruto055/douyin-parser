const express = require('express');
const cors = require('cors');
const path = require('path');

const config = require('./config');
const apiRoutes = require('./routes/api');
const aiRoutes = require('./routes/ai');
const errorHandler = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimit');
const browserPool = require('./utils/browserPool');
const response = require('./utils/response');

const app = express();

app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path} - ${req.ip}`);
  next();
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  response.ok(res, { timestamp: new Date().toISOString() }, 'Service is running');
});

app.use('/api/ai', aiRoutes);
app.use('/api', apiLimiter);
app.use('/api', apiRoutes);

app.use(errorHandler);

const PORT = config.port || 3000;

async function startServer() {
  try {
    await browserPool.initCluster();

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/api/health`);
      console.log(`Rate limit: ${config.rateLimit.max} requests per ${config.rateLimit.windowMs / 1000}s`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

async function gracefulShutdown() {
  console.log('\nShutting down gracefully...');
  try {
    await browserPool.close();
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

startServer();

module.exports = app;
