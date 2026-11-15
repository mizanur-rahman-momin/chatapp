/* ==========================================================================
   Camera Snapshot Helper Module (Direct Native Access)
   ========================================================================== */

const MediaHelper = {
  activeStream: null,
  capturedBlob: null,

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

  currentFacingMode: 'user', // 'user' (webcam/selfie) or 'environment'

  init(chatManager) {
    this.chatManager = chatManager;

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
    if (this.cameraBtn) {
      this.cameraBtn.addEventListener('click', () => this.openCamera());
    }
    if (this.cameraCloseBtn) {
      this.cameraCloseBtn.addEventListener('click', () => this.closeCamera());
    }
    if (this.btnSnapPhoto) {
      this.btnSnapPhoto.addEventListener('click', () => this.takeSnapshot());
    }
    if (this.btnRetakePhoto) {
      this.btnRetakePhoto.addEventListener('click', () => this.retakeSnapshot());
    }
    if (this.btnSendPhoto) {
      this.btnSendPhoto.addEventListener('click', () => this.sendSnapshot());
    }
    if (this.cameraSwitchBtn) {
      this.cameraSwitchBtn.addEventListener('click', () => this.switchCameraFacing());
    }
  },

  /* ------------------------------------------------------------------------
     Direct Camera Viewfinder (Laptop / Mobile Camera Capture)
     ------------------------------------------------------------------------ */
  async openCamera() {
    this.cameraModal.classList.remove('hidden');
    this.cameraLoading.classList.remove('hidden');
    this.snapshotVideo.classList.remove('hidden');
    this.snapshotPreview.classList.add('hidden');
    this.captureControls.classList.remove('hidden');
    this.previewControls.classList.add('hidden');

    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: this.currentFacingMode }
      });
    } catch (e1) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      } catch (e2) {
        console.error('Camera open failed:', e2);
      }
    }

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

    // Check if device has multiple cameras (e.g. mobile front/back)
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
    if (wrap) {
      wrap.classList.add('flash-effect');
      setTimeout(() => wrap.classList.remove('flash-effect'), 300);
    }

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
        }
      } catch (err) {
        console.error('Camera upload error:', err);
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
