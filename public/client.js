const socket = io();
const canvas = document.getElementById('myCanvas');
const ctx = canvas.getContext('2d');
const colorPicker = document.getElementById('colorPicker');
const messageDisplay = document.getElementById('message');
const userListContainer = document.getElementById('userListContainer');

const logoutBtn = document.getElementById('logoutBtn');
const loggedInUserSpan = document.getElementById('loggedInUser');

const settingsModal = document.getElementById('settingsModal');
const closeButton = settingsModal.querySelector('.close-button');
const tabButtons = settingsModal.querySelectorAll('.tab-button');
const tabContents = settingsModal.querySelectorAll('.tab-content');

const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const loginMessage = document.getElementById('loginMessage');
const registerMessage = document.getElementById('registerMessage');

const manualThemeToggleBtn = document.getElementById('manualThemeToggleBtn');
const themeSliderContainer = document.getElementById('themeSliderContainer');
const themeSlider = document.getElementById('themeSlider');

const hamburgerMenuBtn = document.getElementById('hamburger-menu-btn');
const sidebar = document.getElementById('sidebar');
const closeSidebarBtn = document.getElementById('close-sidebar-btn');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const sidebarSettingsLink = document.getElementById('sidebar-settings-link');

const BIT_SIZE = 5;
const CANVAS_PIXEL_WIDTH = 500;
const CANVAS_PIXEL_HEIGHT = 500;

const CANVAS_GRID_WIDTH = CANVAS_PIXEL_WIDTH / BIT_SIZE;
const CANVAS_GRID_HEIGHT = CANVAS_PIXEL_HEIGHT / BIT_SIZE;

canvas.width = CANVAS_PIXEL_WIDTH;
canvas.height = CANVAS_PIXEL_HEIGHT;

let currentUserId = null;
let lastGeoInfo = null;

// --- ズーム機能関連の変数 ---
let isZoomed = false; // ズーム状態を管理するフラグ
const zoomLevel = 2; // ズーム倍率 (例: 2倍)

function getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for(let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) === ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
}

function drawPixel(x, y, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x * BIT_SIZE, y * BIT_SIZE, BIT_SIZE, BIT_SIZE);
}

function displayMessage(msg, type = 'info') {
    messageDisplay.textContent = msg;
    messageDisplay.className = '';
    messageDisplay.classList.add(type);
}

async function updateAuthUI() {
    try {
        const response = await fetch('/user');
        const user = await response.json();

        if (user && user.id) {
            currentUserId = user.id;
            loggedInUserSpan.textContent = `Logged in as ${user.username} (${user.authType})`;
            logoutBtn.style.display = 'inline';
            canvas.style.cursor = 'pointer';
        } else {
            currentUserId = getCookie('user_id');
            if (!currentUserId) {
                loggedInUserSpan.textContent = `Connecting...`;
            } else {
                loggedInUserSpan.textContent = `Logged in as Guest (${currentUserId.substring(0,4)})`;
            }
            logoutBtn.style.display = 'none';
            canvas.style.cursor = 'not-allowed';
            displayMessage('Please login or register to paint.', 'info');
        }
    } catch (error) {
        console.error('Failed to fetch user status:', error);
        loggedInUserSpan.textContent = 'Error fetching user status.';
        logoutBtn.style.display = 'none';
        canvas.style.cursor = 'not-allowed';
        displayMessage('Error: Cannot connect to server for authentication.', 'error');
    }
}

updateAuthUI();

socket.on('initialCanvas', (pixels) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pixels.forEach(pixel => {
        drawPixel(pixel.x, pixel.y, pixel.color);
    });
    console.log('Initial canvas loaded.');
    displayMessage('Click on the canvas to paint a pixel! Right-click to zoom.', 'info');
});

socket.on('paintPixel', (pixel) => {
    drawPixel(pixel.x, pixel.y, pixel.color);
    console.log(`Received and painted pixel: (${pixel.x}, ${pixel.y}) with color ${pixel.color}`);
});

socket.on('paintError', (message) => {
    console.error('Paint error:', message);
    displayMessage(message, 'error');
});

socket.on('paintSuccess', (message) => {
    console.log('Paint success:', message);
    displayMessage(message, 'success');
});

