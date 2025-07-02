const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const Database = require('better-sqlite3');
const path = require('path');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
const session = require('express-session');
const passport = require('passport');
const GitHubStrategy = require('passport-github2').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const axios = require('axios');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'your_secret_key';
const ADMIN_USER_ID = process.env.ADMIN_USER_ID; // 管理者ユーザーのID

// SQLiteデータベースの初期化
const dbPath = path.join(__dirname, 'data', 'canvas.db');
const db = new Database(dbPath, { verbose: console.log });

// Pixelsテーブルの作成
db.exec(`
    CREATE TABLE IF NOT EXISTS pixels (
        x INTEGER,
        y INTEGER,
        color TEXT,
        timestamp INTEGER,
        userId TEXT,
        PRIMARY KEY (x, y)
    );
`);

// users テーブルの追加 (pixelsPainted カラムを追加)
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE,
        email TEXT UNIQUE,
        password TEXT,
        authType TEXT NOT NULL, -- 'github', 'google', 'local', 'guest'
        profileUrl TEXT,
        isAdmin INTEGER DEFAULT 0,
        pixelsPainted INTEGER DEFAULT 0 -- 新しいカラム: 描画したピクセル数
    );
`);

// User Cooldownsテーブルの作成
db.exec(`
    CREATE TABLE IF NOT EXISTS user_cooldowns (
        userId TEXT PRIMARY KEY,
        lastPaintTime INTEGER,
        FOREIGN KEY (userId) REFERENCES users(id)
    );
