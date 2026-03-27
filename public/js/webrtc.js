/**
 * webrtc.js — WebRTC peer connection helpers
 * Supports both offer (controller) and answer (android host) flows.
 */

(function (global) {
  'use strict';

  const ICE_SERVERS = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
    ],
  };

  let _pc = null;  // RTCPeerConnection

  /**
   * Create a new RTCPeerConnection and set up ICE handling.
   * @param {string} roomId
   * @param {SocketIO.Socket} socket
   * @param {function} onTrack  — called when remote track arrives
   * @returns {RTCPeerConnection}
   */
  function createPeerConnection(roomId, socket, onTrack) {
    if (_pc) {
      _pc.close();
      _pc = null;
    }

    _pc = new RTCPeerConnection(ICE_SERVERS);

    // Send ICE candidates to remote peer via signaling server
    _pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', { roomId, candidate: event.candidate });
      }
    };

    _pc.oniceconnectionstatechange = () => {
      console.log('[WebRTC] ICE state:', _pc.iceConnectionState);
    };

    _pc.onconnectionstatechange = () => {
      console.log('[WebRTC] Connection state:', _pc.connectionState);
    };

    // Receive remote media track (controller side)
    if (typeof onTrack === 'function') {
      _pc.ontrack = (event) => {
        console.log('[WebRTC] Remote track received:', event.track.kind);
        onTrack(event.streams[0] || null, event.track);
      };
    }

    return _pc;
  }

  /**
   * Controller: create offer and send via socket.
   */
  async function createOffer(roomId, socket) {
    const offer = await _pc.createOffer({
      offerToReceiveVideo: true,
      offerToReceiveAudio: false,
    });
    await _pc.setLocalDescription(offer);
    socket.emit('webrtc-offer', { roomId, offer });
    console.log('[WebRTC] Offer sent');
  }

  /**
   * Host: handle incoming offer, create answer.
   */
  async function handleOffer(offer, roomId, socket) {
    await _pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await _pc.createAnswer();
    await _pc.setLocalDescription(answer);
    socket.emit('webrtc-answer', { roomId, answer });
    console.log('[WebRTC] Answer sent');
  }

  /**
   * Controller: handle incoming answer from host.
   */
  async function handleAnswer(answer) {
    await _pc.setRemoteDescription(new RTCSessionDescription(answer));
    console.log('[WebRTC] Remote description set (answer)');
  }

  /**
   * Both sides: add received ICE candidate.
   */
  async function addIceCandidate(candidate) {
    if (_pc && candidate) {
      try {
        await _pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn('[WebRTC] ICE candidate error:', e);
      }
    }
  }

  /**
   * Host: add local stream tracks to peer connection.
   */
  function addStreamToPeer(stream) {
    if (!_pc) return;
    stream.getTracks().forEach((track) => {
      _pc.addTrack(track, stream);
      console.log('[WebRTC] Track added:', track.kind);
    });
  }

  /**
   * Close and cleanup.
   */
  function closePeerConnection() {
    if (_pc) {
      _pc.close();
      _pc = null;
      console.log('[WebRTC] Peer connection closed');
    }
  }

  function getPeerConnection() { return _pc; }

  // Expose globally
  Object.assign(global, {
    createPeerConnection,
    createOffer,
    handleOffer,
    handleAnswer,
    addIceCandidate,
    addStreamToPeer,
    closePeerConnection,
    getPeerConnection,
  });
})(window);
