import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import { getFirestore, collection, addDoc, updateDoc, doc, arrayUnion, onSnapshot, getDocs, query, orderBy, limit, startAfter, startAt, serverTimestamp, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import { S3Client, PutObjectCommand } from "https://esm.sh/@aws-sdk/client-s3@3.525.0?bundle";

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

// --- BASE USERS ---
const USERS = { 
    "sam10": { name: "Sam", avatar: "sam10.png" },
    "mastura10": { name: "Tsunade", avatar: "ts.png" }
};
const UNKNOWN_USER = { name: "Unknown", avatar: "https://ui-avatars.com/api/?name=?" };

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
let vaultKey = localStorage.getItem("secure_vault") || "";
let currentUser = localStorage.getItem("secure_user") || "";
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
let partnerLastSeenTime = 0; 
let myLastSeenWritten = 0;   
let myLastTyping = 0; 
let typingTimeout = null; 
const msgCache = {};
let currentMediaUrl = "";
// REMOVED: isAppUnlocked flag - App now loads immediately in background

// NEW: Custom Emoji Map
let customEmojiMap = {};

// NEW: Store Custom Profiles
// Structure: { uid: { name: "...", avatar: "data:image...", url: "https://..." } }
let CUSTOM_PROFILES = {};

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
    ctxEdit: document.getElementById('ctx-edit'),
    ctxClose: document.getElementById('ctx-close-btn'),
    rxPicker: document.querySelector('.rx-picker'),
    rxCustomBtn: document.getElementById('rx-custom-btn'),
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
    typingIndicator: document.getElementById('typing-indicator'),
    permBlock: document.getElementById('perm-block'),
    permRetryBtn: document.getElementById('perm-retry-btn'),
    
    // Custom Modals
    customRxModal: document.getElementById('custom-rx-input-modal'),
    inpCustomRx: document.getElementById('inp-custom-rx'),
    btnCustomRxConfirm: document.getElementById('btn-custom-rx-confirm'),
    btnCustomRxCancel: document.getElementById('btn-custom-rx-cancel'),
    editModal: document.getElementById('edit-modal'),
    inpEditMsg: document.getElementById('inp-edit-msg'),
    btnEditConfirm: document.getElementById('btn-edit-confirm'),
    btnEditCancel: document.getElementById('btn-edit-cancel'),

    // Persons & Profile
    menuPersonsBtn: document.getElementById('menu-persons-btn'),
    menuExploreBtn: document.getElementById('menu-explore-btn'),
    personsModal: document.getElementById('persons-modal'),
    personsListContainer: document.getElementById('persons-list-container'),
    btnPersonsClose: document.getElementById('btn-persons-close'),
    nameEditModal: document.getElementById('name-edit-modal'),
    inpNickname: document.getElementById('inp-nickname'),
    btnNameCancel: document.getElementById('btn-name-cancel'),
    btnNameConfirm: document.getElementById('btn-name-confirm'),
    profileFileInput: document.getElementById('profile-file-input'),
    cropCanvas: document.getElementById('crop-canvas')
};

function encrypt(text) { return CryptoJS.AES.encrypt(text, vaultKey).toString(); }
function decrypt(cipherText) {
    try { return CryptoJS.AES.decrypt(cipherText, vaultKey).toString(CryptoJS.enc.Utf8); } catch (e) { return null; }
}

// --- USER RESOLVER (MERGE LOCAL & DB) ---
function resolveUser(uid) {
    const base = USERS[uid] || UNKNOWN_USER;
    const custom = CUSTOM_PROFILES[uid];
    
    let displayName = base.name;
    let displayAvatar = base.avatar; // Default avatar

    if (custom) {
        if (custom.name) displayName = custom.name;
        // Only use custom avatar if we have the ACTUAL image data (Base64), not just the URL
        if (custom.avatar && custom.avatar.startsWith('data:image')) {
            displayAvatar = custom.avatar;
        }
    }
    return { name: displayName, avatar: displayAvatar };
}

// --- HAPTIC FEEDBACK HELPER ---
function vibrate(ms) {
    if (navigator.vibrate) navigator.vibrate(ms);
}

function getPartnerId() { return currentUser === 'sam10' ? 'mastura10' : 'sam10'; }

// --- INSTANT LOGIN CHECK ---
if (currentUser && vaultKey) {
    dom.login.style.display = 'none'; 
}

// --- AUTO START (BACKGROUND LOADING) ---
// App starts immediately. Stealth screen covers it via Z-Index.
checkAuthStatus(); 

// --- AUTH ---
function checkAuthStatus() {
    // REMOVED: if (!isAppUnlocked) return; 
    
    if (currentUser && vaultKey) {
        dom.login.style.display = 'none'; 
        dom.chat.style.display = 'flex';
        // Hamburger now visible for all
        dom.hamburger.style.display = 'block';
        
        requestInitialPermissions();
        
    } else {
        dom.loader.style.display = 'none';
        dom.login.style.display = 'flex'; 
        dom.chat.style.display = 'none';
        if(presenceInterval) clearInterval(presenceInterval);
    }
}

