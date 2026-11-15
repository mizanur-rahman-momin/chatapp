require('dotenv').config();
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const { Server } = require('socket.io');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const db = require('./db');

const PORT = parseInt(process.env.PORT || '3000', 10);
const SESSION_SECRET = process.env.SESSION_SECRET || 'chatapp-private-secret-change-me';

const USERS = {
  1: {
    id: 1,
    name: process.env.USER1_NAME || 'Me',
    pin: (process.env.USER1_PIN || '1122').trim(),
    partnerId: 2
  },
  2: {
    id: 2,
    name: process.env.USER2_NAME || 'Her',
    pin: (process.env.USER2_PIN || '3344').trim(),
    partnerId: 1
  }
};

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const rand = crypto.randomBytes(8).toString('hex');
    cb(null, `${Date.now()}-${rand}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG, WebP, GIF, SVG) are allowed!'));
    }
  }
});

// App & Server setup
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 1e7 // 10MB
});

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

// Authentication Helpers
function signToken(userId) {
  const payload = Buffer.from(JSON.stringify({ userId, iat: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  if (sig.length === expectedSig.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      return data;
    } catch {
      return null;
    }
  }
  return null;
}

function authMiddleware(req, res, next) {
  const token = req.cookies.auth_token || req.headers.authorization?.replace('Bearer ', '');
  const decoded = verifyToken(token);
  if (!decoded || !USERS[decoded.userId]) {
    return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }
  req.user = USERS[decoded.userId];
  next();
}

// REST Endpoints
app.post('/api/login', (req, res) => {
  const { pin } = req.body;
  if (!pin) {
    return res.status(400).json({ error: 'PIN is required' });
  }
  const cleanPin = String(pin).trim();
  let matchedUser = null;
  if (cleanPin === USERS[1].pin) {
    matchedUser = USERS[1];
  } else if (cleanPin === USERS[2].pin) {
    matchedUser = USERS[2];
  }

  if (!matchedUser) {
    return res.status(401).json({ error: 'Invalid PIN' });
  }

  const token = signToken(matchedUser.id);
  // Set cookie for 90 days (persistent session)
  res.cookie('auth_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 90 * 24 * 60 * 60 * 1000
  });

  const partner = USERS[matchedUser.partnerId];
  res.json({
    success: true,
    user: { id: matchedUser.id, name: matchedUser.name },
    partner: { id: partner.id, name: partner.name },
    token
  });
});

app.get('/api/me', authMiddleware, (req, res) => {
  const partner = USERS[req.user.partnerId];
  res.json({
    user: { id: req.user.id, name: req.user.name },
    partner: { id: partner.id, name: partner.name }
  });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.json({ success: true });
});

app.get('/api/messages', authMiddleware, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
  const offset = parseInt(req.query.offset || '0', 10);
  const messages = db.getMessages(limit, offset);
  res.json({ messages });
});

app.post('/api/upload', authMiddleware, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image uploaded' });
  }
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({
    url: fileUrl,
    filename: req.file.originalname,
    size: req.file.size
  });
});

// Socket.io Real-time & WebRTC Signaling
// Track connected sockets per user: userId -> Set of socket IDs
const userSockets = new Map([[1, new Set()], [2, new Set()]]);

function isUserOnline(userId) {
  const sockets = userSockets.get(userId);
  return !!sockets && sockets.size > 0;
}

function sendToUser(userId, event, data) {
  const sockets = userSockets.get(userId);
  if (sockets) {
    for (const sid of sockets) {
      io.to(sid).emit(event, data);
    }
  }
}

io.use((socket, next) => {
  // Extract token from cookie or handshake auth/query
  let token = socket.handshake.auth?.token;
  if (!token && socket.handshake.headers?.cookie) {
    const rawCookies = socket.handshake.headers.cookie.split(';');
    for (const c of rawCookies) {
      const [k, v] = c.trim().split('=');
      if (k === 'auth_token') {
        token = decodeURIComponent(v);
        break;
      }
    }
  }

  const decoded = verifyToken(token);
  if (!decoded || !USERS[decoded.userId]) {
    return next(new Error('Authentication failed'));
  }

  socket.userId = decoded.userId;
  socket.user = USERS[decoded.userId];
  next();
});

io.on('connection', (socket) => {
  const userId = socket.userId;
  const partnerId = socket.user.partnerId;

  // Add socket to tracker
  userSockets.get(userId).add(socket.id);

  // Broadcast presence update
  io.emit('presence:update', {
    userId,
    isOnline: true,
    partnerIsOnline: isUserOnline(partnerId)
  });

  // Client requests initial presence
  socket.emit('presence:status', {
    partnerId,
    isOnline: isUserOnline(partnerId)
  });

  // Text / Image Chat Message
  socket.on('chat:send', (payload) => {
    if (!payload || !payload.content) return;
    const type = payload.type === 'image' ? 'image' : 'text';
    const message = db.addMessage({
      sender_id: userId,
      type,
      content: payload.content
    });

    // Send to sender (to confirm saved state & id)
    socket.emit('chat:message', message);

    // Send to partner
    sendToUser(partnerId, 'chat:message', message);
  });

  // Typing Indicator
  socket.on('chat:typing', (data) => {
    sendToUser(partnerId, 'chat:partner_typing', {
      isTyping: !!data?.isTyping
    });
  });

  // Mark Messages as Read
  socket.on('chat:mark_read', () => {
    db.markAsRead(userId);
    sendToUser(partnerId, 'chat:messages_read', { readerId: userId });
  });

  // =====================
  // WebRTC Signaling
  // =====================

  // Call Initiation
  socket.on('call:initiate', (data) => {
    if (!isUserOnline(partnerId)) {
      socket.emit('call:unavailable', { reason: `${USERS[partnerId].name} is currently offline` });
      return;
    }
    sendToUser(partnerId, 'call:incoming', {
      from: userId,
      callerName: socket.user.name,
      isVideo: data?.isVideo !== false
    });
  });

  // Call Acceptance
  socket.on('call:accept', () => {
    sendToUser(partnerId, 'call:accepted', { from: userId });
  });

  // Call Rejection
  socket.on('call:reject', (data) => {
    sendToUser(partnerId, 'call:rejected', {
      from: userId,
      reason: data?.reason || 'Call declined'
    });
  });

  // SDP Offer
  socket.on('call:offer', (data) => {
    if (!data?.sdp) return;
    sendToUser(partnerId, 'call:offer', {
      from: userId,
      sdp: data.sdp
    });
  });

  // SDP Answer
  socket.on('call:answer', (data) => {
    if (!data?.sdp) return;
    sendToUser(partnerId, 'call:answer', {
      from: userId,
      sdp: data.sdp
    });
  });

  // ICE Candidate exchange
  socket.on('call:ice-candidate', (data) => {
    if (!data?.candidate) return;
    sendToUser(partnerId, 'call:ice-candidate', {
      from: userId,
      candidate: data.candidate
    });
  });

  // Hangup / End Call
  socket.on('call:hangup', () => {
    sendToUser(partnerId, 'call:ended', { from: userId });
  });

  // Disconnection
  socket.on('disconnect', () => {
    const set = userSockets.get(userId);
    if (set) {
      set.delete(socket.id);
    }
    const currentlyOnline = isUserOnline(userId);
    if (!currentlyOnline) {
      sendToUser(partnerId, 'presence:update', {
        userId,
        isOnline: false,
        partnerIsOnline: false
      });
      // Also notify call ended if user disconnected during a call
      sendToUser(partnerId, 'call:ended', { from: userId, reason: 'Disconnected' });
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(` Private ChatApp Server running on port ${PORT}`);
  console.log(` User 1: ${USERS[1].name} (PIN: ${USERS[1].pin})`);
  console.log(` User 2: ${USERS[2].name} (PIN: ${USERS[2].pin})`);
  console.log(` Local access: http://localhost:${PORT}`);
  console.log(`===============================================`);
});

