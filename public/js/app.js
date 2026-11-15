/* ==========================================================================
   Main Application Controller & State
   ========================================================================== */

class App {
  constructor() {
    this.user = null;
    this.partner = null;
    this.socket = null;
    this.chatManager = null;
    this.webrtcManager = null;

    this.isPartnerOnline = false;
    this.isPartnerTyping = false;
    this.typingTimeout = null;

    // DOM Elements
    this.loginScreen = document.getElementById('login-screen');
    this.chatScreen = document.getElementById('chat-screen');
    this.loginForm = document.getElementById('login-form');
    this.pinInput = document.getElementById('pin-input');
    this.loginError = document.getElementById('login-error');
    this.loginBtn = document.getElementById('login-btn');

    this.partnerNameEl = document.getElementById('partner-name');
    this.partnerAvatarEl = document.getElementById('partner-avatar');
    this.partnerStatusEl = document.getElementById('partner-status');
    this.startCallBtn = document.getElementById('start-call-btn');
    this.logoutBtn = document.getElementById('logout-btn');

    this.init();
  }

  async init() {
    this.initAuthEvents();
    // Check if user already has an active session cookie
    try {
      const res = await fetch('/api/me');
      if (res.ok) {
        const data = await res.json();
        this.setupSession(data.user, data.partner);
      } else {
        this.showLogin();
      }
    } catch (err) {
      this.showLogin();
    }
  }

  initAuthEvents() {
    this.loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pin = this.pinInput.value.trim();
      if (!pin) return;

      this.loginError.textContent = '';
      this.loginBtn.disabled = true;
      this.loginBtn.textContent = 'Verifying...';

      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          this.setupSession(data.user, data.partner, data.token);
        } else {
          this.loginError.textContent = data.error || 'Invalid PIN. Try again.';
          this.pinInput.focus();
        }
      } catch (err) {
        this.loginError.textContent = 'Server connection error. Please retry.';
      } finally {
        this.loginBtn.disabled = false;
        this.loginBtn.textContent = 'Open Chat';
      }
    });

    this.logoutBtn.addEventListener('click', async () => {
      try {
        await fetch('/api/logout', { method: 'POST' });
      } catch (e) {}
      window.location.reload();
    });

    this.startCallBtn.addEventListener('click', () => {
      if (this.webrtcManager) {
        this.webrtcManager.startCall();
      }
    });
  }

  showLogin() {
    this.chatScreen.classList.add('hidden');
    this.loginScreen.classList.remove('hidden');
    this.pinInput.focus();
  }

  setupSession(user, partner, token = null) {
    this.user = user;
    this.partner = partner;

    // Update Header
    this.partnerNameEl.textContent = partner.name;
    this.partnerAvatarEl.textContent = partner.name.charAt(0).toUpperCase();
    document.title = `ChatApp - ${partner.name}`;

    // Show Chat screen
    this.loginScreen.classList.add('hidden');
    this.chatScreen.classList.remove('hidden');

    // Connect Socket.io
    const socketOptions = {
      transports: ['websocket', 'polling']
    };
    if (token) {
      socketOptions.auth = { token };
    }
    this.socket = io(socketOptions);

    this.initSocketEvents();

    // Initialize Managers
    this.chatManager = new ChatManager(this.socket, this.user, this.partner);
    window.chatInstance = this.chatManager;

    if (window.MediaHelper) {
      window.MediaHelper.init(this.chatManager);
    }

    this.webrtcManager = new WebRTCManager(this.socket, this.user, this.partner);
    window.webrtcInstance = this.webrtcManager;
  }

  initSocketEvents() {
    // Initial presence status
    this.socket.on('presence:status', (data) => {
      this.isPartnerOnline = !!data.isOnline;
      this.updatePresenceUI();
    });

    // Dynamic presence updates
    this.socket.on('presence:update', (data) => {
      if (data.userId === this.partner.id) {
        this.isPartnerOnline = !!data.isOnline;
        this.updatePresenceUI();
      }
    });

    // Partner typing notification
    this.socket.on('chat:partner_typing', (data) => {
      this.isPartnerTyping = !!data.isTyping;
      this.updatePresenceUI();
    });

    this.socket.on('connect_error', (err) => {
      console.warn('Socket connect error:', err.message);
    });
  }

  updatePresenceUI() {
    if (this.isPartnerTyping) {
      this.partnerStatusEl.textContent = 'typing...';
      this.partnerStatusEl.className = 'status-indicator typing';
    } else if (this.isPartnerOnline) {
      this.partnerStatusEl.textContent = 'online';
      this.partnerStatusEl.className = 'status-indicator online';
    } else {
      this.partnerStatusEl.textContent = 'offline';
      this.partnerStatusEl.className = 'status-indicator';
    }
  }

  sendTypingStatus() {
    if (!this.socket) return;
    this.socket.emit('chat:typing', { isTyping: true });

    clearTimeout(this.typingTimeout);
    this.typingTimeout = setTimeout(() => {
      this.stopTyping();
    }, 1500);
  }

  stopTyping() {
    clearTimeout(this.typingTimeout);
    if (this.socket) {
      this.socket.emit('chat:typing', { isTyping: false });
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.appInstance = new App();
});