onAuthStateChanged(auth, (user) => {
    if (user && !currentUser) { 
    } else {
        // Update status if auth state resolves later
        checkAuthStatus();
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

// --- PERSONS MODAL LOGIC ---
dom.menuPersonsBtn.onclick = () => {
    closeMenu();
    renderPersonsList();
    dom.personsModal.style.display = 'flex';
};

// --- EXPLORE / GALLERY LOGIC ---
// Added this section based on your request
if (dom.menuExploreBtn) {
    dom.menuExploreBtn.onclick = () => {
        window.location.href = 'gallery.html';
    };
}
dom.btnPersonsClose.onclick = () => dom.personsModal.style.display = 'none';

let userToEdit = null;

function renderPersonsList() {
    dom.personsListContainer.innerHTML = '';
    
    Object.keys(USERS).forEach(uid => {
        const user = resolveUser(uid);
        
        const row = document.createElement('div');
        row.className = 'person-row';
        
        const avatarWrapper = document.createElement('div');
        avatarWrapper.className = 'person-avatar-wrapper';
        avatarWrapper.onclick = () => triggerProfilePicUpload(uid);
        
        const img = document.createElement('img');
        img.src = user.avatar;
        img.className = 'person-avatar';
        
        const editIcon = document.createElement('div');
        editIcon.className = 'person-edit-icon';
        editIcon.innerText = '📷';
        
        avatarWrapper.appendChild(img);
        avatarWrapper.appendChild(editIcon);
        
        const info = document.createElement('div');
        info.className = 'person-info';
        info.onclick = () => openNicknameEditor(uid, user.name);
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'person-name';
        nameSpan.innerText = user.name;
        
        const subSpan = document.createElement('div');
        subSpan.className = 'person-sub';
        subSpan.innerText = "Click to change";
        
        info.appendChild(nameSpan);
        info.appendChild(subSpan);
        
        row.appendChild(avatarWrapper);
        row.appendChild(info);
        
        dom.personsListContainer.appendChild(row);
    });
}

// NICKNAME EDITOR
function openNicknameEditor(uid, currentName) {
    userToEdit = uid;
    dom.inpNickname.value = currentName;
    dom.nameEditModal.style.display = 'flex';
    dom.inpNickname.focus();
}

dom.btnNameCancel.onclick = () => dom.nameEditModal.style.display = 'none';
dom.btnNameConfirm.onclick = async () => {
    const newName = dom.inpNickname.value.trim();
    if (!newName || !userToEdit) return;
    
    dom.nameEditModal.style.display = 'none';
    const encryptedName = encrypt(newName);
    
    // Save to Firestore (Merged)
    await setDoc(doc(db, 'profiles', userToEdit), { name: encryptedName }, { merge: true });
    
    // Send Notification Message
    const actorName = resolveUser(currentUser).name;
    const targetName = resolveUser(userToEdit).name;
    const notifyPayload = {
        text: `${actorName} changed ${targetName}'s nickname to ${newName}`
    };
    await addDoc(collection(db, "messages"), {
        s: currentUser,
        d: encrypt(JSON.stringify(notifyPayload)),
        t: serverTimestamp(),
        y: 'notify',
        rx: {}
    });
};

// PROFILE PICTURE UPLOAD
function triggerProfilePicUpload(uid) {
    userToEdit = uid;
    dom.profileFileInput.click();
}

dom.profileFileInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file || !userToEdit) return;
    
    dom.status.innerText = "Processing Image...";
    try {
        // 1. Crop Image 1:1
        const b64Cropped = await cropImageSquare(file);
        
        // 2. Encrypt
        const encBlob = encrypt(b64Cropped);
        dom.status.innerText = "Uploading Profile...";
        
        // 3. Upload R2
        const fname = `pfp_${userToEdit}_${Date.now()}.enc`;
        await s3.send(new PutObjectCommand({ Bucket: r2Config.bucketName, Key: fname, Body: encBlob, ContentType: "text/plain" }));
        
        // 4. Save URL Encrypted in DB
        const finalUrl = `${r2Config.publicUrl}/${fname}`;
        const encryptedUrl = encrypt(finalUrl);
        
        await setDoc(doc(db, 'profiles', userToEdit), { avatar: encryptedUrl }, { merge: true });
        
        // Send Notification Message
        const actorName = resolveUser(currentUser).name;
        const targetName = resolveUser(userToEdit).name;
        const notifyPayload = {
            text: `${actorName} changed ${targetName}'s profile`,
            img: finalUrl // Use Public URL here as it will be decrypted by recipients
        };
        await addDoc(collection(db, "messages"), {
            s: currentUser,
            d: encrypt(JSON.stringify(notifyPayload)),
            t: serverTimestamp(),
            y: 'notify',
            rx: {}
        });

        dom.status.innerText = "";
        dom.profileFileInput.value = ""; // Reset
        
    } catch (err) {
        console.error(err);
        dom.status.innerText = "Error updating profile";
    }
};

function cropImageSquare(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const size = Math.min(img.width, img.height);
                const x = (img.width - size) / 2;
                const y = (img.height - size) / 2;
                
                dom.cropCanvas.width = size;
                dom.cropCanvas.height = size;
                const ctx = dom.cropCanvas.getContext('2d');
                ctx.drawImage(img, x, y, size, size, 0, 0, size, size);
                
                // Return data URL (High quality)
                resolve(dom.cropCanvas.toDataURL('image/jpeg', 0.9));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// --- PROFILE SYNC SYSTEM (UPDATED FIX) ---
function initProfileSystem() {
    onSnapshot(collection(db, 'profiles'), (snap) => {
        snap.forEach(docSnap => {
            const uid = docSnap.id;
            const data = docSnap.data();
            
            if (!CUSTOM_PROFILES[uid]) CUSTOM_PROFILES[uid] = {};
            
            if (data.name) {
                const decName = decrypt(data.name);
                if (decName) CUSTOM_PROFILES[uid].name = decName;
            }
            if (data.avatar) {
                const url = decrypt(data.avatar);
                // Check if we have a new URL or if we haven't loaded this avatar yet
                if (url && CUSTOM_PROFILES[uid].url !== url) {
                    CUSTOM_PROFILES[uid].url = url;
                    // Trigger async fetch, don't await here to avoid blocking
                    fetchAndCacheProfilePic(uid, url);
                }
            }
        });
        
        // Immediate render (updates names, defaults for avatars if loading)
        updateHeader();
        refreshMessageAvatars();
        if (dom.personsModal.style.display === 'flex') renderPersonsList();
    });
}

// NEW FUNCTION: Fetch Encrypted Profile Image & Cache Base64
async function fetchAndCacheProfilePic(uid, url) {
    try {
        const res = await fetch(url);
        if(!res.ok) throw new Error("Fetch failed");
        const txt = await res.text();
        const b64 = decrypt(txt);
        
        if (b64 && b64.startsWith('data:image')) {
            CUSTOM_PROFILES[uid].avatar = b64; // Store the actual Image Data
            
            // Re-render UI to show the image
            updateHeader();
            refreshMessageAvatars();
            if (dom.personsModal.style.display === 'flex') renderPersonsList();
        }
    } catch (e) {
        console.warn("Failed to decrypt/load profile pic for", uid);
    }
}

function updateHeader() {
    const partnerId = getPartnerId();
    const partner = resolveUser(partnerId);
    dom.headAvatar.src = partner.avatar;
    dom.headName.innerText = partner.name;
}

function refreshMessageAvatars() {
    // Brute force update of visible avatars and names in reply headers
    document.querySelectorAll('.msg-row').forEach(row => {
        const uid = row.classList.contains('me') ? currentUser : getPartnerId();
        const user = resolveUser(uid);
        
        // Update Avatar Img
        const img = row.querySelector('.msg-avatar');
        if (img && !row.classList.contains('me')) img.src = user.avatar;
    });
}

// --- CUSTOM EMOJI HELPER ---
function replaceCustomEmojis(text) {
    if (!text || !customEmojiMap) return text;
    let newText = text;
    Object.entries(customEmojiMap).forEach(([emoji, id]) => {
        // Replace all instances of the emoji with the custom image
        // Using replaceAll to catch all occurrences
        newText = newText.replaceAll(emoji, `<img src="/custom_emoji/e (${id}).png" class="custom-emoji" alt="${emoji}">`);
    });
    return newText;
}

// NEW: Updates the static context menu to show custom images
function updateContextMenuEmojis() {
    const picker = document.querySelector('.rx-picker');
    if(!picker) return;
    const spans = picker.querySelectorAll('span:not(#rx-custom-btn)');
    spans.forEach(span => {
        const emoji = span.dataset.emoji; 
        if(emoji && customEmojiMap[emoji]) {
            span.innerHTML = replaceCustomEmojis(emoji);
        }
    });
}

async function loadCustomEmojis() {
    try {
        const res = await fetch('customemojilist.json');
        if (res.ok) {
            customEmojiMap = await res.json();
            updateContextMenuEmojis(); // <--- Apply to context menu
        }
    } catch (e) {
        console.warn("Failed to load custom emojis", e);
    }
}

// --- PERMISSIONS (STRICT: AUDIO ONLY) ---
async function requestInitialPermissions() {
    // Only requesting Audio for Voice Messages. No Camera.
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        dom.permBlock.style.display = 'none';
        
        initProfileSystem(); // Start syncing profiles
        initChatSystem(); 
        initPresenceSystem();
        
        document.addEventListener("visibilitychange", () => {
             if (document.visibilityState === 'visible') markMySeen();
        });

    } catch (error) {
        console.warn("Permissions denied:", error);
        dom.permBlock.style.display = 'flex';
        dom.loader.style.display = 'none'; 
    }
}
dom.permRetryBtn.onclick = requestInitialPermissions;

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

// --- PRESENCE ---
function initPresenceSystem() {
    updateHeader(); // Initial load with defaults

    const sendHeartbeat = () => {
        if(document.visibilityState === 'visible') {
            setDoc(doc(db, 'status', currentUser), { online: serverTimestamp() }, { merge: true });
        }
    };
    sendHeartbeat();
    setInterval(sendHeartbeat, 10000); 

    onSnapshot(doc(db, 'status', getPartnerId()), (snap) => {
        if(snap.exists()) {
            const data = snap.data();
            partnerLastTimestamp = data.online ? data.online.toMillis() : 0;
            updateStatusUI();

            if (data.lastSeen) {
                partnerLastSeenTime = data.lastSeen.toMillis();
                updateSeenUI();
            }

            if (data.typing) {
                const typingTime = data.typing.toMillis();
                if (Date.now() - typingTime < 3000) {
                    dom.typingIndicator.style.display = 'flex';
                    if (typingTimeout) clearTimeout(typingTimeout);
                    typingTimeout = setTimeout(() => { dom.typingIndicator.style.display = 'none'; }, 3500);
                } else {
                    dom.typingIndicator.style.display = 'none';
                }
            }
        }
    });
    presenceInterval = setInterval(updateStatusUI, 30000);
}

dom.input.addEventListener('input', () => {
    const now = Date.now();
    if (now - myLastTyping > 2500) {
        myLastTyping = now;
        setDoc(doc(db, 'status', currentUser), { typing: serverTimestamp() }, { merge: true });
    }
});

async function markMySeen() {
    if (document.visibilityState !== 'visible' || !newestVisibleDoc) return; 
    const latestMsgTime = newestVisibleDoc.data().t;
    if (!latestMsgTime) return;
    const ms = latestMsgTime.toMillis();
    if (ms > myLastSeenWritten) {
        myLastSeenWritten = ms;
        await setDoc(doc(db, 'status', currentUser), { lastSeen: latestMsgTime }, { merge: true });
    }
}

function updateSeenUI() {
    if (!partnerLastSeenTime) return;
    document.querySelectorAll('.seen-label').forEach(el => el.remove());
    const myMessages = Array.from(document.querySelectorAll('.msg-row.me'));
    
    for (let i = myMessages.length - 1; i >= 0; i--) {
        const row = myMessages[i];
        const msgId = row.id.replace('msg-', '');
        const msgData = msgCache[msgId];

        if (msgData && msgData.t && msgData.t.toMillis() <= partnerLastSeenTime) {
            const meta = row.querySelector('.msg-meta');
            if (meta) {
                const seenSpan = document.createElement('span');
                seenSpan.className = 'seen-label';
                seenSpan.innerText = "Seen";
                meta.appendChild(seenSpan);
            }
            break; 
        }
    }
}

function updateStatusUI() {
    const diff = Date.now() - partnerLastTimestamp;
    
    if(diff < 20000) {
        dom.headStatusText.innerText = "Active Now"; 
        dom.headStatusText.style.color = "#34c759"; 
        dom.headStatusDot.classList.add('online');
    } else {
        dom.headStatusDot.classList.remove('online');
        dom.headStatusText.style.color = "#888";

        if (partnerLastTimestamp === 0) {
            dom.headStatusText.innerText = "Offline";
            return;
        }

        const date = new Date(partnerLastTimestamp);
        const now = new Date();
        const timeStr = date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        const isToday = date.toDateString() === now.toDateString();
        
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const isYesterday = date.toDateString() === yesterday.toDateString();

        if (isToday) {
            if(diff < 60000) {
                dom.headStatusText.innerText = "Last seen just now";
            } else if(diff < 3600000) {
                const mins = Math.floor(diff / 60000);
                dom.headStatusText.innerText = `Last seen ${mins} min ago ${timeStr}`;
            } else {
                dom.headStatusText.innerText = `Last seen ${timeStr}`;
            }
        } else if (isYesterday) {
            dom.headStatusText.innerText = `Last seen yesterday ${timeStr}`;
        } else {
            const day = date.getDate();
            const month = date.toLocaleString('default', { month: 'short' });
            dom.headStatusText.innerText = `Last seen ${day} ${month} at ${timeStr}`;
        }
    }
}

async function initChatSystem() {
    dom.list.innerHTML = ''; 
    
    // LOAD CUSTOM EMOJIS FIRST
    await loadCustomEmojis();

    oldestVisibleDoc = null; newestVisibleDoc = null;
    const qInitial = query(collection(db, "messages"), orderBy("t", "desc"), limit(BATCH_SIZE));
    const snapshot = await getDocs(qInitial);
    
    if (!snapshot.empty) {
        newestVisibleDoc = snapshot.docs[0]; oldestVisibleDoc = snapshot.docs[snapshot.docs.length - 1];
        const docsReversed = [...snapshot.docs].reverse();
        for (const doc of docsReversed) { await processMessageDoc(doc, "append"); }
        
        scrollToBottom();
        markMySeen(); 
    }

    setTimeout(() => { 
        dom.loader.style.display = 'none'; 
        dom.list.addEventListener('scroll', handleScroll);
        setupRealtimeListener();
        dom.scrollBtn.addEventListener('click', scrollToBottom);
    }, 500);
    
    document.addEventListener('click', (e) => {
        if(!dom.contextMenu.contains(e.target) && !e.target.closest('.msg-row')) {
            dom.contextMenu.classList.remove('active');
        }
        if(!dom.plusMenu.contains(e.target) && e.target !== dom.plusBtn) dom.plusMenu.style.display = 'none';
        if(e.target === dom.rxModal) dom.rxModal.style.display = 'none';
        if(e.target === dom.customRxModal) dom.customRxModal.style.display = 'none';
        if(e.target === dom.editModal) dom.editModal.style.display = 'none';
        if(e.target === dom.personsModal && e.target !== dom.personsListContainer) dom.personsModal.style.display = 'none';
        if(e.target === dom.nameEditModal) dom.nameEditModal.style.display = 'none';
    });
}

function setupRealtimeListener() {
    if (unsubscribeChat) unsubscribeChat();
    
    let q = oldestVisibleDoc ? 
        query(collection(db, "messages"), orderBy("t", "asc"), startAt(oldestVisibleDoc)) : 
        query(collection(db, "messages"), orderBy("t", "asc"));

    unsubscribeChat = onSnapshot(q, (snap) => {
        snap.docChanges().forEach((change) => {
            if (change.type === "added") {
                const isNearBottom = (dom.list.scrollHeight - dom.list.scrollTop - dom.list.clientHeight) < 150;
                processMessageDoc(change.doc, "append");
                
                if (!newestVisibleDoc || (change.doc.data().t && change.doc.data().t.toMillis() > newestVisibleDoc.data().t.toMillis())) {
                    newestVisibleDoc = change.doc;
                }

                if (isNearBottom) { 
                    setTimeout(() => {
                        scrollToBottom();
                        markMySeen(); 
                    }, 100);
                } else { 
                    dom.scrollBtn.classList.add('show'); dom.scrollBtn.classList.add('pulse'); 
                }
            }
            if (change.type === "modified") updateMessageInPlace(change.doc);
            if (change.type === "removed") {
                const row = document.getElementById(`msg-${change.doc.id}`);
                if (row) row.remove();
            }
        });
    });
}

function scrollToBottom() { 
    dom.list.scrollTop = dom.list.scrollHeight; 
    dom.scrollBtn.classList.remove('show'); 
    markMySeen(); 
}

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
            // RE-ATTACH LISTENER to include older messages
            setupRealtimeListener();
        } else { allHistoryLoaded = true; dom.spinner.innerText = "End of History"; }
        dom.spinner.style.display = 'none'; isLoadingHistory = false;
    }
    const dist = dom.list.scrollHeight - dom.list.scrollTop - dom.list.clientHeight;
    if (dist > 300) dom.scrollBtn.classList.add('show'); else { dom.scrollBtn.classList.remove('show'); dom.scrollBtn.classList.remove('pulse'); }
}

