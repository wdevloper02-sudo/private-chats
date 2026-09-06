// Point this at your deployed backend URL if frontend and backend are on
// different domains. Leave as '' if they're served from the same origin
// (e.g. everything deployed together on one Render/Railway service).
const SOCKET_SERVER_URL = '';

const socket = io(SOCKET_SERVER_URL || undefined);

let myName = '';
let localStream = null;
const peers = {}; // socketId -> RTCPeerConnection
const iceServers = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

const joinScreen = document.getElementById('join-screen');
const appScreen = document.getElementById('app-screen');
const nameInput = document.getElementById('name-input');
const joinBtn = document.getElementById('join-btn');
const joinError = document.getElementById('join-error');
const participantsEl = document.getElementById('participants');
const audioContainer = document.getElementById('audio-container');
const messagesEl = document.getElementById('messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const muteBtn = document.getElementById('mute-btn');
const leaveBtn = document.getElementById('leave-btn');

joinBtn.onclick = joinRoom;
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });

async function joinRoom() {
  myName = nameInput.value.trim() || 'Anonymous';
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    joinError.textContent = 'Microphone access is required to join a call.';
    return;
  }
  socket.emit('join', myName);
}

socket.on('room-full', () => {
  joinError.textContent = 'Room is full (max 3 users). Try again later.';
});

socket.on('joined', ({ existingUsers }) => {
  joinScreen.classList.add('hidden');
  appScreen.classList.remove('hidden');
  addSystemMessage(`You joined as ${myName}`);
  updateParticipants(existingUsers.length + 1);

  // connect to everyone already in the room
  existingUsers.forEach(({ id, name }) => {
    createPeerConnection(id, true);
  });
});

socket.on('user-joined', ({ id, name }) => {
  addSystemMessage(`${name} joined the call`);
  createPeerConnection(id, false);
  updateParticipants(Object.keys(peers).length + 1);
});

socket.on('user-left', ({ id }) => {
  if (peers[id]) {
    peers[id].close();
    delete peers[id];
  }
  const audioEl = document.getElementById('audio-' + id);
  if (audioEl) audioEl.remove();
  addSystemMessage('A participant left the call');
  updateParticipants(Object.keys(peers).length + 1);
});

socket.on('signal', async ({ from, data }) => {
  let pc = peers[from];
  if (!pc) {
    pc = createPeerConnection(from, false);
  }
  if (data.type === 'offer') {
    await pc.setRemoteDescription(new RTCSessionDescription(data));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('signal', { to: from, data: pc.localDescription });
  } else if (data.type === 'answer') {
    await pc.setRemoteDescription(new RTCSessionDescription(data));
  } else if (data.candidate) {
    try { await pc.addIceCandidate(new RTCIceCandidate(data)); } catch (e) { /* ignore */ }
  }
});

function createPeerConnection(id, isInitiator) {
  const pc = new RTCPeerConnection(iceServers);
  peers[id] = pc;

  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('signal', { to: id, data: event.candidate });
    }
  };

  pc.ontrack = (event) => {
    let audioEl = document.getElementById('audio-' + id);
    if (!audioEl) {
      audioEl = document.createElement('audio');
      audioEl.id = 'audio-' + id;
      audioEl.autoplay = true;
      audioContainer.appendChild(audioEl);
    }
    audioEl.srcObject = event.streams[0];
  };

  if (isInitiator) {
    pc.onnegotiationneeded = async () => {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('signal', { to: id, data: pc.localDescription });
    };
  }

  return pc;
}

function updateParticipants(count) {
  participantsEl.textContent = `${count} / 3 in room`;
}

function addSystemMessage(text) {
  const div = document.createElement('div');
  div.className = 'msg system';
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

sendBtn.onclick = sendChat;
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit('chat-message', text);
  chatInput.value = '';
}

socket.on('chat-message', ({ name, text }) => {
  const div = document.createElement('div');
  div.className = 'msg';
  div.innerHTML = `<span class="who">${escapeHtml(name)}:</span>${escapeHtml(text)}`;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

let muted = false;
muteBtn.onclick = () => {
  muted = !muted;
  localStream.getAudioTracks().forEach((t) => (t.enabled = !muted));
  muteBtn.textContent = muted ? '🔇 Unmute' : '🎙️ Mute';
};

leaveBtn.onclick = () => {
  window.location.reload();
};