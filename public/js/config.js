/**
 * config.js — Backend Server URL Configuration
 *
 * LOCAL:   Leave BACKEND_URL as empty string '' (uses same-origin)
 * DEPLOYED: Set your actual Render/Railway backend URL below
 *
 * Example: 'https://remotedesk-api.onrender.com'
 */

window.REMOTE_SERVER_URL = 'https://remotedesk-server.onrender.com';

// Helper: build full API URL (works both local and deployed)
window.API_URL = function (path) {
  const base = window.REMOTE_SERVER_URL || '';
  return base + path;
};