// --- RENDERER ---
async function processMessageDoc(doc, method) {
    if (document.getElementById(`msg-${doc.id}`)) return;

    const data = doc.data();
    msgCache[doc.id] = data; 
    if(data.hide && data.hide.includes(currentUser)) return;
    
    // --- NOTIFICATION RENDERER ---
    if (data.y === 'notify') {
        const div = document.createElement('div');
        div.id = `msg-${doc.id}`;
        div.className = 'msg-row notify';
        
        const bubble = document.createElement('div');
        bubble.className = 'notify-bubble';
        
        try {
            const dec = decrypt(data.d);
            const content = JSON.parse(dec);
            
            // Image (Above Middle)
            if(content.img) {
                const skel = document.createElement('div'); 
                skel.className = 'skeleton'; 
                skel.style.width = '60px'; 
                skel.style.height = '60px';
                skel.style.borderRadius = '50%';
                bubble.appendChild(skel);
                
                // Fetch Encrypted image if it is encrypted URL (usually public R2 url in notify but let's be safe)
                // Actually notifyPayload.img is the public URL itself, but content is fetched from S3/R2 usually encrypted.
                // In upload logic we saved: img: finalUrl (which is publicUrl/fname). 
                // And we uploaded ENCRYPTED blob. So fetch logic is needed.
                
                fetch(content.img).then(res => res.text()).then(txt => {
                    const b64 = decrypt(txt);
                    if(b64) {
                        skel.remove();
                        const img = document.createElement('img');
                        img.className = 'notify-img';
                        img.src = b64;
                        // Insert at top
                        bubble.insertBefore(img, bubble.firstChild);
                        img.onclick = () => openMediaViewer(b64, 'image');
                    }
                }).catch(() => { skel.remove(); });
            }
            
            // Text
            const span = document.createElement('span');
            span.innerText = content.text;
            bubble.appendChild(span);
            
        } catch(e) { bubble.innerText = "System Notification"; }
        
        div.appendChild(bubble);
        if (method === "append") dom.list.appendChild(div); else dom.list.insertBefore(div, dom.list.children[1] || null);
        return; 
    }
    // ----------------------------

    const div = document.createElement('div'); div.id = `msg-${doc.id}`; div.className = `msg-row ${data.s === currentUser ? 'me' : 'other'}`;
    
    // USE RESOLVED USER (DB AWARE)
    const senderInfo = resolveUser(data.s);

    if(data.s !== currentUser) {
        const img = document.createElement('img'); 
        img.src = senderInfo.avatar; 
        img.className = 'msg-avatar'; 
        div.appendChild(img);
    }
    if (method === "append") dom.list.appendChild(div); else dom.list.insertBefore(div, dom.list.children[1] || null);

    attachSwipeHandler(div, doc.id, data);
    
    // FIX: Robust Long Press that Cancels on Scroll
    div.addEventListener('contextmenu', (e) => { e.preventDefault(); }); // Disable default context menu
    let lp, sx=0, sy=0;
    const clearLp = () => clearTimeout(lp);
    
    div.addEventListener('touchstart', (e) => { 
        sx = e.touches[0].clientX; 
        sy = e.touches[0].clientY; 
        lp = setTimeout(() => openContextMenu(doc.id, data), 500); 
    }, {passive:true});
    
    div.addEventListener('touchmove', (e) => { 
        // If user moves finger more than 10px (scrolls), cancel the menu
        if(Math.abs(e.touches[0].clientX - sx) > 10 || Math.abs(e.touches[0].clientY - sy) > 10) clearLp(); 
    }, {passive:true});
    
    div.addEventListener('touchend', clearLp);
    div.addEventListener('touchcancel', clearLp);

    const bubble = document.createElement('div'); bubble.className = 'bubble';
    if(data.rep) {
        const rh = document.createElement('div'); rh.className = 'reply-header';
        let txt = decrypt(data.rep.d); if(txt && txt.includes('http') && !txt.includes(' ')) txt = "📷 Media";
        const repUser = resolveUser(data.rep.s); // USE RESOLVED USER
        rh.innerText = `${repUser.name}: ${txt ? txt.substring(0,20) : '...'}...`; bubble.appendChild(rh);
    }

    const contentDiv = document.createElement('div'); contentDiv.className = 'msg-content';
    
    // STORE RAW CONTENT HASH TO PREVENT UNNECESSARY RE-RENDERS
    contentDiv.dataset.raw = data.d; 
    
    const cleanText = data.y === 'unsent' ? null : decrypt(data.d);
    if(data.y === 'unsent') { contentDiv.innerHTML = "<span class='msg-unsent'>🚫 Message Unsent</span>"; }
    else {
        if(data.y === 'text' && isOnlyEmoji(cleanText)) bubble.classList.add('big-emoji');
        await renderContent(contentDiv, cleanText, data.y);
        // Add edited label if applicable
        if(data.edited && data.y === 'text') {
            contentDiv.insertAdjacentHTML('beforeend', '<span class="msg-edited">(edited)</span>');
        }
    }
    bubble.appendChild(contentDiv);

    const meta = document.createElement('div'); meta.className = 'msg-meta';
    const timeSpan = document.createElement('span'); timeSpan.className = 'msg-time'; timeSpan.innerText = formatTime(data.t);
    meta.appendChild(timeSpan); bubble.appendChild(meta);

    const rxDiv = document.createElement('div'); rxDiv.className = 'rx-container';
    rxDiv.onclick = (e) => { e.stopPropagation(); openRxModal(data.rx); };
    if(data.rx && Object.keys(data.rx).length > 0) {
        rxDiv.classList.add('show');
        div.style.marginBottom = "15px"; 
        Object.values(data.rx).forEach(e => {
            // APPLY CUSTOM EMOJI TO REACTION BUBBLE
            rxDiv.innerHTML += `<span class="rx-item rx-pop">${replaceCustomEmojis(e)}</span>`;
        });
    }
    bubble.appendChild(rxDiv); div.appendChild(bubble);

    updateSeenUI();
}