// --- ズーム機能のための右クリックイベントリスナー追加 ---
canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault(); // デフォルトの右クリックメニューを抑制
});

canvas.addEventListener('mousedown', (event) => {
    // 右クリック (button === 2) を検出
    if (event.button === 2) {
        event.preventDefault(); // デフォルトのコンテキストメニューを抑制

        if (isZoomed) {
            // ズームアウト
            canvas.classList.remove('zoomed');
            canvas.style.transform = ''; // スケールをリセット
            canvas.style.transformOrigin = ''; // 原点もリセット
            displayMessage('Zoom out.', 'info');
        } else {
            // ズームイン
            canvas.style.transformOrigin = 'center center'; // 中心を基準にズーム
            canvas.classList.add('zoomed');
            canvas.style.transform = `scale(${zoomLevel})`; // 設定した倍率でズーム
            displayMessage(`Zoom in (${zoomLevel}x).`, 'info');
        }
        isZoomed = !isZoomed; // ズーム状態を切り替え
    }
});


canvas.addEventListener('click', (event) => {
    if (!currentUserId || loggedInUserSpan.textContent.includes('Guest')) {
        displayMessage('Please login or register to paint.', 'error');
        openSettingsModal('login');
        return;
    }

    const rect = canvas.getBoundingClientRect(); // キャンバスの現在のDOM上の情報（ズームで見た目は変わるが、論理的なサイズ）

    let logicalX, logicalY;

    if (isZoomed) {
        // ズームインしている場合、マウス座標を逆算して拡大前の論理的なキャンバス座標に変換
        // transform-origin が 'center center' であることを前提とする
        // キャンバスの論理的な中心座標 (DOM上の位置 + 論理的な幅/高さの半分)
        const canvasLogicalCenterX = rect.left + rect.width / 2;
        const canvasLogicalCenterY = rect.top + rect.height / 2;

        // マウスのクリック位置とキャンバス論理的中心とのオフセット
        const offsetX = event.clientX - canvasLogicalCenterX;
        const offsetY = event.clientY - canvasLogicalCenterY;

        // オフセットをズーム率で割って、拡大前の論理的なマウス位置を計算
        // これがキャンバスの左上からの論理的な相対座標になる
        logicalX = (offsetX / zoomLevel) + (rect.width / 2);
        logicalY = (offsetY / zoomLevel) + (rect.height / 2);

    } else {
        // ズームインしていない場合 (従来の計算でOK)
        logicalX = event.clientX - rect.left;
        logicalY = event.clientY - rect.top;
    }

    // 論理的なキャンバス座標をグリッド座標に変換
    const bitX = Math.floor(logicalX / BIT_SIZE);
    const bitY = Math.floor(logicalY / BIT_SIZE);

    const selectedColor = colorPicker.value;

    socket.emit('requestPaint', { x: bitX, y: bitY, color: selectedColor });
});

socket.on('updateUserList', (userList) => {
    let html = '<ul id="userList">';
    if (userList.length === 0) {
        html += '<li>No participants yet.</li>';
    } else {
        userList.forEach(user => {
            let userClass = '';
            let userRankText = '';
            let isAdminLabel = ''; // For the "Admin" text to the right

            if (user.isAdmin) {
                userClass = 'admin-user'; // Apply admin-user class for base styling
                isAdminLabel = '<span class="admin-label">Admin</span>';
            } else if (user.pixelsPainted >= 30) {
                userClass = 'power-user';
                userRankText = ' (Power)';
            } else if (user.pixelsPainted >= 10) {
                userClass = 'pro-player';
            } else {
                userClass = 'normal-user'; // Green italic for normal users
            }

            const isMe = user.id === currentUserId ? ' (You)' : '';

            let userDisplay = '';
            let userIcon = '';

            switch (user.type) {
                case 'github':
                    userDisplay = `<a href="${user.profileUrl}" target="_blank" rel="noopener noreferrer">${user.name}</a>`;
                    userIcon = `<span class="icon github-icon"><i class="fab fa-github"></i></span>`;
                    break;
                case 'google':
                    userDisplay = `<a href="${user.profileUrl || '#'}" target="_blank" rel="noopener noreferrer">${user.name}</a>`;
                    userIcon = `<span class="icon google-icon"><i class="fab fa-google"></i></span>`;
                    break;
                case 'local':
                    userDisplay = user.name;
                    userIcon = `<span class="icon local-icon"><i class="fas fa-user"></i></span>`;
                    break;
                case 'guest':
                default:
                    userDisplay = user.name;
                    userIcon = `<span class="icon guest-icon"><i class="fas fa-user-circle"></i></span>`;
                    break;
            }
            // Place isAdminLabel at the end of the list item
            html += `<li class="${userClass}">${userIcon} ${userDisplay}${userRankText}${isMe} ${isAdminLabel}</li>`;
        });
    }
    html += '</ul>';
    userListContainer.innerHTML = html;
    console.log('User list updated:', userList);
});


