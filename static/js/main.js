let inMainChat = false;
let mainChatPolling = null;
let heartbeatInterval = null;
let onlineUsersPolling = null;
let myPeer, roomId, nickname, isCreator = false;
const connections = {};
const seenP2PMessages = new Set();
let tagPromise = null;
let myTag = "0000";
let lastMessageTimestamp = 0;
let isSending = false; 
let localAudioStream = null;
let inVoiceChannel = false;
const voiceParticipants = new Set();
const activeAudioCalls = {};
const remoteAudioElements = {};
let isMuted = false;

function showNotification(message, type = 'info') {
    const n = document.createElement('div');
    n.textContent = message;
    n.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);padding:12px 24px;border-radius:8px;z-index:10000;color:#fff;font-weight:500;transition:opacity 0.3s;background:' + (type === 'error' ? '#e74c3c' : '#2ecc71');
    document.body.appendChild(n);
    setTimeout(() => { n.style.opacity = '0'; setTimeout(() => n.remove(), 300); }, 3000);
}

function escapeHtml(unsafe) {
    return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function toggleVoiceChannel() {
    if (!inVoiceChannel) {
        await joinVoice();
    } else {
        leaveVoice();
    }
}

async function joinVoice() {
    try {
        localAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        inVoiceChannel = true;
        
        updateVoiceUI();

        for (let id in connections) {
            if (connections[id].conn.open) {
                connections[id].conn.send({ type: 'VOICE_STATE', action: 'join' });
            }
        }

        voiceParticipants.forEach(peerId => {
            callPeerVoice(peerId);
        });

    } catch (err) {
        console.error("Mic error:", err);
        showNotification("Could not access microphone", "error");
    }
}

function leaveVoice() {
    if (localAudioStream) {
        localAudioStream.getTracks().forEach(track => track.stop());
        localAudioStream = null;
    }
    inVoiceChannel = false;
    isMuted = false;
    updateMuteButton();

    for (let id in activeAudioCalls) {
        activeAudioCalls[id].close();
        delete activeAudioCalls[id];
    }
    for (let id in remoteAudioElements) {
        remoteAudioElements[id].remove();
        delete remoteAudioElements[id];
    }

    for (let id in connections) {
        if (connections[id].conn.open) {
            connections[id].conn.send({ type: 'VOICE_STATE', action: 'leave' });
        }
    }

    voiceParticipants.clear();
    updateVoiceUI();
}

function callPeerVoice(peerId) {
    if (activeAudioCalls[peerId] || !localAudioStream) return;

    const call = myPeer.call(peerId, localAudioStream);
    
    call.on('close', () => {
        if (remoteAudioElements[peerId]) {
            remoteAudioElements[peerId].remove();
            delete remoteAudioElements[peerId];
        }
        delete activeAudioCalls[peerId];
    });

    activeAudioCalls[peerId] = call;
}

function updateVoiceUI() {
    const btn = document.getElementById('voice-toggle-btn');
    const muteBtn = document.getElementById('mute-btn');
    const settingsBtn = document.getElementById('settings-btn');
    const participantsSpan = document.getElementById('voice-participants');

    if (inVoiceChannel) {
        btn.innerText = 'Leave Voice';
        btn.classList.add('active-voice');
        muteBtn.style.display = 'flex';
        settingsBtn.style.display = 'flex';
    } else {
        btn.innerText = 'Join Voice';
        btn.classList.remove('active-voice');
        muteBtn.style.display = 'none';
        settingsBtn.style.display = 'none';
    }

    if (voiceParticipants.size === 0) {
        participantsSpan.innerText = "Nobody here";
    } else {
        const names = [];
        voiceParticipants.forEach(id => {
            if (connections[id] && connections[id].nickname !== "...") {
                names.push(connections[id].nickname);
            }
        });
        participantsSpan.innerText = names.join(', ');
    }
}

function toggleMute() {
    if (!inVoiceChannel || !localAudioStream) return;
    
    isMuted = !isMuted;
    
    localAudioStream.getAudioTracks().forEach(track => {
        track.enabled = !isMuted; 
    });
    
    updateMuteButton();
}

function updateMuteButton() {
    const btn = document.getElementById('mute-btn');
    const iconOn = btn.querySelector('.mic-on');
    const iconOff = btn.querySelector('.mic-off');
    
    if (isMuted) {
        btn.classList.add('muted');
        iconOn.style.display = 'none';
        iconOff.style.display = 'block';
    } else {
        btn.classList.remove('muted');
        iconOn.style.display = 'block';
        iconOff.style.display = 'none';
    }
}

function toggleAudioSettings() {
    const menu = document.getElementById('audio-settings-menu');
    menu.classList.toggle('show');
    
    if (menu.classList.contains('show')) {
        loadAudioDevices();
    }
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('.voice-btn-group')) {
        document.getElementById('audio-settings-menu').classList.remove('show');
    }
});