function updateMessageInPlace(doc) {
    const data = typeof doc.data === 'function' ? doc.data() : (doc.data ? doc.data : null);
    if(!data) return;
    
    msgCache[doc.id] = data; 
    const row = document.getElementById(`msg-${doc.id}`); if(!row) return;
    if(data.hide && data.hide.includes(currentUser)) { row.remove(); return; }
    
    if (data.y === 'notify') return; // Notifications don't update usually

    const content = row.querySelector('.msg-content');
    const bubble = row.querySelector('.bubble');

    if(data.y === 'unsent') {
        content.innerHTML = "<span class='msg-unsent'>🚫 Message Unsent</span>";
        bubble.classList.remove('big-emoji');
        const media = row.querySelector('img, video, audio, .custom-audio-player, .custom-video-player'); if(media) media.remove();
    } else {
        // CRITICAL FIX: Only re-render if content CHANGED
        if(content.dataset.raw !== data.d) {
            content.dataset.raw = data.d;
            
            const cleanText = decrypt(data.d);
            if(data.y === 'text' && isOnlyEmoji(cleanText)) bubble.classList.add('big-emoji'); 
            else bubble.classList.remove('big-emoji');
            
            renderContent(content, cleanText, data.y).then(() => {
                 if(data.edited && data.y === 'text') {
                    content.insertAdjacentHTML('beforeend', '<span class="msg-edited">(edited)</span>');
                }
            });
        }
    }

    const rxDiv = row.querySelector('.rx-container'); rxDiv.innerHTML = '';
    if(data.rx && Object.keys(data.rx).length > 0) {
        rxDiv.classList.add('show');
        row.style.marginBottom = "15px"; 
        Object.values(data.rx).forEach(e => {
            // APPLY CUSTOM EMOJI TO REACTION BUBBLE
            rxDiv.innerHTML += `<span class="rx-item rx-pop">${replaceCustomEmojis(e)}</span>`;
        });
        rxDiv.onclick = (e) => { e.stopPropagation(); openRxModal(data.rx); };
    } else { 
        rxDiv.classList.remove('show'); 
        row.style.marginBottom = ""; 
    }
}

