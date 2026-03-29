require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim().replace(/\/$/, ''))
  : ['http://localhost:3000', 'https://remotev2.netlify.app'];

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl) 
      // or if origin is in the allowed list
      if (!origin || allowedOrigins.includes(origin.replace(/\/$/, ''))) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// In-memory room storage
// rooms: { roomId: { hostSocketId, controllerSocketId, createdAt } }
const rooms = new Map();

// Cleanup old rooms (older than 2 hours)
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms.entries()) {
    if (now - room.createdAt > 2 * 60 * 60 * 1000) {
      rooms.delete(id);
      console.log(`🗑  Cleaned up stale room: ${id}`);
    }
  }
}, 30 * 60 * 1000);

// REST: Generate a unique room ID
app.post('/api/create-room', (req, res) => {
  const roomId = uuidv4().slice(0, 8).toUpperCase();
  rooms.set(roomId, {
    hostSocketId: null,
    controllerSocketId: null,
    createdAt: Date.now(),
  });
  console.log(`🆕 Room created: ${roomId}`);
  res.json({ success: true, roomId });
});

// REST: Check if a room exists
app.get('/api/room/:roomId', (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId.toUpperCase());
  if (room) {
    res.json({ exists: true, hasHost: !!room.hostSocketId, hasController: !!room.controllerSocketId });
  } else {
    res.json({ exists: false });
  }
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', rooms: rooms.size }));

// Socket.io events
io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  // Host (Android) joins room
  socket.on('join-room-host', ({ roomId }) => {
    const id = roomId?.toUpperCase();
    const room = rooms.get(id);

    if (!room) {
      socket.emit('room-error', { message: 'Room not found. Please create a room first.' });
      return;
    }

    // ✋ Self-join guard: block if same socket is already the controller in this room
    if (room.controllerSocketId === socket.id) {
      socket.emit('room-error', { message: 'You cannot join your own room. Use a different device.' });
      console.warn(`⚠️  Self-join blocked: ${socket.id} tried to join room ${id} as both host and controller`);
      return;
    }

    room.hostSocketId = socket.id;
    socket.join(id);
    socket.roomId = id;
    socket.role = 'host';

    console.log(`📱 Host joined room: ${id} (${socket.id})`);
    socket.emit('joined', { roomId: id, role: 'host' });

    // Notify controller if already waiting
    if (room.controllerSocketId) {
      io.to(room.controllerSocketId).emit('host-connected', { roomId: id });
      socket.emit('controller-connected', { roomId: id });
    }
  });

  // Controller joins room
  socket.on('join-room-controller', ({ roomId }) => {
    const id = roomId?.toUpperCase();
    const room = rooms.get(id);

    if (!room) {
      socket.emit('room-error', { message: 'Room not found. Please check the Room ID.' });
      return;
    }

    room.controllerSocketId = socket.id;
    socket.join(id);
    socket.roomId = id;
    socket.role = 'controller';

    console.log(`🖥  Controller joined room: ${id} (${socket.id})`);
    socket.emit('joined', { roomId: id, role: 'controller' });

    // Notify host if already in room (request permission)
    if (room.hostSocketId) {
      io.to(room.hostSocketId).emit('permission-request', { roomId: id, controllerId: socket.id });
      socket.emit('waiting-for-permission', { roomId: id });
    }
  });

  // Permission response from Host -> Controller
  socket.on('permission-response', ({ roomId, accepted }) => {
    const id = roomId?.toUpperCase();
    const room = rooms.get(id);
    if (room?.controllerSocketId) {
      io.to(room.controllerSocketId).emit('permission-response', { accepted });
      if (accepted) {
        console.log(`✅ Permission GRANTED for room ${id}`);
        // Now they can proceed with WebRTC
        io.to(room.hostSocketId).emit('controller-connected', { roomId: id });
        io.to(room.controllerSocketId).emit('host-connected', { roomId: id });
      } else {
        console.log(`❌ Permission DENIED for room ${id}`);
      }
    }
  });

  // ── WebRTC Signaling ──────────────────────────────────────────
  // Forward offer from controller → host
  socket.on('webrtc-offer', ({ roomId, offer }) => {
    const id = roomId?.toUpperCase();
    const room = rooms.get(id);
    if (room?.hostSocketId) {
      io.to(room.hostSocketId).emit('webrtc-offer', { offer, from: socket.id });
    }
  });

  // Forward answer from host → controller
  socket.on('webrtc-answer', ({ roomId, answer }) => {
    const id = roomId?.toUpperCase();
    const room = rooms.get(id);
    if (room?.controllerSocketId) {
      io.to(room.controllerSocketId).emit('webrtc-answer', { answer, from: socket.id });
    }
  });

  // Forward ICE candidates
  socket.on('ice-candidate', ({ roomId, candidate }) => {
    const id = roomId?.toUpperCase();
    const room = rooms.get(id);
    if (!room) return;
    const targetId = socket.role === 'host' ? room.controllerSocketId : room.hostSocketId;
    if (targetId) {
      io.to(targetId).emit('ice-candidate', { candidate, from: socket.id });
    }
  });

  // ── Remote Control Events ─────────────────────────────────────
  // Controller sends touch/input events → host
  socket.on('remote-touch', ({ roomId, event }) => {
    const id = roomId?.toUpperCase();
    const room = rooms.get(id);
    if (room?.hostSocketId) {
      io.to(room.hostSocketId).emit('remote-touch', { event });
    }
  });

  // Controller sends keyboard text → host
  socket.on('remote-keyboard', ({ roomId, text }) => {
    const id = roomId?.toUpperCase();
    const room = rooms.get(id);
    if (room?.hostSocketId) {
      io.to(room.hostSocketId).emit('remote-keyboard', { text });
    }
  });

  // ── Screen Share Status ───────────────────────────────────────
  socket.on('screen-share-status', ({ roomId, status }) => {
    const id = roomId?.toUpperCase();
    const room = rooms.get(id);
    if (room?.controllerSocketId) {
      io.to(room.controllerSocketId).emit('screen-share-status', { status });
    }
  });

  // ── Disconnect Handling ───────────────────────────────────────
  socket.on('leave-room', () => {
    handleDisconnect(socket);
  });

  socket.on('disconnect', () => {
    handleDisconnect(socket);
    console.log(`❌ Client disconnected: ${socket.id}`);
  });
});

function handleDisconnect(socket) {
  const roomId = socket.roomId;
  if (!roomId) return;

  const room = rooms.get(roomId);
  if (!room) return;

  if (socket.role === 'host') {
    room.hostSocketId = null;
    if (room.controllerSocketId) {
      io.to(room.controllerSocketId).emit('host-disconnected', { roomId });
    }
    // If both gone, clean up
    if (!room.controllerSocketId) rooms.delete(roomId);
  } else if (socket.role === 'controller') {
    room.controllerSocketId = null;
    if (room.hostSocketId) {
      io.to(room.hostSocketId).emit('controller-disconnected', { roomId });
    }
    if (!room.hostSocketId) rooms.delete(roomId);
  }

  socket.leave(roomId);
  console.log(`🚪 ${socket.role} left room: ${roomId}`);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Remote Access Server running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
});
