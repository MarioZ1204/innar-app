// config/cors.js
// CORS para SPA y desarrollo

const cors = require('cors');

function applyCors(app) {
  const FRONTEND_URL = process.env.FRONTEND_URL || 'https://innarapp.neurocienciasnarino.com';
  const allowedOrigins = [FRONTEND_URL];
  if (process.env.NODE_ENV !== 'production') {
    allowedOrigins.push(
      /^http:\/\/localhost:\d+$/,
      /^http:\/\/127\.0\.0\.1:\d+$/,
      /^http:\/\/192\.168\.\d+\.\d+:\d+$/,
      /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/,
      /^http:\/\/172\.(1[6-9]|2\d|3[01])\.\d+\.\d+(:\d+)?$/
    );
  }
  app.use(cors({ origin: allowedOrigins, credentials: true }));
}

module.exports = { applyCors };
