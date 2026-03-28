/**
 * config.js — Backend Server URL Configuration
 *
 * LOCAL:   Leave BACKEND_URL as empty string '' (uses same-origin)
 * DEPLOYED: Set your actual Render/Railway backend URL below
 */

window.REMOTE_SERVER_URL = 'https://remote-desk-server-v2.onrender.com';

// Helper: build full API URL (works both local and deployed)
window.API_URL = function (path) {
  const base = window.REMOTE_SERVER_URL || '';
  return base + path;
};