async function loadAudioDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputSelect = document.getElementById('audio-input-select');
        const outputSelect = document.getElementById('audio-output-select');
        
        const currentInput = inputSelect.value;
        const currentOutput = outputSelect.value;
        
        inputSelect.innerHTML = '<option value="">Default</option>';
        outputSelect.innerHTML = '<option value="">Default</option>';

        devices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.text = device.label || 'Microfono/Altoparlante sconosciuto';
            
            if (device.kind === 'audioinput') {
                inputSelect.appendChild(option);
            } else if (device.kind === 'audiooutput') {
                outputSelect.appendChild(option);
            }
        });
        
        inputSelect.value = currentInput;
        outputSelect.value = currentOutput;
        
    } catch (err) {
        console.error("Errore lettura dispositivi audio:", err);
    }
}

async function changeAudioInput(deviceId) {
    if (!inVoiceChannel) return;
    
    if (localAudioStream) {
        localAudioStream.getTracks().forEach(track => track.stop());
    }

    const constraints = { audio: deviceId ? { deviceId: { exact: deviceId } } : true };
    localAudioStream = await navigator.mediaDevices.getUserMedia(constraints);
    
    if (isMuted) {
        localAudioStream.getAudioTracks().forEach(track => track.enabled = false);
    }

    const newTrack = localAudioStream.getAudioTracks()[0];
    for (let peerId in activeAudioCalls) {
        const call = activeAudioCalls[peerId];
        const sender = call.peerConnection.getSenders().find(s => s.track && s.track.kind === 'audio');
        if (sender) {
            sender.replaceTrack(newTrack).catch(e => console.error("Replace track error:", e));
        }
    }
}

function changeAudioOutput(deviceId) {
    for (let peerId in remoteAudioElements) {
        const audio = remoteAudioElements[peerId];
        if (typeof audio.setSinkId === 'function') {
            audio.setSinkId(deviceId).catch(e => console.error("Errore cambio output:", e));
        }
    }
}

async function fetchTag() {
    const savedTag = sessionStorage.getItem('myTag');
    if (savedTag) {
        myTag = savedTag;
        return;
    }

    try {
        const res = await fetch('/api/tag');
        const data = await res.json();
        myTag = data.tag;
        sessionStorage.setItem('myTag', myTag);
    } catch (e) {
        console.error("Errore nel fetch del tag", e);
    }
}

function getFullName() {
    return nickname + "#" + myTag;
}

const nameColors = {};
const colorPool = ['#c0392b','#2980b9','#27ae60','#8e44ad','#d35400','#16a085','#2c3e50','#e67e22','#7f8c8d','#1abc9c'];

function getColorForName(name) {
    if (!nameColors[name]) {
        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = name.charCodeAt(i) + ((hash << 5) - hash);
        }
        nameColors[name] = colorPool[Math.abs(hash) % colorPool.length];
    }
    return nameColors[name];
}

function formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return h + ':' + m;
}

async function pollOnlineUsers() {
    if (!inMainChat) return;
    try {
        const res = await fetch('/api/online-users');
        const users = await res.json();
        updateOnlineUsersList(users);
    } catch(e) {
        console.error("Errore polling utenti online", e);
    }
}

function updateOnlineUsersList(users) {
    const list = document.getElementById('peers-list');
    list.innerHTML = '';

    const me = document.createElement('li');
    me.className = 'user-item';
    me.innerHTML = '<span>' + escapeHtml(getFullName()) + ' (You)</span>';
    list.appendChild(me);

    users.forEach(user => {
        if (user !== getFullName()) {
            const item = document.createElement('li');
            item.className = 'user-item';
            item.innerHTML = '<span>' + escapeHtml(user) + '</span>';
            list.appendChild(item);
        }
    });
}