// --- CONTEXT MENU ---
function openContextMenu(id, data) {
    if(data.y === 'notify') return; // No context menu for notifications

    vibrate(10); // VIBRATE
    ctxMsgId = id; ctxIsMe = (data.s === currentUser);
    dom.ctxUnsend.style.display = ctxIsMe ? 'block' : 'none';
    dom.ctxEdit.style.display = (ctxIsMe && data.y === 'text') ? 'block' : 'none';
    
    dom.contextMenu.dataset.rawContent = data.d; dom.contextMenu.dataset.sender = data.s;
    dom.contextMenu.classList.add('active');
}
dom.ctxClose.onclick = () => dom.contextMenu.classList.remove('active');

// --- EDIT MESSAGE FEATURE ---
dom.ctxEdit.onclick = () => {
    vibrate(10);
    dom.contextMenu.classList.remove('active');
    const currentText = decrypt(dom.contextMenu.dataset.rawContent);
    dom.inpEditMsg.value = currentText;
    dom.editModal.style.display = 'flex';
    dom.inpEditMsg.focus();
};
dom.btnEditCancel.onclick = () => dom.editModal.style.display = 'none';
dom.btnEditConfirm.onclick = async () => {
    const newText = dom.inpEditMsg.value.trim();
    if(!newText) return;
    
    dom.editModal.style.display = 'none';
    
    const cached = msgCache[ctxMsgId];
    if(cached) {
        cached.d = encrypt(newText);
        cached.edited = true;
        updateMessageInPlace({ id: ctxMsgId, data: cached });
    }

    await updateDoc(doc(db, "messages", ctxMsgId), {
        d: encrypt(newText),
        edited: true
    });
};

