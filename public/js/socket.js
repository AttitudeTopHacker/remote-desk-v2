/**
 * socket.js — Shared Socket.io connection singleton
 * Provides a single socket instance across all pages.
 */

(function (global) {
  'use strict';

  const SERVER_URL = window.REMOTE_SERVER_URL || '';  // same origin by default
  let _socket = null;

  function getSocket() {
    if (!_socket || !_socket.connected) {
      _socket = io(SERVER_URL, {
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1500,
        transports: ['websocket', 'polling'],
      });

      _socket.on('connect', () => {
        console.log('[Socket] Connected:', _socket.id);
      });

      _socket.on('disconnect', (reason) => {
        console.warn('[Socket] Disconnected:', reason);
      });

      _socket.on('connect_error', (err) => {
        console.error('[Socket] Connection error:', err.message);
      });
    }
    return _socket;
  }

  function disconnectSocket() {
    if (_socket) {
      _socket.disconnect();
      _socket = null;
    }
  }

  // Expose globally
  global.getSocket = getSocket;
  global.disconnectSocket = disconnectSocket;
})(window);
