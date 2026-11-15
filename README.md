# ChatApp (Private 2-User Edition)

An ultra-lightweight, private web messenger built exclusively for two people. It features real-time text chat, image sharing, and peer-to-peer 1-on-1 WebRTC video calling.

---

## Highlights

- **Ultra-Lightweight**: Built with Node.js v24 native SQLite (`node:sqlite`) and pure vanilla HTML5/CSS3/JavaScript. No React, no Webpack, no heavy build pipelines. Consumes ~30-50MB RAM on your VPS.
- **Clean Modern Design**: Familiar dark mode styling with chat bubbles, timestamps, double checkmarks (blue for read), auto-growing message input, and audio cues.
- **Image Sharing**: Drag-and-drop, clipboard paste (Ctrl+V), or file picker with instant preview, auto-upload, and full-screen lightbox.
- **1-on-1 Video Calling**: Native WebRTC with public STUN servers. Ringtone sounds (synthesized via Web Audio API), full-screen partner video, picture-in-picture local self-view, mic mute, camera toggle, and front/rear camera switching on mobile.
- **Persistent Session**: 90-day "Remember Me" session cookies so you and your partner stay logged in on your phone and desktop browsers.

---

## Quick Start

### 1. Configure `.env`
Edit `.env` to set your desired names and PINs:
```env
PORT=3000
SESSION_SECRET=choose-a-random-secret-key-12345

# User 1 (You)
USER1_NAME=Me
USER1_PIN=1122

# User 2 (Partner)
USER2_NAME=Her
USER2_PIN=3344
```

### 2. Start the Server
```bash
npm start
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Deploying to Your VPS

> [!IMPORTANT]
> **WebRTC Camera & Microphone Requires HTTPS**:
> Modern mobile and desktop browsers (iOS Safari, Chrome, Firefox) will block camera and microphone permissions on remote servers unless the connection is encrypted with **HTTPS** (or running on `localhost`).

### Option A: Caddy (Recommended - Easiest & Auto-SSL)
1. Install Caddy on your VPS (`sudo apt install caddy`).
2. Point your domain (e.g. `chat.yourdomain.com`) to your VPS IP address in your DNS settings.
3. Put the following in `/etc/caddy/Caddyfile`:
   ```caddyfile
   chat.yourdomain.com {
       reverse_proxy 127.0.0.1:3000
   }
   ```
4. Reload Caddy: `sudo systemctl reload caddy`. Caddy will automatically issue and renew a free Let's Encrypt SSL certificate!

### Option B: Nginx + Certbot
A ready-to-use Nginx template is provided in `deployment/nginx.conf`.
1. Copy `deployment/nginx.conf` to `/etc/nginx/sites-available/chat`.
2. Link it: `sudo ln -s /etc/nginx/sites-available/chat /etc/nginx/sites-enabled/`.
3. Run `sudo certbot --nginx -d chat.yourdomain.com`.
4. Reload Nginx: `sudo systemctl reload nginx`.

### Running in Background 24/7 (Systemd)
Copy the service file to keep the app running continuously across reboots:
```bash
sudo cp deployment/chat.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now chat
```
Check status:
```bash
sudo systemctl status chat
```

---

## Project Structure
```
├── server.js              # Express + Socket.io + Auth & Upload endpoints
├── db.js                  # Database manager using Node.js native sqlite
├── package.json           # Minimal dependencies
├── .env                   # Configuration (Ports, PINs, Usernames)
├── public/                # Frontend web application
│   ├── index.html         # Single-page interface
│   ├── css/
│   │   └── style.css      # Dark theme styling
│   └── js/
│       ├── app.js         # Auth state, presence, and session controller
│       ├── chat.js        # Message rendering, image upload & lightbox
│       └── webrtc.js      # WebRTC 1-on-1 video call & audio synthesizer
├── deployment/
│   ├── Caddyfile          # Caddy reverse proxy template
│   ├── nginx.conf         # Nginx reverse proxy template
│   └── chat.service       # Systemd service unit
└── uploads/               # Shared media storage
```