`);

console.log('Database initialized.');

// Expressミドルウェア
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// セッションミドルウェア
const sessionMiddleware = session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
});
app.use(sessionMiddleware);

// Passport.jsの初期化
app.use(passport.initialize());
app.use(passport.session());

// Passport.js シリアライズ/デシリアライズ
passport.serializeUser((user, done) => {
    console.log('serializeUser:', user.id);
    done(null, user.id);
});

passport.deserializeUser((id, done) => {
    console.log('deserializeUser:', id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (user) {
        done(null, user);
    } else {
        done(null, false);
    }
});

// GitHub認証戦略
passport.use(new GitHubStrategy({
    clientID: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    callbackURL: "/auth/github/callback"
},
function(accessToken, refreshToken, profile, done) {
    console.log('GitHub Profile:', profile);
    let user = db.prepare("SELECT * FROM users WHERE id = ? AND authType = 'github'").get(profile.id);
    if (!user) {
        try {
            user = db.prepare('INSERT INTO users (id, username, authType, profileUrl, isAdmin) VALUES (?, ?, ?, ?, ?) RETURNING *').get(
                profile.id,
                profile.username,
                'github',
                profile.profileUrl,
                profile.id === ADMIN_USER_ID ? 1 : 0
            );
            console.log('New GitHub user created:', user.username);
        } catch (err) {
            if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' && err.message.includes('users.username')) {
                console.warn(`GitHub username "${profile.username}" already exists. Attempting to retrieve existing user.`);
                user = db.prepare("SELECT * FROM users WHERE username = ? AND authType = 'github'").get(profile.username);
                if (user) {
                    console.log('Retrieved existing GitHub user due to username collision:', user.username);
                } else {
                    console.error('Failed to retrieve existing GitHub user after username collision.');
                    return done(err);
                }
            } else {
                return done(err);
            }
        }
    } else {
        db.prepare("UPDATE users SET username = ?, profileUrl = ?, isAdmin = ? WHERE id = ? AND authType = 'github'").run(
            profile.username,
            profile.profileUrl,
            profile.id === ADMIN_USER_ID ? 1 : 0,
            profile.id
        );
        user = db.prepare("SELECT * FROM users WHERE id = ? AND authType = 'github'").get(profile.id);
        console.log('Existing GitHub user updated:', user.username);
    }
    return done(null, user);
}));

// Google認証戦略
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "/auth/google/callback"
},
function(accessToken, refreshToken, profile, done) {
    console.log('Google Profile:', profile);
    let user = db.prepare("SELECT * FROM users WHERE id = ? AND authType = 'google'").get(profile.id);
    if (!user) {
        try {
            user = db.prepare('INSERT INTO users (id, username, email, authType, profileUrl, isAdmin) VALUES (?, ?, ?, ?, ?, ?) RETURNING *').get(
                profile.id,
                profile.displayName,
                profile.emails && profile.emails.length > 0 ? profile.emails[0].value : null,
                'google',
                profile.photos && profile.photos.length > 0 ? profile.photos[0].value : null,
                profile.id === ADMIN_USER_ID ? 1 : 0
            );
            console.log('New Google user created:', user.username);
        } catch (err) {
            if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                if (err.message.includes('users.username') || err.message.includes('users.email')) {
                    console.warn(`Google user collision for username "${profile.displayName}" or email "${profile.emails[0].value}". Attempting to retrieve existing user.`);
                    user = db.prepare("SELECT * FROM users WHERE (username = ? OR email = ?) AND authType = 'google'").get(profile.displayName, profile.emails[0].value);
                    if (user) {
                        console.log('Retrieved existing Google user due to collision:', user.username);
                    } else {
                        console.error('Failed to retrieve existing Google user after collision. This should not happen if the user exists.');
                        return done(err);
                    }
                } else {
                    return done(err);
                }
            } else {
                return done(err);
            }
        }
    } else {
        db.prepare("UPDATE users SET username = ?, email = ?, profileUrl = ?, isAdmin = ? WHERE id = ? AND authType = 'google'").run(
            profile.displayName,
            profile.emails && profile.emails.length > 0 ? profile.emails[0].value : null,
            profile.photos && profile.photos.length > 0 ? profile.photos[0].value : null,
            profile.id === ADMIN_USER_ID ? 1 : 0,
            profile.id
        );
        user = db.prepare("SELECT * FROM users WHERE id = ? AND authType = 'google'").get(profile.id);
        console.log('Existing Google user updated:', user.username);
    }
    return done(null, user);
}));

// ローカル認証戦略 (メールアドレスとパスワード)
passport.use(new LocalStrategy({
    usernameField: 'email',
    passwordField: 'password'
},
async (email, password, done) => {
    try {
        const user = db.prepare("SELECT * FROM users WHERE email = ? AND authType = 'local'").get(email);
        if (!user) {
            return done(null, false, { message: 'Incorrect email.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return done(null, false, { message: 'Incorrect password.' });
        }
        return done(null, user);
    } catch (err) {
        return done(err);
    }
}));


// 静的ファイルを配信
app.use(express.static(path.join(__dirname, 'public')));

// ルート定義

// 認証ルート
app.get('/auth/github', passport.authenticate('github', { scope: ['user:email'] }));
app.get('/auth/github/callback',
    passport.authenticate('github', { failureRedirect: '/' }),
    (req, res) => {
        res.cookie('user_id', req.user.id, { maxAge: 24 * 60 * 60 * 1000, httpOnly: true });
        res.redirect('/');
    });

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/' }),
    (req, res) => {
        res.cookie('user_id', req.user.id, { maxAge: 24 * 60 * 60 * 1000, httpOnly: true });
        res.redirect('/');
    });

// ローカルユーザー登録ルート
app.post('/register', async (req, res) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ success: false, message: 'All fields are required.' });
    }

    try {
        const existingUserByEmail = db.prepare("SELECT id FROM users WHERE email = ? AND authType = 'local'").get(email);
        if (existingUserByEmail) {
            return res.status(409).json({ success: false, message: 'Email already registered.' });
        }
        const existingUserByUsername = db.prepare("SELECT id FROM users WHERE username = ? AND authType = 'local'").get(username);
        if (existingUserByUsername) {
            return res.status(409).json({ success: false, message: 'Username already taken.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUserId = uuidv4();
        const user = db.prepare('INSERT INTO users (id, username, email, password, authType, isAdmin) VALUES (?, ?, ?, ?, ?, ?) RETURNING *').get(
            newUserId,
            username,
            email,
            hashedPassword,
            'local',
            newUserId === ADMIN_USER_ID ? 1 : 0
        );

        req.login(user, (err) => {
            if (err) {
                console.error('Error during login after registration:', err);
                return res.status(500).json({ success: false, message: 'Registration successful, but failed to log in.' });
            }
            res.cookie('user_id', user.id, { maxAge: 24 * 60 * 60 * 1000, httpOnly: true });
            return res.status(200).json({ success: true, message: 'Registration successful!', user: { id: user.id, username: user.username, authType: user.authType } });
        });

    } catch (err) {
        console.error('Registration error:', err);
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ success: false, message: 'Username or email is already in use.' });
        }
        res.status(500).json({ success: false, message: 'Server error during registration.' });
    }
});

// ローカルユーザーログインルート
app.post('/login/password', (req, res, next) => {
    passport.authenticate('local', (err, user, info) => {
        if (err) {
            console.error('Passport authentication error:', err);
            return res.status(500).json({ success: false, message: 'Authentication error.' });
        }
        if (!user) {
            return res.status(401).json({ success: false, message: info.message || 'Invalid credentials.' });
        }
        req.login(user, (err) => {
            if (err) {
                console.error('Error during login:', err);
                return res.status(500).json({ success: false, message: 'Failed to log in.' });
            }
            res.cookie('user_id', user.id, { maxAge: 24 * 60 * 60 * 1000, httpOnly: true });
            return res.status(200).json({ success: true, message: 'Logged in successfully!', user: { id: user.id, username: user.username, authType: user.authType } });
        });
    })(req, res, next);
});


// ログアウトルート
app.get('/logout', (req, res) => {
    req.logout((err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.status(500).send('Logout failed.');
        }
        res.clearCookie('user_id');
        res.redirect('/');
    });
});

// ユーザー情報取得ルート (クライアントサイドからログイン状態を確認するため)
app.get('/user', (req, res) => {
    if (req.isAuthenticated() && req.user) {
        const user = req.user;
        res.json({
            id: user.id,
            username: user.username,
            email: user.email,
            authType: user.authType,
            profileUrl: user.profileUrl,
            isAdmin: user.isAdmin
        });
    } else {
        res.json(null);
    }
});


// GeoIP情報を取得する関数
async function getGeoLocation(ipAddress) {
    // ローカルループバックアドレスやプライベートIPアドレスの場合はGeoIPをスキップし、デフォルト値を返す
    // IPv6のループバックアドレス ::1 も含める
    if (ipAddress === '::1' || ipAddress === '127.0.0.1' || ipAddress.startsWith('192.168.') || ipAddress.startsWith('172.16.') || ipAddress.startsWith('10.')) {
        console.log('Localhost or private IP connection, skipping GeoIP lookup. Returning default Japan timezone.');
        // テスト用に日本のタイムゾーンを返す
        return { status: 'success', country: 'Japan', timezone: 'Asia/Tokyo' };
    }

    // IPv6形式のIPアドレスがIPv4形式にマッピングされている場合 (例: ::ffff:127.0.0.1)
    // 最後のIPv4部分を抽出して再評価
    if (ipAddress.startsWith('::ffff:')) {
        const ipv4Part = ipAddress.split(':').pop();
        if (ipv4Part === '127.0.0.1' || ipv4Part.startsWith('192.168.') || ipv4Part.startsWith('172.16.') || ipv4Part.startsWith('10.')) {
            console.log(`IPv6-mapped private IP (${ipAddress}), skipping GeoIP lookup. Returning default Japan timezone.`);
            return { status: 'success', country: 'Japan', timezone: 'Asia/Tokyo' };
        }
    }


    try {
        console.log(`Attempting GeoIP lookup for IP: ${ipAddress}`);
        const response = await axios.get(`http://ip-api.com/json/${ipAddress}`);
        console.log('GeoIP API Response:', response.data); // レスポンス全体をログ
        return response.data;
    } catch (error) {
        console.error('GeoIP lookup failed:', error.message);
        return { status: 'fail', message: error.message };
    }
}