async function joinMainChat() {
    nickname = document.getElementById('nickname-input').value.trim();
    if (!nickname) return;

    document.body.style.height = '100vh';
    document.body.style.height = '100dvh';
    document.body.style.overflow = 'hidden';
    
    if (myTag === "0000") {
        await fetchTag();
    }

    inMainChat = true;
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('room-screen').style.display = 'flex';
    document.getElementById('voice-channel').style.display = 'none';
    document.getElementById('admin-controls').style.display = 'none';
    document.getElementById('peers-list').innerHTML = '';
    document.getElementById('chat-messages').innerHTML = '';

    try {
        await fetch('/api/join-main-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nickname_tag: getFullName() })
        });
    } catch(e) {
        console.error("Errore registrazione online", e);
    }

    const me = document.createElement('li');
    me.className = 'user-item';
    me.innerHTML = '<span>' + escapeHtml(getFullName()) + ' (You)</span>';
    document.getElementById('peers-list').appendChild(me);

    try {
        const res = await fetch('/api/main-chat');
        const messages = await res.json();
        
        messages.forEach(msg => {
            appendMessage(msg.text, msg.sender === getFullName() ? 'me' : 'partner', msg.sender, msg.timestamp);
            if (msg.timestamp >= lastMessageTimestamp) {
                lastMessageTimestamp = msg.timestamp + 1;
            }
        });
    } catch(e) {
        console.error("Errore caricamento messaggi iniziali", e);
    }

    mainChatPolling = setInterval(pollMainChat, 1500);
    
    heartbeatInterval = setInterval(async () => {
        if (!inMainChat) return;
        try {
            await fetch('/api/heartbeat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nickname_tag: getFullName() })
            });
        } catch(e) {
            console.error("Errore heartbeat", e);
        }
    }, 5000);
    
    onlineUsersPolling = setInterval(pollOnlineUsers, 3000);
    
    pollOnlineUsers();
}

async function pollMainChat() {
    if (!inMainChat) return;
    try {
        const res = await fetch(`/api/main-chat?after=${lastMessageTimestamp}`);
        const messages = await res.json();
        
        messages.forEach(msg => {
            if (msg.sender !== getFullName()) {
                appendMessage(msg.text, 'partner', msg.sender, msg.timestamp);
            }
            if (msg.timestamp >= lastMessageTimestamp) {
                lastMessageTimestamp = msg.timestamp + 1;
            }
        });
    } catch(e) {
        console.error("Errore polling", e);
    }
}

async function sendMainChatMessage() {
    if (isSending) return;
    const input = document.getElementById('chat-input');
    const txt = input.value.trim();
    if (!txt) return;

    isSending = true;
    input.disabled = true;

    try {
        const res = await fetch('/api/main-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sender: getFullName(), text: txt })
        });

        if (res.ok) { 
            const data = await res.json();
            appendMessage(txt, 'me', getFullName(), data.timestamp);
            if (data.timestamp >= lastMessageTimestamp) {
                lastMessageTimestamp = data.timestamp + 1;
            }
            input.value = '';
        } else {
            console.error("Errore server:", res.status);
            showNotification("Failed to send message", "error");
        }
    } catch(e) {
        console.error("Errore di rete invio messaggio", e);
        showNotification("Failed to send message", "error");
    } finally {
        isSending = false;
        input.disabled = false;
        input.focus();
    }
}

function leaveMainChat() {
    if (mainChatPolling) {
        clearInterval(mainChatPolling);
        mainChatPolling = null;
    }
    
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
    if (onlineUsersPolling) {
        clearInterval(onlineUsersPolling);
        onlineUsersPolling = null;
    }
    
    if (inMainChat) {
        fetch('/api/leave-main-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nickname_tag: getFullName() })
        }).catch(e => console.error("Errore leave", e));
    }
    
    inMainChat = false;
    lastMessageTimestamp = 0;
}

function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    sidebar.classList.toggle('sidebar-open');
    overlay.classList.toggle('active');
}

function closeSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar.classList.contains('sidebar-open')) {
        sidebar.classList.remove('sidebar-open');
        overlay.classList.remove('active');
    }
}

function goBack() {
    document.body.style.height = '';
    document.body.style.overflow = '';
    closeSidebar();
    leaveMainChat();

    if (inVoiceChannel) leaveVoice();
    voiceParticipants.clear();
    updateVoiceUI();

    for (let id in connections) {
        if (connections[id].conn.open) connections[id].conn.close();
        delete connections[id];
    }
    if (myPeer) {
        myPeer.destroy();
        myPeer = null;
    }
    document.getElementById('room-screen').style.display = 'none';
    document.getElementById('voice-channel').style.display = 'none';
    document.getElementById('lobby').style.display = 'flex';
    document.getElementById('chat-messages').innerHTML = '';
    document.getElementById('admin-controls').style.display = 'none';
    document.getElementById('btn-join-trigger').style.display = '';
    document.getElementById('btn-create').style.display = '';
    document.getElementById('join-container').style.display = 'none';
    document.getElementById('room-input').value = '';
    roomId = null;
    seenP2PMessages.clear(); 
    isCreator = false;
}

