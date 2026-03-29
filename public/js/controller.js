/**
 * controller.js — Controller page logic
 * Handles: socket events, WebRTC offer flow, touch events, keyboard input,
 *          quick action buttons, event log, and disconnect.
 */

(function () {
  'use strict';

  // ─── URL Params ───────────────────────────────────────────────
  const params = new URLSearchParams(window.location.search);
  const ROOM_ID = (params.get('room') || sessionStorage.getItem('roomId') || '').toUpperCase();

  if (!ROOM_ID) {
    alert('No Room ID found. Please create a room from the home page.');
    window.location.href = 'index.html';
    return;
  }

  // ─── DOM Elements ─────────────────────────────────────────────
  const El = {
    roomChip:        document.getElementById('roomChip'),
    connStatus:      document.getElementById('connStatus'),
    connStatusText:  document.getElementById('connStatusText'),
    hostStatus:      document.getElementById('hostStatus'),
    hostStatusText:  document.getElementById('hostStatusText'),
    remoteVideo:     document.getElementById('remoteVideo'),
    videoPlaceholder:document.getElementById('videoPlaceholder'),
    touchCanvas:     document.getElementById('touchCanvas'),
    eventLog:        document.getElementById('eventLog'),
    kbInput:         document.getElementById('kbInput'),
    sendTextBtn:     document.getElementById('sendTextBtn'),
    clearTextBtn:    document.getElementById('clearTextBtn'),
    disconnectBtn:   document.getElementById('disconnectBtn'),
    // quick actions
    btnHome:         document.getElementById('btnHome'),
    btnBack:         document.getElementById('btnBack'),
    btnRecent:       document.getElementById('btnRecent'),
    btnVolumeUp:     document.getElementById('btnVolumeUp'),
    btnVolumeDown:   document.getElementById('btnVolumeDown'),
    btnMute:         document.getElementById('btnMute'),
  };

  El.roomChip.textContent = ROOM_ID;

  // ─── Toast ────────────────────────────────────────────────────
  function showToast(msg, type = 'info') {
    const tc = document.getElementById('toastContainer');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    tc.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(20px)'; t.style.transition = '0.3s'; }, 3000);
    setTimeout(() => t.remove(), 3400);
  }

  // ─── Event Log ────────────────────────────────────────────────
  function logEvent(type, detail) {
    const now = new Date();
    const t = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
    const line = document.createElement('div');
    line.className = 'log-line';
    line.innerHTML = `<span class="t">${t}</span><span class="e ${type}">${detail}</span>`;
    El.eventLog.appendChild(line);
    El.eventLog.scrollTop = El.eventLog.scrollHeight;
    // Keep max 200 lines
    while (El.eventLog.children.length > 200) El.eventLog.removeChild(El.eventLog.firstChild);
  }

  // ─── Status Helpers ───────────────────────────────────────────
  function setStatus(el, textEl, state, msg) {
    el.className = `status-bar ${state}`;
    textEl.textContent = msg;
  }

  // ─── Socket ───────────────────────────────────────────────────
  const socket = getSocket();

  socket.on('connect', () => {
    setStatus(El.connStatus, El.connStatusText, 'connected', 'Server connected');
    socket.emit('join-room-controller', { roomId: ROOM_ID });
  });

  socket.on('disconnect', () => {
    setStatus(El.connStatus, El.connStatusText, 'error', 'Disconnected from server');
    logEvent('sys', 'Server connection lost');
  });

  socket.on('room-error', ({ message }) => {
    showToast(message, 'error');
    logEvent('sys', `Error: ${message}`);
    setTimeout(() => { window.location.href = 'index.html'; }, 2000);
  });

  socket.on('joined', ({ roomId }) => {
    logEvent('sys', `Joined room: ${roomId}`);
  });

  socket.on('host-connected', () => {
    setStatus(El.hostStatus, El.hostStatusText, 'connected', 'Android device connected');
    showToast('Android device connected! Initiating screen share…', 'success');
    logEvent('sys', 'Android device connected');
    // WebRTC start occurs ONLY after permission is granted
  });

  socket.on('waiting-for-permission', () => {
    setStatus(El.hostStatus, El.hostStatusText, 'waiting', 'Waiting for Host Permission…');
    showToast('Permission requested. Please wait for the host to allow the connection.', 'info');
    logEvent('sys', 'Waiting for permission…');
  });

  socket.on('permission-response', ({ accepted }) => {
    if (accepted) {
      showToast('Permission granted! Connecting…', 'success');
      logEvent('sys', 'Permission granted');
    } else {
      showToast('Permission denied by the host.', 'error');
      logEvent('sys', 'Permission denied');
      setTimeout(() => { window.location.href = 'index.html'; }, 3000);
    }
  });

  socket.on('host-connected', () => {
    setStatus(El.hostStatus, El.hostStatusText, 'connected', 'Android device connected');
    showToast('Connection established!', 'success');
    logEvent('sys', 'Android device connected');
    // WebRTC starts when the Host sends the offer
  });

  socket.on('host-disconnected', () => {
    setStatus(El.hostStatus, El.hostStatusText, 'error', 'Android device disconnected');
    showToast('Android device disconnected.', 'error');
    logEvent('sys', 'Android device left');
    hideVideo();
    closePeerConnection();
  });

  // ─── WebRTC Answer Flow (Controller) ──────────────────────────
  socket.on('webrtc-offer', async ({ offer }) => {
    logEvent('sys', 'WebRTC offer received. Connecting...');
    createPeerConnection(ROOM_ID, socket, onRemoteTrack);
    await handleOffer(offer, ROOM_ID, socket);
    logEvent('sys', 'WebRTC answer sent');
  });

  socket.on('ice-candidate', async ({ candidate }) => {
    await addIceCandidate(candidate);
  });

  function onRemoteTrack(stream) {
    El.remoteVideo.srcObject = stream;
    El.remoteVideo.style.display = 'block';
    El.videoPlaceholder.style.display = 'none';
    El.remoteVideo.play().catch(() => {});
    logEvent('sys', 'Screen stream received');
    showToast('Screen sharing started!', 'success');
    setupTouchCanvas();
  }

  function hideVideo() {
    El.remoteVideo.srcObject = null;
    El.remoteVideo.style.display = 'none';
    El.videoPlaceholder.style.display = 'flex';
  }

  // ─── Touch Canvas ─────────────────────────────────────────────
  let touchStart = null;
  let lastTap = 0;

  function setupTouchCanvas() {
    const canvas = El.touchCanvas;
    const video = El.remoteVideo;

    function getRelativePos(clientX, clientY) {
      const rect = video.getBoundingClientRect();
      return {
        x: Math.round(((clientX - rect.left) / rect.width) * 10000) / 100,  // percent
        y: Math.round(((clientY - rect.top) / rect.height) * 10000) / 100,
      };
    }

    function sendTouch(event) {
      socket.emit('remote-touch', { roomId: ROOM_ID, event });
    }

    // ── Mouse Events ──────────────────────────────────────────
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      touchStart = { x: e.clientX, y: e.clientY, time: Date.now() };
    });

    canvas.addEventListener('mouseup', (e) => {
      if (!touchStart || e.button !== 0) return;
      const pos = getRelativePos(e.clientX, e.clientY);
      const dx = e.clientX - touchStart.x;
      const dy = e.clientY - touchStart.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const dur = Date.now() - touchStart.time;

      if (dist < 8) {
        // Tap or double tap
        const now = Date.now();
        if (now - lastTap < 300) {
          sendTouch({ type: 'double_tap', ...pos });
          logEvent('dbl', `Double tap @ ${pos.x}%, ${pos.y}%`);
        } else {
          sendTouch({ type: 'tap', ...pos });
          logEvent('tap', `Tap @ ${pos.x}%, ${pos.y}%`);
        }
        lastTap = now;
      } else {
        // Swipe
        const startPos = getRelativePos(touchStart.x, touchStart.y);
        sendTouch({ type: 'swipe', x: startPos.x, y: startPos.y, endX: pos.x, endY: pos.y, duration: dur });
        logEvent('swipe', `Swipe (${Math.round(dx)}, ${Math.round(dy)})`);
      }
      touchStart = null;
    });

    // Scroll → scroll event
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const pos = getRelativePos(e.clientX, e.clientY);
      const dir = e.deltaY > 0 ? 'down' : 'up';
      sendTouch({ type: 'scroll', ...pos, direction: dir, delta: Math.round(e.deltaY) });
      logEvent('scroll', `Scroll ${dir} @ ${pos.x}%, ${pos.y}%`);
    }, { passive: false });

    // ── Touch Events (mobile controller) ─────────────────────
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.touches[0];
      touchStart = { x: t.clientX, y: t.clientY, time: Date.now() };
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (!touchStart) return;
      const t = e.changedTouches[0];
      const pos = getRelativePos(t.clientX, t.clientY);
      const dx = t.clientX - touchStart.x;
      const dy = t.clientY - touchStart.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const dur = Date.now() - touchStart.time;

      if (dist < 12) {
        const now = Date.now();
        if (now - lastTap < 300) {
          sendTouch({ type: 'double_tap', ...pos });
          logEvent('dbl', `Double tap @ ${pos.x}%, ${pos.y}%`);
        } else {
          sendTouch({ type: 'tap', ...pos });
          logEvent('tap', `Tap @ ${pos.x}%, ${pos.y}%`);
        }
        lastTap = now;
      } else {
        const startPos = getRelativePos(touchStart.x, touchStart.y);
        sendTouch({ type: 'swipe', x: startPos.x, y: startPos.y, endX: pos.x, endY: pos.y, duration: dur });
        logEvent('swipe', `Swipe (${Math.round(dx)}, ${Math.round(dy)})`);
      }
      touchStart = null;
    }, { passive: false });
  }

  // ─── Keyboard Input ───────────────────────────────────────────
  function sendKeyboardText() {
    const text = El.kbInput.value;
    if (!text) return;
    socket.emit('remote-keyboard', { roomId: ROOM_ID, text });
    logEvent('key', `Text: "${text.length > 20 ? text.slice(0, 20) + '…' : text}"`);
    El.kbInput.value = '';
    showToast('Text sent!', 'success');
  }

  El.sendTextBtn.addEventListener('click', sendKeyboardText);
  El.clearTextBtn.addEventListener('click', () => { El.kbInput.value = ''; });
  El.kbInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendKeyboardText(); }
  });

  // ─── Quick Action Buttons ─────────────────────────────────────
  function sendSystemKey(key) {
    socket.emit('remote-touch', { roomId: ROOM_ID, event: { type: 'system_key', key } });
    logEvent('sys', `System key: ${key}`);
  }

  El.btnHome.addEventListener('click', () => sendSystemKey('HOME'));
  El.btnBack.addEventListener('click', () => sendSystemKey('BACK'));
  El.btnRecent.addEventListener('click', () => sendSystemKey('RECENTS'));
  El.btnVolumeUp.addEventListener('click', () => sendSystemKey('VOLUME_UP'));
  El.btnVolumeDown.addEventListener('click', () => sendSystemKey('VOLUME_DOWN'));
  El.btnMute.addEventListener('click', () => sendSystemKey('MUTE'));

  // ─── Disconnect ───────────────────────────────────────────────
  El.disconnectBtn.addEventListener('click', () => {
    socket.emit('leave-room');
    closePeerConnection();
    disconnectSocket();
    showToast('Disconnected from session.', 'info');
    setTimeout(() => { window.location.href = 'index.html'; }, 800);
  });

  window.addEventListener('beforeunload', () => {
    socket.emit('leave-room');
    closePeerConnection();
  });

  // Initial status
  setStatus(El.hostStatus, El.hostStatusText, 'waiting', 'Awaiting Android device…');
  logEvent('sys', `Controller ready — Room: ${ROOM_ID}`);

})();
