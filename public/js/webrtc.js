/* ==========================================================================
   WebRTC Video Calling Module
   ========================================================================== */

class WebRTCManager {
  constructor(socket, user, partner) {
    this.socket = socket;
    this.user = user;
    this.partner = partner;

    this.peerConnection = null;
    this.localStream = null;
    this.remoteStream = null;
    this.facingMode = 'user'; // 'user' (front) or 'environment' (back)
    this.isMuted = false;
    this.isVideoOff = false;
    this.callActive = false;
    this.callTimerInterval = null;
    this.callStartTime = null;

    // Web Audio Synthesizer for ringtones
    this.audioCtx = null;
    this.ringtoneInterval = null;

    // DOM Elements
    this.callScreen = document.getElementById('call-screen');
    this.incomingModal = document.getElementById('incoming-call-modal');
    this.remoteVideo = document.getElementById('remote-video');
    this.localVideo = document.getElementById('local-video');
    this.callAvatar = document.getElementById('call-avatar');
    this.callPartnerName = document.getElementById('call-partner-name');
    this.callStatus = document.getElementById('call-status');

    this.btnToggleMic = document.getElementById('btn-toggle-mic');
    this.btnToggleCamera = document.getElementById('btn-toggle-camera');
    this.btnSwitchCamera = document.getElementById('btn-switch-camera');
    this.btnEndCall = document.getElementById('btn-end-call');

    this.incomingAvatar = document.getElementById('incoming-caller-avatar');
    this.incomingName = document.getElementById('incoming-caller-name');
    this.btnAcceptCall = document.getElementById('btn-accept-call');
    this.btnRejectCall = document.getElementById('btn-reject-call');

    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
      ]
    };

    this.initSocketEvents();
    this.initUIEvents();
  }

  initUIEvents() {
    this.btnToggleMic.addEventListener('click', () => this.toggleMic());
    this.btnToggleCamera.addEventListener('click', () => this.toggleCamera());
    this.btnSwitchCamera.addEventListener('click', () => this.switchCamera());
    this.btnEndCall.addEventListener('click', () => this.endCall(true));

    this.btnAcceptCall.addEventListener('click', () => this.acceptIncomingCall());
    this.btnRejectCall.addEventListener('click', () => this.rejectIncomingCall());
  }

  initSocketEvents() {
    // Partner is calling us
    this.socket.on('call:incoming', (data) => {
      this.handleIncomingCall(data);
    });

    // Partner accepted our call
    this.socket.on('call:accepted', async () => {
      this.stopRingtone();
      this.callStatus.textContent = 'Connecting media...';
      try {
        const offer = await this.peerConnection.createOffer();
        await this.peerConnection.setLocalDescription(offer);
        this.socket.emit('call:offer', { to: this.partner.id, sdp: offer });
      } catch (err) {
        console.error('Error creating SDP offer:', err);
        this.endCall(true);
      }
    });

    // Received SDP offer (we are receiver)
    this.socket.on('call:offer', async (data) => {
      try {
        if (!this.peerConnection) {
          await this.setupPeerConnection();
        }
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);
        this.socket.emit('call:answer', { to: this.partner.id, sdp: answer });
        this.startCallTimer();
      } catch (err) {
        console.error('Error handling SDP offer:', err);
        this.endCall(true);
      }
    });

    // Received SDP answer (we are caller)
    this.socket.on('call:answer', async (data) => {
      try {
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        this.startCallTimer();
      } catch (err) {
        console.error('Error handling SDP answer:', err);
      }
    });

    // Received ICE Candidate
    this.socket.on('call:ice-candidate', async (data) => {
      try {
        if (this.peerConnection && data.candidate) {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
      } catch (err) {
        console.error('Error adding ICE candidate:', err);
      }
    });

    // Partner rejected the call
    this.socket.on('call:rejected', (data) => {
      this.stopRingtone();
      this.callStatus.textContent = data.reason || 'Call declined';
      setTimeout(() => this.cleanupCall(), 1500);
    });

    // Partner is offline / unavailable
    this.socket.on('call:unavailable', (data) => {
      this.stopRingtone();
      this.callStatus.textContent = data.reason || 'Partner offline';
      setTimeout(() => this.cleanupCall(), 1500);
    });

    // Call ended by partner
    this.socket.on('call:ended', () => {
      this.stopRingtone();
      this.cleanupCall();
    });
  }

  // Audio tone synthesizer using Web Audio API
  playTone(freq1, freq2, duration, type = 'sine') {
    try {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      const osc1 = this.audioCtx.createOscillator();
      const osc2 = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc1.type = type;
      osc2.type = type;
      osc1.frequency.value = freq1;
      osc2.frequency.value = freq2;

      gain.gain.setValueAtTime(0.08, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + duration);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc1.start();
      osc2.start();
      osc1.stop(this.audioCtx.currentTime + duration);
      osc2.stop(this.audioCtx.currentTime + duration);
    } catch (e) {
      // Audio autoplay policy fallback
    }
  }

  startIncomingRingtone() {
    this.stopRingtone();
    const playRing = () => {
      this.playTone(440, 480, 1.2);
    };
    playRing();
    this.ringtoneInterval = setInterval(playRing, 2500);
  }

  startOutgoingDialtone() {
    this.stopRingtone();
    const playDial = () => {
      this.playTone(400, 450, 1.0);
    };
    playDial();
    this.ringtoneInterval = setInterval(playDial, 3000);
  }

  stopRingtone() {
    if (this.ringtoneInterval) {
      clearInterval(this.ringtoneInterval);
      this.ringtoneInterval = null;
    }
  }

  // Start outgoing call
  async startCall() {
    this.callPartnerName.textContent = this.partner.name;
    this.callAvatar.textContent = this.partner.name.charAt(0).toUpperCase();
    this.callStatus.textContent = 'Calling...';
    this.callScreen.classList.remove('hidden');

    const streamReady = await this.getMediaStream();
    if (!streamReady) {
      this.callStatus.textContent = 'Camera/Microphone access denied';
      setTimeout(() => this.cleanupCall(), 2500);
      return;
    }

    await this.setupPeerConnection();
    this.startOutgoingDialtone();
    this.socket.emit('call:initiate', { to: this.partner.id, isVideo: true });
  }

  // Handle incoming call notification
  handleIncomingCall(data) {
    this.incomingName.textContent = data.callerName || this.partner.name;
    this.incomingAvatar.textContent = (data.callerName || this.partner.name).charAt(0).toUpperCase();
    this.incomingModal.classList.remove('hidden');
    this.startIncomingRingtone();
  }

  async acceptIncomingCall() {
    this.stopRingtone();
    this.incomingModal.classList.add('hidden');

    this.callPartnerName.textContent = this.partner.name;
    this.callAvatar.textContent = this.partner.name.charAt(0).toUpperCase();
    this.callStatus.textContent = 'Connecting...';
    this.callScreen.classList.remove('hidden');

    const streamReady = await this.getMediaStream();
    if (!streamReady) {
      this.socket.emit('call:reject', { to: this.partner.id, reason: 'Media access failed' });
      this.cleanupCall();
      return;
    }

    await this.setupPeerConnection();
    this.socket.emit('call:accept', { to: this.partner.id });
  }

  rejectIncomingCall() {
    this.stopRingtone();
    this.incomingModal.classList.add('hidden');
    this.socket.emit('call:reject', { to: this.partner.id, reason: 'Declined' });
  }

  async getMediaStream() {
    try {
      if (this.localStream) {
        this.localStream.getTracks().forEach(t => t.stop());
      }

      const stream = await MediaHelper.requestMedia({
        audio: true,
        video: {
          facingMode: this.facingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        title: 'Camera & Microphone Needed',
        description: 'ChatApp needs access to your camera and microphone to start this video call with your partner.'
      });

      if (!stream) {
        return false;
      }

      this.localStream = stream;
      this.localVideo.srcObject = this.localStream;
      return true;
    } catch (err) {
      console.error('Error accessing camera/mic:', err);
      return false;
    }
  }

  async setupPeerConnection() {
    this.peerConnection = new RTCPeerConnection(this.rtcConfig);

    // Add local tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        this.peerConnection.addTrack(track, this.localStream);
      });
    }

    // Handle remote tracks
    this.remoteStream = new MediaStream();
    this.remoteVideo.srcObject = this.remoteStream;

    this.peerConnection.ontrack = (event) => {
      event.streams[0].getTracks().forEach(track => {
        this.remoteStream.addTrack(track);
      });
    };

    // Handle ICE candidates
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('call:ice-candidate', {
          to: this.partner.id,
          candidate: event.candidate
        });
      }
    };

    // Connection state monitoring
    this.peerConnection.onconnectionstatechange = () => {
      if (this.peerConnection.connectionState === 'connected') {
        this.callStatus.textContent = 'Connected';
      } else if (this.peerConnection.connectionState === 'disconnected' ||
                 this.peerConnection.connectionState === 'failed') {
        this.callStatus.textContent = 'Call lost';
        setTimeout(() => this.cleanupCall(), 1500);
      }
    };
  }

  startCallTimer() {
    this.callStartTime = Date.now();
    this.callActive = true;
    clearInterval(this.callTimerInterval);
    this.callTimerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.callStartTime) / 1000);
      const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const secs = String(elapsed % 60).padStart(2, '0');
      this.callStatus.textContent = `${mins}:${secs}`;
    }, 1000);
  }

  toggleMic() {
    if (!this.localStream) return;
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      this.isMuted = !this.isMuted;
      audioTrack.enabled = !this.isMuted;
      this.btnToggleMic.classList.toggle('muted', this.isMuted);
    }
  }

  toggleCamera() {
    if (!this.localStream) return;
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      this.isVideoOff = !this.isVideoOff;
      videoTrack.enabled = !this.isVideoOff;
      this.btnToggleCamera.classList.toggle('muted', this.isVideoOff);
    }
  }

  async switchCamera() {
    if (!this.localStream) return;
    this.facingMode = this.facingMode === 'user' ? 'environment' : 'user';
    await this.getMediaStream();
    if (this.peerConnection && this.localStream) {
      const videoTrack = this.localStream.getVideoTracks()[0];
      const sender = this.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender && videoTrack) {
        sender.replaceTrack(videoTrack);
      }
    }
  }

  endCall(notifyPartner = true) {
    if (notifyPartner) {
      this.socket.emit('call:hangup');
    }
    this.cleanupCall();
  }

  cleanupCall() {
    this.stopRingtone();
    clearInterval(this.callTimerInterval);
    this.callTimerInterval = null;
    this.callActive = false;

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    this.remoteVideo.srcObject = null;
    this.localVideo.srcObject = null;

    this.callScreen.classList.add('hidden');
    this.incomingModal.classList.add('hidden');

    this.isMuted = false;
    this.isVideoOff = false;
    this.btnToggleMic.classList.remove('muted');
    this.btnToggleCamera.classList.remove('muted');
  }
}

window.WebRTCManager = WebRTCManager;

