/**
 * android.js — Android Host page logic
 * Handles: socket events, screen capture via getDisplayMedia,
 *          camera fallback for mobile, WebRTC answer flow,
 *          receiving remote commands (display only), and disconnect.
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

  // ─── Device Detection ────────────────────────────────────────
  const isMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const hasDisplayMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
  const hasUserMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

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
    shareMode:       document.getElementById('shareMode'),
    cameraSwitchBtn: document.getElementById('cameraSwitchBtn'),
    // Permission Modal
    permissionModal: document.getElementById('permissionModal'),
    acceptBtn:       document.getElementById('acceptBtn'),
    rejectBtn:       document.getElementById('rejectBtn'),
  };

  El.roomBadge.textContent = ROOM_ID;
  El.infoRoom.textContent = ROOM_ID;

  let commandCount = 0;
  let localStream = null;
  let currentShareMode = 'screen'; // 'screen' or 'camera'
  let currentFacingMode = 'environment'; // 'environment' (back) or 'user' (front)

  // ─── Update UI based on device capabilities ──────────────────
  function initShareUI() {
    const shareModeEl = El.shareMode;
    if (!shareModeEl) return;

    if (isMobile && !hasDisplayMedia) {
      // Android — only camera available
      shareModeEl.innerHTML = `
        <div class="share-mode-info warning">
          <span>⚠️</span>
          <div>
            <strong>Screen share is not supported on this device</strong>
            <p>Android browsers don't support screen capture. You can share your <strong>camera</strong> instead, or use a <strong>desktop/laptop browser</strong> for full screen sharing.</p>
          </div>
        </div>
      `;
      currentShareMode = 'camera';
      El.startShareBtn.innerHTML = '📷 Share Camera';
    } else if (isMobile && hasDisplayMedia) {
      // Some mobile browsers might support it
      shareModeEl.innerHTML = `
        <div class="share-mode-tabs">
          <button class="mode-tab active" data-mode="screen" id="modeScreen">📺 Screen</button>
          <button class="mode-tab" data-mode="camera" id="modeCamera">📷 Camera</button>
        </div>
      `;
      setupModeTabs();
    } else {
      // Desktop — full support
      shareModeEl.innerHTML = `
        <div class="share-mode-tabs">
          <button class="mode-tab active" data-mode="screen" id="modeScreen">📺 Screen</button>
          <button class="mode-tab" data-mode="camera" id="modeCamera">📷 Camera</button>
        </div>
      `;
      setupModeTabs();
    }
  }

  function setupModeTabs() {
    const tabs = document.querySelectorAll('.mode-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentShareMode = tab.dataset.mode;
        El.startShareBtn.innerHTML = currentShareMode === 'screen'
          ? '▶ Start Screen Share'
          : '📷 Share Camera';
        // Show/hide camera switch button
        if (El.cameraSwitchBtn) {
          El.cameraSwitchBtn.style.display = 'none';
        }
      });
    });
  }

  initShareUI();

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

  // ─── Permission Request Handling ──────────────────────────────
  socket.on('permission-request', () => {
    logCmd('system', 'Incoming connection request…');
    if (El.permissionModal) {
      El.permissionModal.style.display = 'flex';
    }
  });

  El.acceptBtn.addEventListener('click', () => {
    El.permissionModal.style.display = 'none';
    socket.emit('permission-response', { roomId: ROOM_ID, accepted: true });
    logCmd('system', 'Permission GRANTED');
    showToast('Access granted to controller', 'success');
  });

  El.rejectBtn.addEventListener('click', () => {
    El.permissionModal.style.display = 'none';
    socket.emit('permission-response', { roomId: ROOM_ID, accepted: false });
    logCmd('system', 'Permission REJECTED');
    showToast('Access request rejected', 'error');
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

  // ─── Start Sharing (Screen or Camera) ─────────────────────────
  El.startShareBtn.addEventListener('click', async () => {
    try {
      El.startShareBtn.disabled = true;
      El.startShareBtn.textContent = 'Starting…';

      if (currentShareMode === 'screen') {
        // Screen share mode
        if (!hasDisplayMedia) {
          showToast('Screen sharing not supported. Switching to camera mode.', 'error');
          currentShareMode = 'camera';
          // Fall through to camera
        } else {
          localStream = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: { ideal: 30, max: 60 }, width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
          });
          logCmd('system', 'Screen sharing started');
          showToast('Screen sharing started!', 'success');
        }
      }

      if (currentShareMode === 'camera') {
        // Camera share mode (fallback for Android)
        if (!hasUserMedia) {
          showToast('Neither screen share nor camera is available on this device.', 'error');
          El.startShareBtn.disabled = false;
          El.startShareBtn.textContent = currentShareMode === 'camera' ? '📷 Share Camera' : '▶ Start Screen Share';
          return;
        }

        localStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: currentFacingMode,
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
          },
          audio: false,
        });

        logCmd('system', `Camera sharing started (${currentFacingMode === 'user' ? 'front' : 'back'})`);
        showToast('Camera sharing started!', 'success');

        // Show camera switch button on mobile
        if (El.cameraSwitchBtn) {
          El.cameraSwitchBtn.style.display = 'flex';
        }
      }

      // Show preview
      El.localVideo.srcObject = localStream;
      El.localVideo.style.display = 'block';
      El.previewEmpty.style.display = 'none';
      El.liveLabel.style.display = 'block';
      El.liveLabel.textContent = currentShareMode === 'camera' ? '● CAMERA LIVE' : '● LIVE';
      El.startShareBtn.style.display = 'none';
      El.stopShareBtn.style.display = 'flex';
      El.infoScreen.textContent = 'Live';
      El.infoScreen.style.color = 'var(--success)';

      socket.emit('screen-share-status', { roomId: ROOM_ID, status: 'start' });

      // Listen for track end (user stops via browser UI)
      localStream.getVideoTracks()[0].addEventListener('ended', stopShare);

      // If controller already connected, start WebRTC
      initWebRTC();
    } catch (e) {
      console.error('Share error:', e);
      showToast('Could not start sharing: ' + (e.message || 'Permission denied'), 'error');
      El.startShareBtn.disabled = false;
      El.startShareBtn.textContent = currentShareMode === 'camera' ? '📷 Share Camera' : '▶ Start Screen Share';
    }
  });

  // ─── Camera Switch (front/back) ───────────────────────────────
  if (El.cameraSwitchBtn) {
    El.cameraSwitchBtn.addEventListener('click', async () => {
      if (currentShareMode !== 'camera' || !localStream) return;

      // Toggle facing mode
      currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';

      // Stop existing tracks
      localStream.getTracks().forEach(t => t.stop());

      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: currentFacingMode,
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
          },
          audio: false,
        });

        El.localVideo.srcObject = localStream;
        localStream.getVideoTracks()[0].addEventListener('ended', stopShare);

        logCmd('system', `Switched to ${currentFacingMode === 'user' ? 'front' : 'back'} camera`);
        showToast(`Switched to ${currentFacingMode === 'user' ? 'front' : 'back'} camera`, 'success');

        // Re-init WebRTC with new stream
        initWebRTC();
      } catch (e) {
        showToast('Could not switch camera: ' + e.message, 'error');
      }
    });
  }

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
    El.startShareBtn.textContent = currentShareMode === 'camera' ? '📷 Share Camera' : '▶ Start Screen Share';
    El.stopShareBtn.style.display = 'none';
    El.infoScreen.textContent = 'Off';
    El.infoScreen.style.color = '';

    if (El.cameraSwitchBtn) {
      El.cameraSwitchBtn.style.display = 'none';
    }

    socket.emit('screen-share-status', { roomId: ROOM_ID, status: 'stop' });
    closePeerConnection();
    logCmd('system', 'Sharing stopped');
    showToast('Sharing stopped.', 'info');
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
  if (isMobile && !hasDisplayMedia) {
    logCmd('system', 'Device: Android — Camera mode active');
  }

})();
