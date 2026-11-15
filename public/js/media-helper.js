/* ==========================================================================
   Media Permissions & Camera Snapshot Helper Module
   ========================================================================== */

const MediaHelper = {
  activeStream: null,
  capturedBlob: null,

  // DOM Elements - Permission Modal
  modal: null,
  titleEl: null,
  descEl: null,
  guideEl: null,
  allowBtn: null,
  cancelBtn: null,
  iconWrap: null,

  // DOM Elements - Camera Snapshot Modal
  cameraModal: null,
  snapshotVideo: null,
  snapshotCanvas: null,
  snapshotPreview: null,
  cameraLoading: null,
  cameraBtn: null,
  cameraCloseBtn: null,
  cameraSwitchBtn: null,
  btnSnapPhoto: null,
  btnRetakePhoto: null,
  btnSendPhoto: null,
  captureControls: null,
  previewControls: null,

  currentFacingMode: 'user', // 'user' (laptop webcam / selfie) or 'environment'

  init(chatManager) {
    this.chatManager = chatManager;

    // Permissions Modal
    this.modal = document.getElementById('permission-modal');
    this.titleEl = document.getElementById('permission-title');
    this.descEl = document.getElementById('permission-description');
    this.guideEl = document.getElementById('permission-guide');
    this.allowBtn = document.getElementById('permission-allow-btn');
    this.cancelBtn = document.getElementById('permission-cancel-btn');
    this.iconWrap = document.getElementById('permission-icon-wrap');

    // Camera Snapshot Modal
    this.cameraModal = document.getElementById('camera-modal');
    this.snapshotVideo = document.getElementById('snapshot-video');
    this.snapshotCanvas = document.getElementById('snapshot-canvas');
    this.snapshotPreview = document.getElementById('snapshot-result-preview');
    this.cameraLoading = document.getElementById('camera-loading');
    this.cameraBtn = document.getElementById('camera-btn');
    this.cameraCloseBtn = document.getElementById('camera-close-btn');
    this.cameraSwitchBtn = document.getElementById('camera-switch-btn');
    this.btnSnapPhoto = document.getElementById('btn-snap-photo');
    this.btnRetakePhoto = document.getElementById('btn-retake-photo');
    this.btnSendPhoto = document.getElementById('btn-send-photo');
    this.captureControls = document.getElementById('capture-controls');
    this.previewControls = document.getElementById('preview-controls');

    this.bindEvents();
  },

  bindEvents() {
    // Open camera button in footer
    if (this.cameraBtn) {
      this.cameraBtn.addEventListener('click', () => this.openCamera());
    }

    // Close camera snapshot modal
    if (this.cameraCloseBtn) {
      this.cameraCloseBtn.addEventListener('click', () => this.closeCamera());
    }

    // Snap photo
    if (this.btnSnapPhoto) {
      this.btnSnapPhoto.addEventListener('click', () => this.takeSnapshot());
    }

    // Retake photo
    if (this.btnRetakePhoto) {
      this.btnRetakePhoto.addEventListener('click', () => this.retakeSnapshot());
    }

    // Send captured photo
    if (this.btnSendPhoto) {
      this.btnSendPhoto.addEventListener('click', () => this.sendSnapshot());
    }

    // Switch camera (if multiple cameras available)
    if (this.cameraSwitchBtn) {
      this.cameraSwitchBtn.addEventListener('click', () => this.switchCameraFacing());
    }
  },

  /* ------------------------------------------------------------------------
     Unified Permission Request Popup
     ------------------------------------------------------------------------ */
  requestMedia({ audio = false, video = true, title, description }) {
    return new Promise((resolve) => {
      // First, try directly in case permissions were already granted by browser
      navigator.mediaDevices.getUserMedia({ audio, video })
        .then(stream => {
          resolve(stream);
        })
        .catch(err => {
          // If denied, prompt blocked, or user interaction required, display friendly popup
          this.showPermissionPopup({
            audio,
            video,
            title: title || (audio && video ? 'Camera & Microphone Access' : 'Camera Access'),
            description: description || 'ChatApp needs camera access to continue.',
            error: err,
            onSuccess: (stream) => resolve(stream),
            onCancel: () => resolve(null)
          });
        });
    });
  },

  showPermissionPopup({ audio, video, title, description, error, onSuccess, onCancel }) {
    this.titleEl.textContent = title;
    this.descEl.textContent = description;
    this.modal.classList.remove('hidden');

    if (error && (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError')) {
      this.guideEl.classList.remove('hidden');
      this.allowBtn.textContent = 'Try Again';
    } else {
      this.guideEl.classList.add('hidden');
      this.allowBtn.textContent = 'Allow Access';
    }

    const cleanup = () => {
      this.modal.classList.add('hidden');
      this.allowBtn.onclick = null;
      this.cancelBtn.onclick = null;
    };

    this.cancelBtn.onclick = () => {
      cleanup();
      if (onCancel) onCancel();
    };

    this.allowBtn.onclick = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio, video });
        cleanup();
        if (onSuccess) onSuccess(stream);
      } catch (err) {
        console.warn('Permission request failed:', err);
        this.guideEl.classList.remove('hidden');
        this.allowBtn.textContent = 'Try Again';
      }
    };
  },

  /* ------------------------------------------------------------------------
     Laptop / Mobile Camera Capture View
     ------------------------------------------------------------------------ */
  async openCamera() {
    this.cameraModal.classList.remove('hidden');
    this.cameraLoading.classList.remove('hidden');
    this.snapshotVideo.classList.remove('hidden');
    this.snapshotPreview.classList.add('hidden');
    this.captureControls.classList.remove('hidden');
    this.previewControls.classList.add('hidden');

    const stream = await this.requestMedia({
      audio: false,
      video: {
        facingMode: this.currentFacingMode,
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      title: 'Camera Access Needed',
      description: 'Allow ChatApp to access your camera to take and send photos.'
    });

    if (!stream) {
      this.cameraModal.classList.add('hidden');
      return;
    }

    this.activeStream = stream;
    this.snapshotVideo.srcObject = stream;
    this.snapshotVideo.classList.toggle('mirrored', this.currentFacingMode === 'user');

    this.snapshotVideo.onloadedmetadata = () => {
      this.cameraLoading.classList.add('hidden');
      this.snapshotVideo.play().catch(e => console.warn(e));
    };

    // Check if device has multiple video cameras (e.g. mobile front/back)
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      if (videoDevices.length > 1) {
        this.cameraSwitchBtn.style.display = 'inline-flex';
      }
    } catch (e) {}
  },

  takeSnapshot() {
    if (!this.snapshotVideo || !this.activeStream) return;

    // Flash visual effect
    const wrap = document.querySelector('.camera-viewport-wrap');
    wrap.classList.add('flash-effect');
    setTimeout(() => wrap.classList.remove('flash-effect'), 300);

    const video = this.snapshotVideo;
    const canvas = this.snapshotCanvas;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    const ctx = canvas.getContext('2d');

    // If user facing / webcam, flip horizontally so photo matches preview
    if (this.currentFacingMode === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Convert canvas to Blob
    canvas.toBlob((blob) => {
      if (!blob) return;
      this.capturedBlob = blob;

      // Show preview
      const previewUrl = URL.createObjectURL(blob);
      this.snapshotPreview.src = previewUrl;
      this.snapshotVideo.classList.add('hidden');
      this.snapshotPreview.classList.remove('hidden');

      // Switch buttons to preview mode (Retake & Send)
      this.captureControls.classList.add('hidden');
      this.previewControls.classList.remove('hidden');
    }, 'image/jpeg', 0.92);
  },

  retakeSnapshot() {
    this.capturedBlob = null;
    this.snapshotPreview.classList.add('hidden');
    this.snapshotVideo.classList.remove('hidden');
    this.captureControls.classList.remove('hidden');
    this.previewControls.classList.add('hidden');
  },

  async sendSnapshot() {
    if (!this.capturedBlob) return;

    const file = new File([this.capturedBlob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
    this.closeCamera();

    // Send file using chat manager upload flow
    if (this.chatManager) {
      const formData = new FormData();
      formData.append('image', file);

      try {
        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData
        });
        if (res.ok) {
          const data = await res.json();
          this.chatManager.socket.emit('chat:send', {
            type: 'image',
            content: data.url
          });
        } else {
          alert('Failed to send camera photo.');
        }
      } catch (err) {
        console.error('Camera upload error:', err);
        alert('Could not upload camera photo.');
      }
    }
  },

  async switchCameraFacing() {
    this.currentFacingMode = this.currentFacingMode === 'user' ? 'environment' : 'user';
    if (this.activeStream) {
      this.activeStream.getTracks().forEach(t => t.stop());
    }
    await this.openCamera();
  },

  closeCamera() {
    if (this.activeStream) {
      this.activeStream.getTracks().forEach(track => track.stop());
      this.activeStream = null;
    }
    this.capturedBlob = null;
    this.snapshotVideo.srcObject = null;
    this.snapshotPreview.src = '';
    this.cameraModal.classList.add('hidden');
  }
};

window.MediaHelper = MediaHelper;