function executeCopy() {
    const textToCopy = roomId || document.getElementById('admin-code-text').innerText;
    if (!textToCopy) return;

    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(textToCopy).catch(() => fallbackCopy(textToCopy));
    } else {
        fallbackCopy(textToCopy);
    }
}

function fallbackCopy(text) {
    let ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); }
    catch(e) { console.error('copy failed', e); }
    document.body.removeChild(ta);
}

function generateSecureCode() {
    const buf = new Uint8Array(12);
    crypto.getRandomValues(buf);
    return 'room-' + Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
}

function showJoinField() {
    document.getElementById('btn-join-trigger').style.display = 'none';
    document.getElementById('btn-create').style.display = 'none';
    document.getElementById('join-container').style.display = 'flex';
}

window.addEventListener('DOMContentLoaded', () => {
    const p = new URLSearchParams(window.location.search);
    if (p.has('room')) {
        showJoinField();
        document.getElementById('room-input').value = p.get('room');
    }
});

async function createRoomAsAdmin() {
    nickname = document.getElementById('nickname-input').value.trim();
    if (!nickname) return;
    
    if (myTag === "0000") {
        await fetchTag();
    }
    
    roomId = generateSecureCode();
    startRoom(true);
}

function startRoom(adminMode) {
    nickname = document.getElementById('nickname-input').value.trim();
    if (!adminMode) {
        roomId = document.getElementById('room-input').value.trim().toLowerCase();
        
        if (!/^(room-[a-f0-9]{24})$/.test(roomId)) {
            alert("Invalid room code format.");
            return;
        }
    }
    if (!nickname || !roomId) return;

    document.body.style.height = '100vh';
    document.body.style.height = '100dvh';
    document.body.style.overflow = 'hidden';

    isCreator = adminMode;
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('room-screen').style.display = 'flex';
    document.getElementById('voice-channel').style.display = 'flex';

    if (isCreator) {
        document.getElementById('admin-controls').style.display = 'block';
        document.getElementById('admin-code-text').innerText = roomId;
    }

    const myId = isCreator
        ? `room_${roomId}`
        : `peer_${roomId}_${Math.random().toString(36).substring(2, 7)}`;

    myPeer = new Peer(myId, {
        secure: window.location.protocol === 'https:',
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { 
                    urls: 'turn:openrelay.metered.ca:80',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                { 
                    urls: 'turn:openrelay.metered.ca:443',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                }
            ]
        }
    });

    myPeer.on('open', () => {
        updateUserListUI();
        if (!isCreator) {
            let conn = myPeer.connect(`room_${roomId}`);
            setupConnection(conn);
        }
    });

    myPeer.on('disconnected', () => {
        myPeer.reconnect();
    });

    myPeer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
            showNotification("Room doesn't exist or expired", "error");
            goBack();
        } else if (err.type === 'network' || err.type === 'server-error') {
            showNotification("Connection error. Try again.", "error");
            goBack();
        }
    });

    myPeer.on('connection', conn => setupConnection(conn));

    myPeer.on('call', (call) => {
        if (!inVoiceChannel) {
            call.close();
            return;
        }

        call.answer(localAudioStream || new MediaStream());

        call.on('stream', (remoteStream) => {
            if (remoteAudioElements[call.peer]) return;

            const audio = document.createElement('audio');
            audio.srcObject = remoteStream;
            audio.autoplay = true;
            document.getElementById('remote-audio-container').appendChild(audio);
            remoteAudioElements[call.peer] = audio;
        });

        call.on('close', () => {
            if (remoteAudioElements[call.peer]) {
                remoteAudioElements[call.peer].remove();
                delete remoteAudioElements[call.peer];
            }
            delete activeAudioCalls[call.peer];
        });

        activeAudioCalls[call.peer] = call;
    });
}