// --- 設定モーダルとフォームのロジック ---

function openSettingsModal(defaultTab = 'theme') {
    settingsModal.style.display = 'flex';
    tabButtons.forEach(btn => btn.classList.remove('active'));
    tabContents.forEach(content => content.classList.remove('active'));

    const defaultTabButton = settingsModal.querySelector(`[data-tab="${defaultTab}"]`);
    const defaultTabContent = document.getElementById(`${defaultTab}FormTab`);

    if (defaultTabButton) defaultTabButton.classList.add('active');
    if (defaultTabContent) defaultTabContent.classList.add('active');

    updateAuthUI();
    loginMessage.textContent = '';
    registerMessage.textContent = '';
}


closeButton.addEventListener('click', () => {
    settingsModal.style.display = 'none';
    loginMessage.textContent = '';
    registerMessage.textContent = '';
});

window.addEventListener('click', (event) => {
    if (event.target === settingsModal) {
        settingsModal.style.display = 'none';
        loginMessage.textContent = '';
        registerMessage.textContent = '';
    }
});

tabButtons.forEach(button => {
    button.addEventListener('click', () => {
        const tab = button.dataset.tab;

        tabButtons.forEach(btn => btn.classList.remove('active'));
        tabContents.forEach(content => content.classList.remove('active'));

        button.classList.add('active');
        document.getElementById(`${tab}FormTab`).classList.add('active');

        loginMessage.textContent = '';
        registerMessage.textContent = '';
    });
});

loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    loginMessage.textContent = 'Logging in...';
    loginMessage.className = 'form-message info';

    try {
        const response = await fetch('/login/password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });
        const data = await response.json();

        if (data.success) {
            loginMessage.textContent = data.message;
            loginMessage.className = 'form-message success';
            await updateAuthUI();
            socket.emit('reconnectUser');
            displayMessage('Logged in successfully! You can now paint.', 'success');
        } else {
            loginMessage.textContent = data.message;
            loginMessage.className = 'form-message error';
        }
    } catch (error) {
        console.error('Login error:', error);
        loginMessage.textContent = 'An error occurred during login. Please try again.';
        loginMessage.className = 'form-message error';
    }
});

registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = document.getElementById('registerUsername').value;
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;

    registerMessage.textContent = 'Registering...';
    registerMessage.className = 'form-message info';

    try {
        const response = await fetch('/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, email, password })
        });
        const data = await response.json();

        if (data.success) {
            registerMessage.textContent = data.message;
            registerMessage.className = 'form-message success';
            await updateAuthUI();
            socket.emit('reconnectUser');
            displayMessage('Registration successful! You can now paint.', 'success');
        } else {
            registerMessage.textContent = data.message;
            registerMessage.className = 'form-message error';
        }
    } catch (error) {
        console.error('Registration error:', error);
        registerMessage.textContent = 'An error occurred during registration. Please try again.';
        registerMessage.className = 'form-message error';
    }
});

logoutBtn.addEventListener('click', async (event) => {
    event.preventDefault();
    try {
        const response = await fetch('/logout');
        if (response.ok) {
            currentUserId = null;
            await updateAuthUI();
            displayMessage('Logged out successfully.', 'info');
            socket.disconnect();
            socket.connect();
        } else {
            displayMessage('Logout failed.', 'error');
        }
    } catch (error) {
        console.error('Logout error:', error);
        displayMessage('An error occurred during logout.', 'error');
    }
});

socket.on('connect', () => {
    console.log('Socket reconnected, requesting user update.');
    socket.emit('requestUserUpdate');
});

