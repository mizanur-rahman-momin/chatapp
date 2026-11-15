/* ==========================================================================
   Chat & Image Management Module
   ========================================================================== */

class ChatManager {
  constructor(socket, user, partner) {
    this.socket = socket;
    this.user = user;
    this.partner = partner;

    this.pendingImageFile = null;
    this.lastRenderedDate = null;
    this.audioCtx = null;

    // DOM Elements
    this.messagesContainer = document.getElementById('messages-container');
    this.messageForm = document.getElementById('message-form');
    this.messageInput = document.getElementById('message-input');
    this.fileInput = document.getElementById('file-input');
    this.attachBtn = document.getElementById('attach-btn');

    this.previewBar = document.getElementById('image-preview-bar');
    this.previewThumbnail = document.getElementById('preview-thumbnail');
    this.previewFilename = document.getElementById('preview-filename');
    this.cancelUploadBtn = document.getElementById('cancel-upload-btn');

    this.lightboxModal = document.getElementById('lightbox-modal');
    this.lightboxImg = document.getElementById('lightbox-img');
    this.lightboxClose = document.getElementById('lightbox-close');
    this.lightboxDownload = document.getElementById('lightbox-download');

    // Clear Chat Elements
    this.clearChatBtn = document.getElementById('clear-chat-btn');
    this.clearChatModal = document.getElementById('clear-chat-modal');
    this.btnCancelClear = document.getElementById('btn-cancel-clear');
    this.btnConfirmClear = document.getElementById('btn-confirm-clear');

    this.initUIEvents();
    this.initSocketEvents();
    this.loadChatHistory();
  }