// --- CUSTOM REACTION FEATURE ---
// UPDATED: Delegated listener to handle clicks on replaced <img> tags
dom.rxPicker.addEventListener('click', async (e) => {
    const target = e.target.closest('span');
    if(target && target.closest('.rx-picker') === dom.rxPicker && target.id !== 'rx-custom-btn') {
        vibrate(10); // VIBRATE
        target.classList.add('selected');
        setTimeout(() => {
            target.classList.remove('selected');
            const emoji = target.dataset.emoji;
            applyReaction(emoji);
        }, 200); 
    }
});

dom.rxCustomBtn.onclick = (e) => {
    e.stopPropagation();
    vibrate(10);
    dom.contextMenu.classList.remove('active');
    dom.inpCustomRx.value = "";
    dom.customRxModal.style.display = 'flex';
    dom.inpCustomRx.focus();
};

dom.btnCustomRxCancel.onclick = () => dom.customRxModal.style.display = 'none';

dom.btnCustomRxConfirm.onclick = () => {
    const val = dom.inpCustomRx.value.trim();
    if(val) {
        applyReaction(val);
    }
    dom.customRxModal.style.display = 'none';
};

async function applyReaction(reaction) {
    if (!msgCache[ctxMsgId].rx) msgCache[ctxMsgId].rx = {};
    msgCache[ctxMsgId].rx[currentUser] = reaction;
    
    updateMessageInPlace({ id: ctxMsgId, data: msgCache[ctxMsgId] });

    const updateObj = {}; updateObj[`rx.${currentUser}`] = reaction;
    await updateDoc(doc(db, "messages", ctxMsgId), updateObj);
    dom.contextMenu.classList.remove('active');
}

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
        const u = resolveUser(uid); // USE RESOLVED USER
        // APPLY CUSTOM EMOJI TO RX MODAL
        dom.rxList.innerHTML += `<div class="rx-detail-row"><img src="${u.avatar}" style="width:24px;height:24px;border-radius:50%"><span style="flex:1;font-weight:bold">${u.name}</span><span style="font-size:20px">${replaceCustomEmojis(emoji)}</span></div>`;
    });
    dom.rxModal.style.display = 'flex';
}
dom.closeRxModal.onclick = () => dom.rxModal.style.display = 'none';

