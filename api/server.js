// Vercel serverless handler that wraps the Express app
const serverless = require('serverless-http');

// Import the Express app without starting a local server
const app = require('../server');

module.exports = serverless(app);