function setupConnection(conn) {
    connections[conn.peer] = { conn, nickname: "..." };

    conn.on('open', () => {
        conn.send({ type: 'HANDSHAKE', nickname: getFullName() });

        if (isCreator) {
            const existing = Object.keys(connections)
                .filter(id => id !== conn.peer)
                .map(id => ({ id, nickname: connections[id].nickname }));

            conn.send({ type: 'MESH_SETUP', peers: existing });

            Object.keys(connections).forEach(oldId => {
                if (oldId !== conn.peer) {
                    connections[oldId].conn.send({ type: 'CONNECT_TO_NEW_PEER', newPeerId: conn.peer });
                }
            });
        }

        if (inVoiceChannel) {
            conn.send({ type: 'VOICE_STATE', action: 'join' });
        }
    });

    conn.on('data', data => {
        switch (data.type) {
            case 'HANDSHAKE':
                connections[conn.peer].nickname = data.nickname;
                updateUserListUI();
                break;

            case 'CHAT':
                if (!data.msgId || seenP2PMessages.has(data.msgId)) {
                    break; 
                }
                seenP2PMessages.add(data.msgId);
                if (seenP2PMessages.size > 500) {
                    const arr = Array.from(seenP2PMessages);
                    arr.slice(0, 250).forEach(id => seenP2PMessages.delete(id));
                }
                appendMessage(data.text, 'partner', data.sender, data.timestamp);
                for (let id in connections) {
                    if (id !== conn.peer && connections[id].conn.open) {
                        connections[id].conn.send(data); 
                    }
                }
                break;

            case 'FILE':
                if (!data.msgId || seenP2PMessages.has(data.msgId)) {
                    break; 
                }
                seenP2PMessages.add(data.msgId);
                if (seenP2PMessages.size > 500) {
                    const arr = Array.from(seenP2PMessages);
                    arr.slice(0, 250).forEach(id => seenP2PMessages.delete(id));
                }
                appendFileMessage(data, false);
                for (let id in connections) {
                    if (id !== conn.peer && connections[id].conn.open) {
                        connections[id].conn.send(data); 
                    }
                }
                break;

            case 'MESH_SETUP':
                data.peers.forEach(p => {
                    if (!connections[p.id]) {
                        setupConnection(myPeer.connect(p.id));
                    }
                });
                break;
            case 'CONNECT_TO_NEW_PEER':
                if (!connections[data.newPeerId]) {
                    setupConnection(myPeer.connect(data.newPeerId));
                }
                break;
            case 'KICK':
                window.location.reload();
                break;

            case 'VOICE_STATE':
                if (data.action === 'join') {
                    voiceParticipants.add(conn.peer);
                    if (inVoiceChannel && localAudioStream) {
                        callPeerVoice(conn.peer);
                    }
                } else if (data.action === 'leave') {
                    voiceParticipants.delete(conn.peer);
                    if (activeAudioCalls[conn.peer]) {
                        activeAudioCalls[conn.peer].close();
                        delete activeAudioCalls[conn.peer];
                    }
                    if (remoteAudioElements[conn.peer]) {
                        remoteAudioElements[conn.peer].remove();
                        delete remoteAudioElements[conn.peer];
                    }
                }
                updateVoiceUI();
                break;
        }
    });

    conn.on('close', () => {
        delete connections[conn.peer];
        
        if (voiceParticipants.has(conn.peer)) {
            voiceParticipants.delete(conn.peer);
            if (remoteAudioElements[conn.peer]) {
                remoteAudioElements[conn.peer].remove();
                delete remoteAudioElements[conn.peer];
            }
            updateVoiceUI();
        }

        updateUserListUI();
    });
}

document.getElementById('file-input').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
        alert("The file is too large. Please select a file smaller than 5MB.");
        e.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = function(event) {
        const base64Data = event.target.result.split(',')[1];
        sendP2PFile(file.name, file.type, base64Data);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
});

function sendP2PFile(filename, mimeType, base64Data) {
    const msgId = Date.now() + '-' + Math.random().toString(36).substring(2, 11);
    const now = Date.now();

    const msgData = { 
        type: 'FILE',
        msgId: msgId, 
        sender: getFullName(), 
        timestamp: now,
        fileName: filename,
        mimeType: mimeType,
        data: base64Data
    };

    appendFileMessage(msgData, true);
    
    seenP2PMessages.add(msgId);

    for (let id in connections) {
        if (connections[id].conn.open) {
            connections[id].conn.send(msgData);
        }
    }
}