async function renderContent(wrapper, content, type) {
    if (type === 'text') { 
        // --- ESCAPE HTML ---
        const safeText = content
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");

        // --- AUTO-LINKER REGEX ---
        let linkedText = safeText.replace(
            /(\b(?:https?:\/\/|www\.|[a-zA-Z0-9-]+\.[a-zA-Z]{2,})[^\s]*)/g, 
            (url) => {
                let href = url;
                if (!href.startsWith('http') && !href.startsWith('//')) {
                    href = 'https://' + href;
                }
                return `<a href="${href}" target="_blank">${url}</a>`;
            }
        );
        
        // --- APPLY CUSTOM EMOJIS ---
        linkedText = replaceCustomEmojis(linkedText);

        wrapper.innerHTML = linkedText;

    } 
    else if (type === 'media') {
        wrapper.innerHTML = ''; // FIX FOR DOUBLE MEDIA RENDERING
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
dom.ctxReply.onclick = () => { 
    vibrate(10); // VIBRATE
    startReply(ctxMsgId, dom.contextMenu.dataset.rawContent, dom.contextMenu.dataset.sender); 
    dom.contextMenu.classList.remove('active'); 
};
dom.ctxUnsend.onclick = async () => { 
    vibrate(10); // VIBRATE
    if(confirm("Unsend?")) await updateDoc(doc(db, "messages", ctxMsgId), { y: 'unsent' }); 
    dom.contextMenu.classList.remove('active'); 
};
dom.ctxRemove.onclick = async () => { 
    vibrate(10); // VIBRATE
    await updateDoc(doc(db, "messages", ctxMsgId), { hide: arrayUnion(currentUser) }); 
    document.getElementById(`msg-${ctxMsgId}`).remove(); 
    dom.contextMenu.classList.remove('active'); 
};
function startReply(id, encContent, senderId) {
    currentReply = { id, d: encContent, s: senderId };
    const senderInfo = resolveUser(senderId); // USE RESOLVED USER
    dom.replyBar.style.display = 'flex'; dom.replyUser.innerText = `Replying to ${senderInfo.name}`;
    let clean = decrypt(encContent); if(clean.includes('http') && !clean.includes(' ')) clean = "📷 Media";
    dom.replyText.innerText = clean; dom.input.focus();
}
dom.btnReplyCancel.onclick = () => { currentReply = null; dom.replyBar.style.display = 'none'; };

// FIX: Enhanced Swipe Handler (Locks Vertical Scrolling)
function attachSwipeHandler(row, id, data) {
    let startX = 0, startY = 0, isScrolling = false;
    
    row.addEventListener('touchstart', e => { 
        startX = e.touches[0].clientX; 
        startY = e.touches[0].clientY; 
        isScrolling = false; 
    }, {passive: true});
    
    row.addEventListener('touchmove', e => { 
        const diffX = e.touches[0].clientX - startX;
        const diffY = e.touches[0].clientY - startY;
        
        // If vertical movement detected early, lock it as vertical scroll
        if (Math.abs(diffY) > Math.abs(diffX)) {
            isScrolling = true;
        }

        // Only animate horizontal swipe if we are NOT scrolling vertically
        if(!isScrolling && diffX > 0 && diffX < 100) {
            row.style.transform = `translateX(${diffX}px)`; 
        }
    }, {passive: true});
    
    row.addEventListener('touchend', e => { 
        if(!isScrolling && e.changedTouches[0].clientX - startX > 60) { 
            vibrate(20); // VIBRATE
            startReply(id, data.d, data.s); 
        } 
        row.style.transform = 'translateX(0)'; 
    });
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
    vibrate(10); // VIBRATE
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
        dom.input.value = ""; dom.input.placeholder = "Recording... Tap (X) to cancel";
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
