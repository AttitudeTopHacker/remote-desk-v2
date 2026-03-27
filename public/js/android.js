/**
 * android.js — Android Host page logic
 * Handles: socket events, screen capture via getDisplayMedia,
 *          WebRTC answer flow, receiving remote commands (display only),
 *          and disconnect.
 */

(function () {
  'use strict';

  // ─── URL Params ───────────────────────────────────────────────
  const params = new URLSearchParams(window.location.search);
  const ROOM_ID = (params.get('room') || sessionStorage.getItem('roomId') || '').toUpperCase();

  if (!ROOM_ID) {
    alert('No Room ID found. Please go back and enter a Room ID.');
    window.location.href = 'index.html';
    return;
  }

  // ─── DOM Elements ─────────────────────────────────────────────
  const El = {
    roomBadge:       document.getElementById('roomBadge'),
    connStatus:      document.getElementById('connStatus'),
    connStatusText:  document.getElementById('connStatusText'),
    startShareBtn:   document.getElementById('startShareBtn'),
    stopShareBtn:    document.getElementById('stopShareBtn'),
    localVideo:      document.getElementById('localVideo'),
    previewEmpty:    document.getElementById('previewEmpty'),
    liveLabel:       document.getElementById('liveLabel'),
    cmdLog:          document.getElementById('cmdLog'),
    receivedText:    document.getElementById('receivedText'),
    infoStatus:      document.getElementById('infoStatus'),
    infoRoom:        document.getElementById('infoRoom'),
    infoCommands:    document.getElementById('infoCommands'),
    infoScreen:      document.getElementById('infoScreen'),
    disconnectBtn:   document.getElementById('disconnectBtn'),
  };

  El.roomBadge.textContent = ROOM_ID;
  El.infoRoom.textContent = ROOM_ID;

  let commandCount = 0;
  let localStream = null;

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

  // ─── Command Log ──────────────────────────────────────────────
  function logCmd(type, detail) {
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
    const entry = document.createElement('div');
    entry.className = 'cmd-entry';
    entry.innerHTML = `<span class="cmd-time">${time}</span><span class="cmd-type ${type}">[${type.toUpperCase()}] ${detail}</span>`;
    El.cmdLog.appendChild(entry);
    El.cmdLog.scrollTop = El.cmdLog.scrollHeight;
    while (El.cmdLog.children.length > 150) El.cmdLog.removeChild(El.cmdLog.firstChild);
  }

  // ─── Status Helper ────────────────────────────────────────────
  function setStatus(state, msg) {
    El.connStatus.className = `status-bar ${state}`;
    El.connStatusText.textContent = msg;
    El.infoStatus.textContent = msg.split(' ')[0];
  }

  // ─── Socket ───────────────────────────────────────────────────
  const socket = getSocket();

  socket.on('connect', () => {
    setStatus('connected', 'Server connected');
    socket.emit('join-room-host', { roomId: ROOM_ID });
  });

  socket.on('disconnect', () => {
    setStatus('error', 'Disconnected from server');
    logCmd('system', 'Server connection lost');
  });

  socket.on('room-error', ({ message }) => {
    showToast(message, 'error');
    logCmd('system', `Error: ${message}`);
    setTimeout(() => { window.location.href = 'index.html'; }, 2000);
  });

  socket.on('joined', ({ roomId }) => {
    logCmd('system', `Joined room: ${roomId}`);
    setStatus('waiting', 'Waiting for Controller…');
    El.infoStatus.textContent = 'Waiting';
  });

  socket.on('controller-connected', () => {
    setStatus('connected', 'Controller connected');
    showToast('Controller device connected!', 'success');
    logCmd('system', 'Controller connected');
    El.infoStatus.textContent = 'Connected';
    // If stream ready, init WebRTC
    if (localStream) initWebRTC();
  });

  socket.on('controller-disconnected', () => {
    setStatus('waiting', 'Controller disconnected');
    showToast('Controller disconnected.', 'error');
    logCmd('system', 'Controller left');
    closePeerConnection();
  });

  // ─── Receive Remote Commands (display in log) ─────────────────
  socket.on('remote-touch', ({ event }) => {
    commandCount++;
    El.infoCommands.textContent = commandCount;
    const { type, x, y, endX, endY, key, direction } = event;
    switch (type) {
      case 'tap':         logCmd('tap',    `Tap @ ${x}%, ${y}%`); break;
      case 'double_tap':  logCmd('double_tap', `Double tap @ ${x}%, ${y}%`); break;
      case 'swipe':       logCmd('swipe',  `Swipe → (${endX}%, ${endY}%)`); break;
      case 'scroll':      logCmd('scroll', `Scroll ${direction} @ ${x}%, ${y}%`); break;
      case 'system_key':  logCmd('system', `Key: ${key}`); break;
      default:            logCmd('system', `Event: ${type}`);
    }
  });

  socket.on('remote-keyboard', ({ text }) => {
    commandCount++;
    El.infoCommands.textContent = commandCount;
    El.receivedText.textContent = text;
    El.receivedText.style.display = 'block';
    logCmd('keyboard', `Text: "${text.length > 30 ? text.slice(0, 30) + '…' : text}"`);
  });

  // ─── Screen Share ─────────────────────────────────────────────
  El.startShareBtn.addEventListener('click', async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      showToast('Screen sharing not supported on this browser/device.', 'error');
      return;
    }
    try {
      El.startShareBtn.disabled = true;
      El.startShareBtn.textContent = 'Starting…';
      localStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 60 }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });

      // Show preview
      El.localVideo.srcObject = localStream;
      El.localVideo.style.display = 'block';
      El.previewEmpty.style.display = 'none';
      El.liveLabel.style.display = 'block';
      El.startShareBtn.style.display = 'none';
      El.stopShareBtn.style.display = 'flex';
      El.infoScreen.textContent = 'Live';
      El.infoScreen.style.color = 'var(--success)';

      socket.emit('screen-share-status', { roomId: ROOM_ID, status: 'start' });
      logCmd('system', 'Screen sharing started');
      showToast('Screen sharing started!', 'success');

      // Listen for track end (user stops via browser UI)
      localStream.getVideoTracks()[0].addEventListener('ended', stopShare);

      // If controller already connected, start WebRTC
      initWebRTC();
    } catch (e) {
      showToast('Could not start screen share: ' + (e.message || 'Permission denied'), 'error');
      El.startShareBtn.disabled = false;
      El.startShareBtn.textContent = '▶ Start Screen Share';
    }
  });

  El.stopShareBtn.addEventListener('click', stopShare);

  function stopShare() {
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }
    El.localVideo.srcObject = null;
    El.localVideo.style.display = 'none';
    El.previewEmpty.style.display = 'flex';
    El.liveLabel.style.display = 'none';
    El.startShareBtn.style.display = 'flex';
    El.startShareBtn.disabled = false;
    El.startShareBtn.textContent = '▶ Start Screen Share';
    El.stopShareBtn.style.display = 'none';
    El.infoScreen.textContent = 'Off';
    El.infoScreen.style.color = '';

    socket.emit('screen-share-status', { roomId: ROOM_ID, status: 'stop' });
    closePeerConnection();
    logCmd('system', 'Screen sharing stopped');
    showToast('Screen sharing stopped.', 'info');
  }

  // ─── WebRTC Answer Flow ───────────────────────────────────────
  function initWebRTC() {
    if (!localStream) return;

    const pc = createPeerConnection(ROOM_ID, socket, null);

    // Add local stream tracks
    addStreamToPeer(localStream);

    // Handle incoming offer from controller
    socket.off('webrtc-offer'); // prevent duplicate handlers
    socket.on('webrtc-offer', async ({ offer }) => {
      await handleOffer(offer, ROOM_ID, socket);
      logCmd('system', 'WebRTC offer received → answer sent');
    });

    // Handle ICE candidates from controller
    socket.off('ice-candidate');
    socket.on('ice-candidate', async ({ candidate }) => {
      await addIceCandidate(candidate);
    });
  }

  // ─── Disconnect ───────────────────────────────────────────────
  El.disconnectBtn.addEventListener('click', () => {
    stopShare();
    socket.emit('leave-room');
    closePeerConnection();
    disconnectSocket();
    showToast('Disconnected from session.', 'info');
    setTimeout(() => { window.location.href = 'index.html'; }, 800);
  });

  window.addEventListener('beforeunload', () => {
    if (localStream) localStream.getTracks().forEach((t) => t.stop());
    socket.emit('leave-room');
    closePeerConnection();
  });

  logCmd('system', `Host ready — Room: ${ROOM_ID}`);

})();