function appendFileMessage(data, isMe) {
    const feed = document.getElementById('chat-messages');
    const wrapper = document.createElement('div');
    wrapper.className = 'msg ' + (isMe ? 'me' : 'partner');

    const sender = document.createElement('span');
    sender.className = 'sender';
    sender.style.color = getColorForName(data.sender);
    sender.textContent = data.sender + ': ';
    wrapper.appendChild(sender);

    let fileElement;

    if (data.mimeType.startsWith('image/')) {
        fileElement = document.createElement('img');
        fileElement.src = 'data:' + data.mimeType + ';base64,' + data.data;
        fileElement.style.maxWidth = '300px';
        fileElement.style.borderRadius = '8px';
        fileElement.style.marginTop = '5px';
        fileElement.style.display = 'block';
        fileElement.style.cursor = 'pointer';
        fileElement.onclick = () => window.open(fileElement.src, '_blank');
    } else {
        fileElement = document.createElement('a');
        fileElement.href = 'data:' + data.mimeType + ';base64,' + data.data;
        fileElement.download = data.fileName;
        fileElement.textContent = 'Download ' + data.fileName;
        fileElement.style.color = '#2980b9';
        fileElement.style.textDecoration = 'underline';
        fileElement.style.display = 'block';
        fileElement.style.marginTop = '5px';
    }

    const time = document.createElement('span');
    time.className = 'msg-time';
    time.textContent = ' ' + formatTime(data.timestamp);

    wrapper.appendChild(fileElement);
    wrapper.appendChild(time);
    feed.appendChild(wrapper);
    feed.scrollTop = feed.scrollHeight;
}

function sendMessage() {
    if (inMainChat) {
        sendMainChatMessage();
        return;
    }

    const input = document.getElementById('chat-input');
    const txt = input.value.trim();
    if (!txt) return;

    const msgId = Date.now() + '-' + Math.random().toString(36).substring(2, 11);
    const now = Date.now();

    const msgData = { 
        type: 'CHAT', 
        text: txt, 
        sender: getFullName(), 
        timestamp: now,
        msgId: msgId
    };

    appendMessage(txt, 'me', getFullName(), now);
    input.value = "";

    seenP2PMessages.add(msgId);

    for (let id in connections) {
        if (connections[id].conn.open) {
            connections[id].conn.send(msgData);
        }
    }
}

function kickUser(peerId) {
    if (!isCreator) return;
    const target = connections[peerId];
    if (target && target.conn.open) {
        target.conn.send({ type: 'KICK' });
        target.conn.close();
        delete connections[peerId];
        updateUserListUI();
    }
}

function updateUserListUI() {
    const list = document.getElementById('peers-list');
    list.innerHTML = "";

    const me = document.createElement('li');
    me.className = "user-item";
    me.innerHTML = `<span>${escapeHtml(getFullName())} (You)</span>`;
    list.appendChild(me);

    for (let id in connections) {
        if (connections[id].nickname === "...") continue;
        const item = document.createElement('li');
        item.className = 'user-item';
        
        const span = document.createElement('span');
        span.textContent = connections[id].nickname;
        item.appendChild(span);

        if (isCreator) {
            const kickBtn = document.createElement('button');
            kickBtn.className = 'btn danger';
            kickBtn.textContent = 'X';
            kickBtn.onclick = function() { 
                kickUser(id); 
            }; 
            item.appendChild(kickBtn);
        }
        
        list.appendChild(item);
    }
}

document.getElementById('chat-input').addEventListener('keypress', e => {
    if (e.key === 'Enter') sendMessage();
});

window.addEventListener('beforeunload', () => {
    if (inMainChat) {
        const payload = JSON.stringify({ nickname_tag: getFullName() });
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon('/api/leave-main-chat', blob);
    }
    if (inVoiceChannel && localAudioStream) {
        localAudioStream.getTracks().forEach(track => track.stop());
    }
});

function appendMessage(text, side, senderName, timestamp) {
    const feed = document.getElementById('chat-messages');
    const el = document.createElement('div');
    el.className = 'msg ' + side;

    if (side === 'system') {
        el.textContent = text;
    } else {
        const sender = document.createElement('span');
        sender.className = 'sender';
        sender.style.color = getColorForName(senderName);
        sender.textContent = senderName + ': ';
        el.appendChild(sender);
        el.appendChild(document.createTextNode(text));

        const time = document.createElement('span');
        time.className = 'msg-time';
        time.textContent = ' ' + formatTime(timestamp);
        el.appendChild(time);
    }

    feed.appendChild(el);
    feed.scrollTop = feed.scrollHeight;
}