socket.on('requestUserUpdate', () => {
    updateAuthUI();
});

document.addEventListener('DOMContentLoaded', updateAuthUI);


// --- テーマ切り替えロジック ---

function applyTheme(isDark) {
    if (isDark) {
        document.body.classList.add('dark-mode');
    } else {
        document.body.classList.remove('dark-mode');
    }
}

function saveManualThemePreference(isDark) {
    localStorage.setItem('manualThemeEnabled', 'true');
    localStorage.setItem('isDarkMode', isDark ? 'true' : 'false');
}

function loadManualThemePreference() {
    const manualEnabled = localStorage.getItem('manualThemeEnabled');
    if (manualEnabled === 'true') {
        const isDark = localStorage.getItem('isDarkMode') === 'true';
        themeSlider.checked = isDark;
        applyTheme(isDark);
        themeSliderContainer.classList.add('visible');
        return true;
    }
    return false;
}

manualThemeToggleBtn.addEventListener('click', () => {
    const isVisible = themeSliderContainer.classList.toggle('visible');
    if (isVisible) {
        localStorage.setItem('manualThemeEnabled', 'true');
        applyTheme(themeSlider.checked);
        console.log('Manual theme toggle activated. GeoIP theme disabled.');
    } else {
        localStorage.removeItem('manualThemeEnabled');
        localStorage.removeItem('isDarkMode');
        console.log('Manual theme toggle deactivated. GeoIP theme re-enabled.');
        if (lastGeoInfo && lastGeoInfo.timezone) {
            handleGeoLocation(lastGeoInfo);
        } else {
            if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                applyTheme(true);
            } else {
                applyTheme(false);
            }
        }
    }
});

themeSlider.addEventListener('change', () => {
    const isDark = themeSlider.checked;
    applyTheme(isDark);
    saveManualThemePreference(isDark);
    console.log(`Theme manually set to ${isDark ? 'Dark' : 'Light'}`);
});


function handleGeoLocation(data) {
    if (data.timezone) {
        try {
            const now = new Date();
            const options = { timeZone: data.timezone, hour: 'numeric', hour12: false };
            const currentHour = parseInt(new Intl.DateTimeFormat('en-US', options).format(now), 10);
            console.log(`Calculated current hour for ${data.timezone}: ${currentHour}`);

            const isNight = currentHour >= 18 || currentHour < 6;
            console.log(`Is it night? ${isNight} (Current Hour: ${currentHour})`);

            applyTheme(isNight);
            console.log(`Applying theme based on GeoIP: ${isNight ? 'Dark' : 'Light'}`);
        } catch (e) {
            console.error('Error determining time based on timezone:', e);
            applyTheme(false);
        }
    } else {
        console.log('No timezone info received, or geo lookup failed. Using system default.');
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            applyTheme(true);
        } else {
            applyTheme(false);
        }
    }
}

socket.on('geoLocation', (data) => {
    console.log('Received GeoLocation data:', data);
    lastGeoInfo = data;

    if (localStorage.getItem('manualThemeEnabled') === 'true') {
        console.log('Manual theme is enabled, skipping GeoIP theme application.');
        return;
    }

    handleGeoLocation(data);
});

document.addEventListener('DOMContentLoaded', () => {
    updateAuthUI();

    const manualThemeActive = loadManualThemePreference();

    if (!manualThemeActive) {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            applyTheme(true);
        } else {
            applyTheme(false);
        }
    }
});


// --- サイドバーメニューのロジック ---

function openSidebar() {
    sidebar.classList.add('open');
    sidebarOverlay.classList.add('active');
}

function closeSidebar() {
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('active');
}

hamburgerMenuBtn.addEventListener('click', openSidebar);
closeSidebarBtn.addEventListener('click', closeSidebar);
sidebarOverlay.addEventListener('click', closeSidebar);

sidebarSettingsLink.addEventListener('click', (event) => {
    event.preventDefault();
    closeSidebar();
    openSettingsModal('theme');
});

const sidebarAboutLink = document.getElementById('sidebar-about-link');
if (sidebarAboutLink) {
    sidebarAboutLink.addEventListener('click', (event) => {
        event.preventDefault();
        closeSidebar();
        alert('About page content would go here!');
    });
}