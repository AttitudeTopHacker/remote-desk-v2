# RemoteDesk — Web-to-Web Remote Access System

A browser-based remote access system that lets a **Controller** device view and control an **Android** device's screen in real-time, using **WebRTC** for P2P video streaming and **Socket.io** for signaling and remote commands.

---

## 📁 Project Structure

```
remote desk/
├── public/                  ← Frontend (deploy on Netlify)
│   ├── index.html           ← Home page (Create/Join room)
│   ├── controller.html      ← Controller view (video + controls)
│   ├── android.html         ← Android host view (screen share)
│   ├── css/
│   │   └── style.css        ← Responsive dark UI
│   └── js/
│       ├── socket.js        ← Socket.io singleton
│       ├── webrtc.js        ← WebRTC P2P helpers
│       ├── controller.js    ← Controller page logic
│       └── android.js       ← Android host logic
├── server/                  ← Backend (deploy on Render/Railway)
│   ├── server.js            ← Express + Socket.io server
│   └── package.json
├── netlify.toml             ← Netlify proxy config
├── .env.example             ← Environment variable template
└── README.md
```

---

## 🚀 Quick Start (Local)

### 1. Install backend dependencies
```bash
cd server
npm install
```

### 2. Configure environment
```bash
cp ../.env.example .env
# Edit .env → set ALLOWED_ORIGINS if needed
```

### 3. Start the server
```bash
npm start
# Server runs at http://localhost:3000
```

### 4. Open the app
Visit `http://localhost:3000` in your browser.

---

## 🔄 User Flow

| Step | Device | Action |
|------|--------|--------|
| 1 | Controller (PC/laptop) | Open site → **Create Room** → gets an 8-char Room ID |
| 2 | Android (mobile browser) | Open site → **Join Room** → enter the Room ID |
| 3 | Android | Tap **Start Screen Share** → browser asks permission |
| 4 | Controller | Screen appears in the video panel; use mouse/touch to control |
| 5 | Either | Click **Disconnect** to end the session |

---

## 🎮 Controller Features

| Gesture | What it does |
|---------|--------------|
| Click | Tap on Android |
| Drag | Swipe |
| Scroll wheel | Scroll up/down |
| Double-click | Double tap |
| Keyboard textarea | Send text to Android |
| Quick buttons | Home / Back / Recent / Volume |

---

## ☁️ Deployment

### Backend (Render / Railway)
1. Push the `server/` folder (or whole repo) to GitHub
2. Create a new Web Service on Render → set **Start Command** to `node server.js`
3. Add environment variables: `PORT`, `NODE_ENV=production`, `ALLOWED_ORIGINS`
4. Copy the deployed URL (e.g. `https://remotedesk-api.onrender.com`)

### Frontend (Netlify)
1. Edit `netlify.toml` — replace `your-render-backend.onrender.com` with your actual backend URL
2. Push the `public/` folder to GitHub
3. Connect to Netlify → set **Publish directory** to `public`
4. Deploy ✅

---

## 🔒 Security Notes

- Each session uses a unique 8-char Room ID
- Rooms auto-expire after 2 hours of inactivity
- CORS is restricted to configured origins in production
- Use HTTPS for both Netlify and Render (enabled by default)

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML5, CSS3, Vanilla JS |
| Real-time | Socket.io 4.x |
| P2P Video | WebRTC (getDisplayMedia) |
| Backend | Node.js + Express |
| Frontend Host | Netlify |
| Backend Host | Render / Railway |