// Socket.IO接続
io.on('connection', async (socket) => {
    console.log('A user connected');

    // クライアントのIPアドレスを取得し、GeoIP情報を送信
    // Expressのreq.ipはクライアントのIPアドレスを返す
    // Socket.IOでは socket.handshake.address で取得できる
    const clientIp = socket.handshake.address;
    const geoInfo = await getGeoLocation(clientIp);
    if (geoInfo && geoInfo.status === 'success') {
        console.log(`Sending GeoLocation to client: Country=${geoInfo.country}, Timezone=${geoInfo.timezone}`);
        socket.emit('geoLocation', { country: geoInfo.country, timezone: geoInfo.timezone });
    } else {
        console.log(`GeoIP lookup failed for ${clientIp}. Sending null GeoLocation.`);
        socket.emit('geoLocation', { country: null, timezone: null });
    }


    let currentUserId = null;
    if (socket.request.session && socket.request.session.passport && socket.request.session.passport.user) {
        currentUserId = socket.request.session.passport.user;
    }

    let user;
    if (currentUserId) {
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(currentUserId);
        if (!user) {
            console.error(`Authenticated user ID ${currentUserId} not found in DB. Disconnecting.`);
            socket.disconnect(true);
            return;
        }
        console.log(`Authenticated user connected: ${user.username} (${user.id})`);
    } else {
        let guestId = socket.request.session.id;

        user = db.prepare("SELECT * FROM users WHERE id = ? AND authType = 'guest'").get(guestId);

        if (!user) {
            try {
                // 新規ゲストユーザー作成時にisAdminも設定
                user = db.prepare('INSERT INTO users (id, username, authType, isAdmin) VALUES (?, ?, ?, ?) RETURNING *').get(
                    guestId,
                    `Guest-${guestId.substring(0, 8)}`, // ゲストユーザー名を短くして表示しやすく
                    'guest',
                    guestId === ADMIN_USER_ID ? 1 : 0
                );
                console.log('New guest user created in DB:', user.username);
            } catch (err) {
                if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' && err.message.includes('users.username')) {
                    console.warn(`Guest username collision for ID ${guestId}. Attempting to retrieve existing guest user.`);
                    user = db.prepare("SELECT * FROM users WHERE id = ? AND authType = 'guest'").get(guestId);
                    if (!user) {
                        console.error('Failed to retrieve existing guest user after username collision. Disconnecting.');
                        socket.disconnect(true);
                        return;
                    }
                } else {
                    console.error('Error creating guest user:', err.message);
                    socket.disconnect(true);
                    return;
                }
            }
        }
        console.log(`Guest user connected: ${user.username} (${user.id})`);
    }

    socket.userId = user.id;
    socket.username = user.username;
    socket.authType = user.authType;
    socket.profileUrl = user.profileUrl;
    socket.isAdmin = user.isAdmin;

    // 全ピクセルを新規接続クライアントに送信
    const pixels = db.prepare('SELECT x, y, color FROM pixels').all();
    socket.emit('initialCanvas', pixels);

    // ユーザーリストを更新して全クライアントにブロードキャスト
    updateAndBroadcastUserList();

    // クールダウン秒数をここで定義 (一般ユーザー用)
    const PAINT_COOLDOWN_SECONDS = 30; // 30秒に設定

    socket.on('requestPaint', (pixel) => {
        const now = Date.now();
        // 管理者はクールダウン0秒、一般ユーザーはPAINT_COOLDOWN_SECONDS * 1000ミリ秒
        const cooldownDuration = socket.isAdmin ? 0 : PAINT_COOLDOWN_SECONDS * 1000; 

        const stmt = db.prepare('SELECT lastPaintTime FROM user_cooldowns WHERE userId = ?');
        const cooldown = stmt.get(socket.userId);

        if (cooldown && (now - cooldown.lastPaintTime < cooldownDuration)) {
            socket.emit('paintError', `Please wait ${((cooldownDuration - (now - cooldown.lastPaintTime)) / 1000).toFixed(1)} seconds before painting again.`);
            return;
        }

        // ピクセル座標のバリデーション
        const CANVAS_PIXEL_WIDTH = 500; 
        const CANVAS_PIXEL_HEIGHT = 500;
        const BIT_SIZE = 5;

        if (pixel.x < 0 || pixel.x >= (CANVAS_PIXEL_WIDTH / BIT_SIZE) ||
            pixel.y < 0 || pixel.y >= (CANVAS_PIXEL_HEIGHT / BIT_SIZE)) {
            socket.emit('paintError', 'Invalid pixel coordinates.');
            return;
        }

        // 色のバリデーション (簡易的なチェック)
        if (!/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(pixel.color)) {
            socket.emit('paintError', 'Invalid color format.');
            return;
        }

        // データベースにピクセルを保存または更新
        db.prepare('INSERT OR REPLACE INTO pixels (x, y, color, timestamp, userId) VALUES (?, ?, ?, ?, ?)')
          .run(pixel.x, pixel.y, pixel.color, now, socket.userId);

        // ユーザーのpixelsPaintedをインクリメント
        db.prepare('UPDATE users SET pixelsPainted = pixelsPainted + 1 WHERE id = ?').run(socket.userId);

        // クールダウン時間を更新
        db.prepare('INSERT OR REPLACE INTO user_cooldowns (userId, lastPaintTime) VALUES (?, ?)').run(socket.userId, now);

        // 全クライアントに新しいピクセルをブロードキャスト
        io.emit('paintPixel', pixel);
        socket.emit('paintSuccess', 'Pixel painted successfully!');
        console.log(`User ${socket.username} (${socket.userId}) painted pixel at (${pixel.x}, ${pixel.y}) with ${pixel.color}`);
        
        // ピクセル数更新後、ユーザーリストを再ブロードキャストしてランクを反映
        updateAndBroadcastUserList();
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
        updateAndBroadcastUserList();
    });
});

// ユーザーリストを更新して全クライアントにブロードキャストする関数
function updateAndBroadcastUserList() {
    const connectedUsers = new Map();

    // データベースから全てのユーザーのID、ユーザー名、認証タイプ、プロフィールURL、isAdmin、pixelsPaintedを取得
    const allUsers = db.prepare('SELECT id, username, authType, profileUrl, isAdmin, pixelsPainted FROM users').all();
    const userMap = new Map(allUsers.map(user => [user.id, user]));

    io.sockets.sockets.forEach(socket => {
        if (socket.userId && userMap.has(socket.userId)) {
            const user = userMap.get(socket.userId);
            connectedUsers.set(socket.userId, {
                id: user.id,
                name: user.username,
                type: user.authType,
                profileUrl: user.profileUrl,
                isAdmin: user.isAdmin,
                pixelsPainted: user.pixelsPainted // 描画ピクセル数を含める
            });
        }
    });

    const userList = Array.from(connectedUsers.values());
    io.emit('updateUserList', userList);
}

// Socket.IOのエンジンミドルウェアにセッションとPassportを適用
io.engine.use(sessionMiddleware);
io.engine.use(passport.initialize());
io.engine.use(passport.session());


// 未定義のルートは index.html にフォールバック
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