  initUIEvents() {
    // Send message form
    this.messageForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSendMessage();
    });

    // Auto-growing textarea & Enter to send
    this.messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleSendMessage();
      }
    });

    this.messageInput.addEventListener('input', () => {
      this.messageInput.style.height = 'auto';
      this.messageInput.style.height = Math.min(this.messageInput.scrollHeight, 120) + 'px';
      this.notifyTyping();
    });

    // Clear chat modal events
    if (this.clearChatBtn) {
      this.clearChatBtn.addEventListener('click', () => this.showClearChatModal());
    }
    if (this.btnCancelClear) {
      this.btnCancelClear.addEventListener('click', () => this.hideClearChatModal());
    }
    if (this.btnConfirmClear) {
      this.btnConfirmClear.addEventListener('click', () => this.clearChatFromScreen());
    }

    // Attachment button click
    this.attachBtn.addEventListener('click', () => {
      this.fileInput.click();
    });

    // File selected via input
    this.fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        this.setSelectedImage(file);
      }
    });

    // Cancel pending image upload
    this.cancelUploadBtn.addEventListener('click', () => {
      this.clearPendingImage();
    });

    // Lightbox close
    this.lightboxClose.addEventListener('click', () => {
      this.lightboxModal.classList.add('hidden');
    });

    this.lightboxModal.addEventListener('click', (e) => {
      if (e.target === this.lightboxModal || e.target.classList.contains('lightbox-body')) {
        this.lightboxModal.classList.add('hidden');
      }
    });

    // Drag and Drop support onto chat container
    const container = document.querySelector('.chat-container');
    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    container.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const files = e.dataTransfer?.files;
      if (files && files.length > 0 && files[0].type.startsWith('image/')) {
        this.setSelectedImage(files[0]);
      }
    });

    // Paste image from clipboard (Ctrl+V / Cmd+V)
    window.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            this.setSelectedImage(file);
            break;
          }
        }
      }
    });
  }

  initSocketEvents() {
    // New message arrived
    this.socket.on('chat:message', (message) => {
      this.appendMessage(message);
      this.scrollToBottom();

      if (message.sender_id !== this.user.id) {
        this.playMessageSound();
        // Mark as read
        this.socket.emit('chat:mark_read');
      }
    });

    // Partner marked messages as read
    this.socket.on('chat:messages_read', () => {
      const ticks = this.messagesContainer.querySelectorAll('.bubble-ticks.sent');
      ticks.forEach(t => {
        t.classList.remove('sent');
        t.classList.add('read');
      });
    });
  }

  // Play subtle incoming message pop sound
  playMessageSound() {
    try {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, this.audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(400, this.audioCtx.currentTime + 0.12);

      gain.gain.setValueAtTime(0.1, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.12);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.12);
    } catch (e) {}
  }

  // Clear chat screen management (preserves backend database backup)
  getClearedStorageKey() {
    return `chatapp_cleared_at_user_${this.user.id}`;
  }

  showClearChatModal() {
    if (this.clearChatModal) {
      this.clearChatModal.classList.remove('hidden');
    }
  }

  hideClearChatModal() {
    if (this.clearChatModal) {
      this.clearChatModal.classList.add('hidden');
    }
  }

  clearChatFromScreen() {
    localStorage.setItem(this.getClearedStorageKey(), new Date().toISOString());
    this.hideClearChatModal();
    this.messagesContainer.innerHTML = '';
    this.lastRenderedDate = null;
  }

  // Load message history from REST API
  async loadChatHistory() {
    try {
      const res = await fetch('/api/messages?limit=250');
      if (res.ok) {
        const data = await res.json();
        this.messagesContainer.innerHTML = '';
        this.lastRenderedDate = null;

        const clearedAtStr = localStorage.getItem(this.getClearedStorageKey());
        let messagesToRender = data.messages || [];

        if (clearedAtStr) {
          const clearedTime = new Date(clearedAtStr).getTime();
          messagesToRender = messagesToRender.filter(msg => new Date(msg.created_at).getTime() > clearedTime);
        }

        messagesToRender.forEach(msg => this.appendMessage(msg));
        this.scrollToBottom();

        // Mark any unread messages from partner as read
        this.socket.emit('chat:mark_read');
      }
    } catch (err) {
      console.error('Failed to load chat history:', err);
    }
  }

  // Set selected image for upload
  setSelectedImage(file) {
    this.pendingImageFile = file;
    this.previewFilename.textContent = file.name;
    const reader = new FileReader();
    reader.onload = (e) => {
      this.previewThumbnail.src = e.target.result;
      this.previewBar.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
    this.messageInput.focus();
  }

  clearPendingImage() {
    this.pendingImageFile = null;
    this.fileInput.value = '';
    this.previewBar.classList.add('hidden');
    this.previewThumbnail.src = '';
  }

  // Send message handler (text or uploaded image)
  async handleSendMessage() {
    const text = this.messageInput.value.trim();

    // 1. If an image is pending, upload it first
    if (this.pendingImageFile) {
      const fileToSend = this.pendingImageFile;
      this.clearPendingImage();

      const formData = new FormData();
      formData.append('image', fileToSend);

      try {
        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData
        });
        if (res.ok) {
          const data = await res.json();
          this.socket.emit('chat:send', {
            type: 'image',
            content: data.url
          });
        } else {
          alert('Failed to upload image. Please try again.');
        }
      } catch (err) {
        console.error('Image upload error:', err);
        alert('Image upload failed.');
      }
    }

    // 2. If text was entered, send it
    if (text) {
      this.socket.emit('chat:send', {
        type: 'text',
        content: text
      });
      this.messageInput.value = '';
      this.messageInput.style.height = 'auto';
    }

    // Stop typing indicator
    if (window.appInstance) {
      window.appInstance.stopTyping();
    }
  }

  notifyTyping() {
    if (window.appInstance) {
      window.appInstance.sendTypingStatus();
    }
  }

  // Render a message in the message stream
  appendMessage(message) {
    const isOutgoing = message.sender_id === this.user.id;
    const dateObj = new Date(message.created_at);

    // Date header (e.g., Today, Yesterday, or formatted date)
    const dateStr = this.formatDateHeader(dateObj);
    if (dateStr !== this.lastRenderedDate) {
      this.lastRenderedDate = dateStr;
      const dateEl = document.createElement('div');
      dateEl.className = 'date-separator';
      dateEl.textContent = dateStr;
      this.messagesContainer.appendChild(dateEl);
    }

    // Create Bubble
    const bubble = document.createElement('div');
    bubble.className = `message-bubble ${isOutgoing ? 'outgoing' : 'incoming'}`;
    bubble.dataset.id = message.id;

    // Content: text or image
    let contentHtml = '';
    if (message.type === 'image') {
      contentHtml = `
        <div class="message-image-container" onclick="window.chatInstance.openLightbox('${message.content}')">
          <img src="${message.content}" alt="Shared image" loading="lazy">
        </div>
      `;
    } else {
      contentHtml = `<span class="message-text">${this.formatText(message.content)}</span>`;
    }

    // Double checkmarks for outgoing
    let ticksHtml = '';
    if (isOutgoing) {
      const isRead = message.is_read;
      ticksHtml = `
        <span class="bubble-ticks ${isRead ? 'read' : 'sent'}">
          <svg viewBox="0 0 16 11" fill="currentColor">
            <path d="M11.07 0.95L4.72 7.3 1.93 4.51 0.5 5.94 4.72 10.16 12.5 2.38z"/>
            <path d="M14.5 2.38L8.28 8.6 7.42 7.74 6.71 8.45 8.28 10.02 15.92 2.38z"/>
          </svg>
        </span>
      `;
    }

    const timeStr = this.formatTime(dateObj);

    bubble.innerHTML = `
      ${contentHtml}
      <div class="bubble-meta">
        <span class="bubble-time">${timeStr}</span>
        ${ticksHtml}
      </div>
    `;

    this.messagesContainer.appendChild(bubble);
  }

  openLightbox(imageUrl) {
    this.lightboxImg.src = imageUrl;
    this.lightboxDownload.href = imageUrl;
    this.lightboxModal.classList.remove('hidden');
  }

  scrollToBottom() {
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  // Format plain text into safe HTML with link auto-detection
  formatText(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    let safe = div.innerHTML;

    // Auto-link URLs
    const urlPattern = /(\b(https?|ftp):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/gim;
    safe = safe.replace(urlPattern, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color: #53bdeb; text-decoration: underline;">$1</a>');

    // Convert newlines to <br>
    return safe.replace(/\n/g, '<br>');
  }

  formatTime(date) {
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${hours}:${minutes} ${ampm}`;
  }

  formatDateHeader(date) {
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    }
    if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    }
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
}

window.ChatManager = ChatManager;

