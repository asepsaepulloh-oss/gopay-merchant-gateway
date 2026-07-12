require('dotenv').config();
const dns = require('dns');

// Paksa Node.js mendahulukan IPv4 untuk menghindari timeout koneksi pada IPv6
if (typeof dns.setDefaultResultOrder === 'function') {
    dns.setDefaultResultOrder('ipv4first');
}

const express = require('express');

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { Jimp } = require('jimp');
const jsQR = require('jsqr');
const QRCode = require('qrcode');

// Import Service Fonnte & Supabase
const { sendWhatsAppMessage } = require('./src/services/fonnteService');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    realtime: {
        transport: ws
    }
});

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'rahasia_super_aman_123';

// Folder-folder setup
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
}

const SETTINGS_FILE_PATH = path.join(dataDir, 'saas_settings.json');

function getSaaSSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE_PATH)) {
            const data = fs.readFileSync(SETTINGS_FILE_PATH, 'utf-8');
            return JSON.parse(data);
        }
    } catch (err) {
        console.error('Gagal membaca saas_settings.json:', err);
    }
    return { code_len: 3, expiry_minutes: 10 };
}

function saveSaaSSettings(settings) {
    try {
        fs.writeFileSync(SETTINGS_FILE_PATH, JSON.stringify(settings, null, 2), 'utf-8');
        return true;
    } catch (err) {
        console.error('Gagal menulis saas_settings.json:', err);
        return false;
    }
}

// --------------------------------------------------------------
// PURE JAVASCRIPT CORS & SECURITY MIDDLEWARES
// --------------------------------------------------------------
app.use(express.json());
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, x-secret-key');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routing URL Bersih (Clean URLs) untuk UI Halaman HTML
app.get('/gateway', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'gateway.html'));
});

app.get('/api-docs', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'api-docs.html'));
});

// --------------------------------------------------------------
// IN-MEMORY RATE LIMITER
// --------------------------------------------------------------
const rateLimitMap = new Map();
function rateLimiter(keyPrefix, limit, windowMs) {
    return (req, res, next) => {
        const ip = req.ip || req.connection.remoteAddress;
        const limitKey = `${keyPrefix}-${ip}`;
        const now = Date.now();
        const requestLog = rateLimitMap.get(limitKey) || [];
        
        const activeRequests = requestLog.filter(time => now - time < windowMs);
        if (activeRequests.length >= limit) {
            return res.status(429).json({
                success: false,
                message: 'Terlalu banyak permintaan (Rate limit exceeded). Silakan coba sesaat lagi.'
            });
        }
        
        activeRequests.push(now);
        rateLimitMap.set(limitKey, activeRequests);
        next();
    };
}

// Multer storage untuk QRIS Upload
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'qris-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/jpg'];
    if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Format file tidak didukung! Hanya gambar JPG, JPEG, dan PNG yang diizinkan.'));
    }
};

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 3 * 1024 * 1024 }, // 3MB limit
    fileFilter: fileFilter
});

// --------------------------------------------------------------
// MIDDLEWARE AUTENTIKASI (JWT & API KEY)
// --------------------------------------------------------------
const authenticateJWT = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) return res.status(401).json({ success: false, message: 'Akses ditolak. Token tidak ditemukan.' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ success: false, message: 'Sesi berakhir atau token tidak valid.' });
        req.user = user;
        next();
    });
};

const authenticateApiKey = async (req, res, next) => {
    const publicKey = req.headers['x-api-key'];
    const secretKey = req.headers['x-secret-key'];

    if (!publicKey || !secretKey) {
        return res.status(401).json({ success: false, message: 'Autentikasi API Key ditolak. Header x-api-key & x-secret-key wajib diisi.' });
    }

    try {
        const { data: keyRecord, error } = await supabase
            .from('api_keys')
            .select('*')
            .eq('public_key', publicKey)
            .eq('is_active', true)
            .single();

        if (error || !keyRecord) {
            return res.status(401).json({ success: false, message: 'Kunci Publik API tidak aktif atau tidak terdaftar.' });
        }

        const isSecretValid = await bcrypt.compare(secretKey, keyRecord.secret_key_hash);
        if (!isSecretValid) {
            return res.status(401).json({ success: false, message: 'Kunci Rahasia API tidak valid.' });
        }

        const { data: merchant, error: mError } = await supabase
            .from('merchants')
            .select('*')
            .eq('id', keyRecord.merchant_id)
            .single();

        if (mError || !merchant) {
            return res.status(401).json({ success: false, message: 'Merchant tidak terdaftar.' });
        }

        req.merchant = merchant;
        next();
    } catch (err) {
        res.status(500).json({ success: false, message: 'Kesalahan sistem autentikasi API: ' + err.message });
    }
};

// --------------------------------------------------------------
// QRIS DYNAMIC CONVERTER & CRC16 HELPER
// --------------------------------------------------------------
function extractPaymentAmount(text) {
    if (!text) return 0;
    // Mencocokkan nominal dengan format Rp, menghapus titik/koma, lalu mengambil nilai terkecil (agar tidak tertukar dengan saldo baru)
    const regex = /Rp\s?(\d{1,3}(?:\.\d{3})*|\d+)/gi;
    let match;
    const nominals = [];
    while ((match = regex.exec(text)) !== null) {
        const cleanStr = match[1].replace(/\./g, '');
        const val = parseInt(cleanStr, 10);
        if (!isNaN(val)) {
            nominals.push(val);
        }
    }
    if (nominals.length === 0) return 0;
    return nominals.length > 1 ? Math.min(...nominals) : nominals[0];
}

function convertCRC16(str) {
    let crc = 0xFFFF;
    const strlen = str.length;
    for (let c = 0; c < strlen; c++) {
        crc ^= str.charCodeAt(c) << 8;
        for (let i = 0; i < 8; i++) {
            if (crc & 0x8000) {
                crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
            } else {
                crc = (crc << 1) & 0xFFFF;
            }
        }
    }
    let hex = (crc & 0xFFFF).toString(16).toUpperCase();
    return hex.padStart(4, '0');
}

function qrisConverter(qty, qrisStr) {
    try {
        let qris = qrisStr.slice(0, -4);
        
        // Pastikan tag 01 (point of initiation) bernilai 12 (dynamic)
        qris = qris.replace("010211", "010212");
        
        // Cari index dari "5802ID"
        const index = qris.indexOf("5802ID");
        if (index === -1) {
            throw new Error("Format string QRIS Merchant Anda tidak memiliki kode negara 5802ID.");
        }
        
        const qtyStr = Math.round(Number(qty)).toString();
        const lenStr = qtyStr.length.toString().padStart(2, '0');
        const uang = "54" + lenStr + qtyStr; // Tag 54 (Amount)
        
        // Kita sisipkan tag 54 tepat sebelum "5802ID"
        let fix = qris.substring(0, index) + uang + qris.substring(index);
        fix += convertCRC16(fix);
        return fix;
    } catch (err) {
        throw new Error("Gagal mengonversi QRIS merchant ke dinamis: " + err.message);
    }
}

// Helper utility untuk mencatat audit log
async function createAuditLog(userId, action, details, req) {
    try {
        const ip = req ? (req.ip || req.connection.remoteAddress) : null;
        await supabase.from('audit_logs').insert({
            user_id: userId,
            action,
            ip_address: ip,
            details
        });
    } catch (e) {
        console.error('Gagal mencatat audit log:', e.message);
    }
}

// --------------------------------------------------------------
// SISTEM AUTENTIKASI & USER MANAGEMENT
// --------------------------------------------------------------

function normalizePhoneNumber(number) {
    if (!number) return '';
    let clean = number.replace(/[^0-9]/g, '');
    if (clean.startsWith('0')) {
        clean = '62' + clean.slice(1);
    } else if (clean.startsWith('8')) {
        clean = '62' + clean;
    }
    return clean;
}

// Self-healing database pattern: memastikan profile merchant lengkap saat login
async function ensureMerchantProfile(user) {
    let { data: merchant } = await supabase
        .from('merchants')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

    if (!merchant) {
        console.log(`[Self-Healing] Membuat merchant profile otomatis untuk user: ${user.whatsapp_number}`);
        // Buat merchant baru otomatis
        const { data: newMerchant, error: mErr } = await supabase
            .from('merchants')
            .insert({ user_id: user.id, name: 'Toko ' + user.whatsapp_number, email: '' })
            .select()
            .single();
            
        if (mErr || !newMerchant) throw mErr || new Error('Gagal membuat profile merchant otomatis.');
        merchant = newMerchant;
        
        // Buat API Keys default
        const pubKey = 'pk_' + crypto.randomBytes(16).toString('hex');
        const secKeyStr = 'sk_' + crypto.randomBytes(24).toString('hex');
        const secKeyHash = await bcrypt.hash(secKeyStr, 10);

        await supabase.from('api_keys').insert({
            merchant_id: merchant.id,
            public_key: pubKey,
            secret_key_hash: secKeyHash
        });

        // Buat Webhook Settings default
        await supabase.from('webhook_settings').insert({
            merchant_id: merchant.id,
            url: '',
            secret_key: crypto.randomBytes(16).toString('hex'),
            is_active: false
        });
    }
    return merchant;
}

// Registrasi Merchant Baru
app.post('/api/auth/register', async (req, res) => {
    const { whatsappNumber, password, name, email } = req.body;
    if (!whatsappNumber || !password || !name) {
        return res.status(400).json({ success: false, message: 'Nomor WhatsApp, Password, dan Nama Lengkap wajib diisi.' });
    }

    try {
        const cleanNumber = normalizePhoneNumber(whatsappNumber);
        
        // Cek jika nomor whatsapp sudah terdaftar
        const { data: existingUser } = await supabase
            .from('users')
            .select('*')
            .eq('whatsapp_number', cleanNumber)
            .single();

        if (existingUser) {
            return res.status(400).json({ success: false, message: 'Nomor WhatsApp sudah terdaftar.' });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        // 1. Insert user
        const { data: newUser, error: uErr } = await supabase
            .from('users')
            .insert({ whatsapp_number: cleanNumber, password_hash: passwordHash })
            .select()
            .single();

        if (uErr || !newUser) throw uErr || new Error('Gagal membuat user.');

        // 2. Insert merchant profile
        const { data: newMerchant, error: mErr } = await supabase
            .from('merchants')
            .insert({ user_id: newUser.id, name, email })
            .select()
            .single();

        if (mErr || !newMerchant) throw mErr || new Error('Gagal membuat merchant.');

        // 3. Generate API Keys default
        const pubKey = 'pk_' + crypto.randomBytes(16).toString('hex');
        const secKeyStr = 'sk_' + crypto.randomBytes(24).toString('hex');
        const secKeyHash = await bcrypt.hash(secKeyStr, 10);

        await supabase.from('api_keys').insert({
            merchant_id: newMerchant.id,
            public_key: pubKey,
            secret_key_hash: secKeyHash
        });

        // 4. Default webhook settings
        await supabase.from('webhook_settings').insert({
            merchant_id: newMerchant.id,
            url: '',
            secret_key: crypto.randomBytes(16).toString('hex'),
            is_active: false
        });

        await createAuditLog(newUser.id, 'REGISTER', 'User terdaftar dengan nama ' + name, req);

        res.json({
            success: true,
            message: 'Registrasi berhasil! Silakan login menggunakan nomor WhatsApp Anda.',
            apiKeys: {
                publicKey: pubKey,
                secretKey: secKeyStr // Dikembalikan sekali saja saat registrasi untuk dicatat
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Login Tahap 1: Verifikasi Password & Kirim OTP WA (Rate limited)
app.post('/api/auth/login', rateLimiter('login-otp', 2, 60 * 1000), async (req, res) => {
    const { whatsappNumber, password } = req.body;
    if (!whatsappNumber || !password) {
        return res.status(400).json({ success: false, message: 'WhatsApp dan Password wajib diisi.' });
    }

    try {
        const cleanNumber = normalizePhoneNumber(whatsappNumber);
        
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('whatsapp_number', cleanNumber)
            .single();

        if (error || !user) {
            return res.status(401).json({ success: false, message: 'Nomor WhatsApp atau password salah.' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password_hash);
        if (!isPasswordValid) {
            return res.status(401).json({ success: false, message: 'Nomor WhatsApp atau password salah.' });
        }

        // Generate OTP 6 digit
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 menit

        await supabase.from('otp_codes').insert({
            whatsapp_number: cleanNumber,
            code: otpCode,
            expired_at: expiresAt
        });

        // Kirim OTP melalui Fonnte
        const msgText = `[Web Gateway QRIS]\nKode OTP login Anda adalah: *${otpCode}*\nRahasiakan kode ini. Berlaku selama 5 menit.`;
        const waResult = await sendWhatsAppMessage(cleanNumber, msgText);

        if (!waResult.success) {
            console.error('[Login OTP Error] Gagal mengirim OTP via Fonnte:', waResult.error || waResult.raw);
            return res.status(500).json({ 
                success: false, 
                message: 'Gagal mengirimkan OTP ke nomor WhatsApp Anda. Pastikan perangkat Fonnte aktif.',
                detail: waResult.error || (waResult.raw ? waResult.raw.reason : 'Fonnte API error')
            });
        }

        res.json({
            success: true,
            message: 'Password terverifikasi. Kode OTP telah dikirim ke WhatsApp Anda.'
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Login Tahap 2: Verifikasi OTP & Terbitkan JWT
app.post('/api/auth/verify-otp', async (req, res) => {
    const { whatsappNumber, code } = req.body;
    if (!whatsappNumber || !code) {
        return res.status(400).json({ success: false, message: 'WhatsApp dan Kode OTP wajib diisi.' });
    }

    try {
        const cleanNumber = normalizePhoneNumber(whatsappNumber);
        
        // Cari OTP yang valid
        const { data: otpRecord, error } = await supabase
            .from('otp_codes')
            .select('*')
            .eq('whatsapp_number', cleanNumber)
            .eq('code', code.trim())
            .eq('is_used', false)
            .gte('expired_at', new Date().toISOString())
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (error || !otpRecord) {
            return res.status(400).json({ success: false, message: 'Kode OTP tidak valid, sudah digunakan, atau kedaluwarsa.' });
        }

        // Tandai OTP telah digunakan
        await supabase.from('otp_codes').update({ is_used: true }).eq('id', otpRecord.id);

        // Ambil info user
        const { data: user } = await supabase
            .from('users')
            .select('*')
            .eq('whatsapp_number', cleanNumber)
            .single();

        const merchant = await ensureMerchantProfile(user);

        const tokenPayload = {
            id: user.id,
            whatsappNumber: user.whatsapp_number,
            role: user.role,
            merchantId: merchant.id
        };
        
        const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '1d' });

        await createAuditLog(user.id, 'LOGIN', 'Berhasil login melalui verifikasi OTP WA', req);

        res.json({
            success: true,
            message: 'Login berhasil!',
            token: token,
            user: {
                whatsappNumber: user.whatsapp_number,
                role: user.role,
                name: merchant ? merchant.name : ''
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Lupa Password - Kirim Link Reset Password
app.post('/api/auth/forgot-password', rateLimiter('forgot-pass', 1, 3 * 60 * 1000), async (req, res) => {
    const { whatsappNumber } = req.body;
    if (!whatsappNumber) {
        return res.status(400).json({ success: false, message: 'WhatsApp wajib diisi.' });
    }

    try {
        const cleanNumber = normalizePhoneNumber(whatsappNumber);
        const { data: user } = await supabase
            .from('users')
            .select('*')
            .eq('whatsapp_number', cleanNumber)
            .single();

        if (!user) {
            // Berikan pesan sukses palsu demi alasan privasi/keamanan
            return res.json({ success: true, message: 'Jika nomor terdaftar, link reset password telah dikirim via WhatsApp.' });
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 menit

        await supabase.from('password_reset_tokens').insert({
            whatsapp_number: cleanNumber,
            token: resetToken,
            expired_at: expiresAt
        });

        // Kirim link reset via Fonnte
        const resetLink = `${req.protocol}://${req.get('host')}/reset-password.html?token=${resetToken}`;
        const msgText = `[Web Gateway QRIS]\nAnda meminta perubahan password. Silakan klik tautan di bawah ini untuk membuat password baru:\n\n${resetLink}\n\nLink ini hanya berlaku selama 15 menit.`;
        const waResult = await sendWhatsAppMessage(cleanNumber, msgText);

        if (!waResult.success) {
            console.error('[Forgot Password Error] Gagal mengirim link reset via Fonnte:', waResult.error || waResult.raw);
            return res.status(500).json({
                success: false,
                message: 'Gagal mengirimkan link reset password ke nomor WhatsApp Anda. Pastikan perangkat Fonnte aktif.',
                detail: waResult.error || (waResult.raw ? waResult.raw.reason : 'Fonnte API error')
            });
        }

        res.json({
            success: true,
            message: 'Link reset password telah dikirim ke WhatsApp Anda.'
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Reset Password - Submit Password Baru
app.post('/api/auth/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
        return res.status(400).json({ success: false, message: 'Token dan Password Baru wajib diisi.' });
    }

    try {
        const { data: resetRecord, error } = await supabase
            .from('password_reset_tokens')
            .select('*')
            .eq('token', token)
            .eq('is_used', false)
            .gte('expired_at', new Date().toISOString())
            .single();

        if (error || !resetRecord) {
            return res.status(400).json({ success: false, message: 'Token reset tidak valid, sudah digunakan, atau expired.' });
        }

        const passwordHash = await bcrypt.hash(newPassword, 10);

        // Update password
        await supabase
            .from('users')
            .update({ password_hash: passwordHash })
            .eq('whatsapp_number', resetRecord.whatsapp_number);

        // Tandai token digunakan
        await supabase
            .from('password_reset_tokens')
            .update({ is_used: true })
            .eq('id', resetRecord.id);

        res.json({ success: true, message: 'Password Anda berhasil diperbarui. Silakan login kembali.' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// --------------------------------------------------------------
// DASHBOARD MERCHANT SERVICES (JWT AUTH PROTECTED)
// --------------------------------------------------------------

// Profil: Get Profile
app.get('/api/merchant/profile', authenticateJWT, async (req, res) => {
    try {
        const { data: profile, error } = await supabase
            .from('merchants')
            .select('*, users(whatsapp_number)')
            .eq('user_id', req.user.id)
            .single();

        if (error || !profile) {
            return res.status(404).json({ success: false, message: 'Profil merchant tidak ditemukan.' });
        }

        res.json({ success: true, data: profile });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Profil: Update Profile
app.put('/api/merchant/profile', authenticateJWT, async (req, res) => {
    const { name, email } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Nama merchant wajib diisi.' });

    try {
        const { data: updated, error } = await supabase
            .from('merchants')
            .update({ name, email })
            .eq('user_id', req.user.id)
            .select()
            .single();

        if (error) throw error;
        res.json({ success: true, message: 'Profil berhasil diperbarui.', data: updated });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// QRIS Merchant: Get QRIS String
app.get('/api/merchant/qris', authenticateJWT, async (req, res) => {
    try {
        let merchantId = req.user.merchantId;
        if (!merchantId) {
            const { data: merchant } = await supabase
                .from('merchants')
                .select('id')
                .eq('user_id', req.user.id)
                .single();
            if (merchant) merchantId = merchant.id;
        }

        if (!merchantId) {
            return res.json({ success: true, qrisString: null });
        }

        const { data: qrisData, error } = await supabase
            .from('merchant_qris')
            .select('*')
            .eq('merchant_id', merchantId)
            .single();

        if (error || !qrisData) {
            return res.json({ success: true, qrisString: null });
        }
        res.json({ success: true, qrisString: qrisData.qris_string });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// QRIS Merchant: Upload & Decode Image (Returns the decoded string, does not save yet)
app.post('/api/merchant/qris/decode', authenticateJWT, upload.single('qris_image'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'File gambar QRIS merchant wajib diunggah.' });
    }

    const localFilePath = req.file.path;

    try {
        // Dekode gambar menggunakan Jimp & jsQR
        const image = await Jimp.read(localFilePath);
        const { data, width, height } = image.bitmap;
        const code = jsQR(new Uint8ClampedArray(data), width, height);

        if (!code || !code.data) {
            throw new Error('QR Code tidak terdeteksi pada gambar. Pastikan gambar jelas dan memiliki cahaya yang cukup.');
        }

        const qrisString = code.data.trim();
        if (!qrisString.startsWith('000201')) {
            throw new Error('QR Code terdeteksi tetapi bukan format QRIS standar (harus diawali 000201).');
        }

        // Hapus file lokal setelah selesai di-decode
        fs.unlinkSync(localFilePath);

        res.json({
            success: true,
            message: 'QRIS berhasil dideteksi dan didekode.',
            qrisString,
            filename: req.file.originalname
        });
    } catch (err) {
        if (fs.existsSync(localFilePath)) {
            fs.unlinkSync(localFilePath);
        }
        res.status(400).json({ success: false, message: err.message });
    }
});

// QRIS Merchant: Save QRIS String
app.post('/api/merchant/qris', authenticateJWT, async (req, res) => {
    const { qris_string, filename } = req.body;

    if (!qris_string || typeof qris_string !== 'string' || !qris_string.trim()) {
        return res.status(400).json({ success: false, message: 'Kode string QRIS merchant wajib diisi.' });
    }

    const cleanQrisString = qris_string.trim();

    // Validasi format QRIS dasar (wajib diawali dengan tag standar 000201)
    if (!cleanQrisString.startsWith('000201')) {
        return res.status(400).json({ success: false, message: 'Format kode QRIS tidak valid. Harus diawali dengan 000201.' });
    }

    try {
        // Resolusi Merchant ID
        let merchantId = req.user.merchantId;
        if (!merchantId) {
            const { data: merchant, error: mErr } = await supabase
                .from('merchants')
                .select('id')
                .eq('user_id', req.user.id)
                .maybeSingle();
            if (mErr) throw mErr;
            if (merchant) merchantId = merchant.id;
        }

        if (!merchantId) {
            return res.status(400).json({ success: false, message: 'ID Merchant tidak terdaftar di sistem. Harap hubungi admin.' });
        }

        // Simpan atau update ke database Supabase
        const { data: existingQris, error: findError } = await supabase
            .from('merchant_qris')
            .select('*')
            .eq('merchant_id', merchantId)
            .maybeSingle();

        if (findError) throw findError;

        if (existingQris) {
            const { error: updateError } = await supabase
                .from('merchant_qris')
                .update({ 
                    qris_string: cleanQrisString, 
                    original_filename: filename || 'Input Manual Teks' 
                })
                .eq('id', existingQris.id);
            if (updateError) throw updateError;
        } else {
            const { error: insertError } = await supabase
                .from('merchant_qris')
                .insert({ 
                    merchant_id: merchantId, 
                    qris_string: cleanQrisString, 
                    original_filename: filename || 'Input Manual Teks' 
                });
            if (insertError) throw insertError;
        }

        res.json({
            success: true,
            message: 'Teks QRIS Merchant berhasil disimpan dan diperbarui.',
            qrisString: cleanQrisString
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// SaaS Settings: Get Config
app.get('/api/saas-settings', authenticateJWT, async (req, res) => {
    try {
        const settings = getSaaSSettings();
        res.json({ success: true, data: settings });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// SaaS Settings: Save Config
app.post('/api/saas-settings', authenticateJWT, async (req, res) => {
    const { code_len, expiry_minutes } = req.body;
    if (!code_len || !expiry_minutes) {
        return res.status(400).json({ success: false, message: 'Parameter tidak lengkap.' });
    }

    try {
        const success = saveSaaSSettings({
            code_len: Number(code_len),
            expiry_minutes: Number(expiry_minutes)
        });
        if (success) {
            res.json({ success: true, message: 'Pengaturan SaaS berhasil disimpan.' });
        } else {
            res.status(500).json({ success: false, message: 'Gagal menyimpan pengaturan ke file.' });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Webhook Settings: Get Config
app.get('/api/merchant/webhook', authenticateJWT, async (req, res) => {
    try {
        const { data: hook, error } = await supabase
            .from('webhook_settings')
            .select('*')
            .eq('merchant_id', req.user.merchantId)
            .single();

        res.json({ success: true, data: hook || null });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Webhook Settings: Save Config
app.post('/api/merchant/webhook', authenticateJWT, async (req, res) => {
    const { url, isActive } = req.body;
    if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
        return res.status(400).json({ success: false, message: 'URL Webhook wajib menggunakan protokol http:// atau https://.' });
    }

    try {
        const { data: existing } = await supabase
            .from('webhook_settings')
            .select('*')
            .eq('merchant_id', req.user.merchantId)
            .single();

        let saved;
        if (existing) {
            const { data, error } = await supabase
                .from('webhook_settings')
                .update({ url: url || '', is_active: isActive === true })
                .eq('id', existing.id)
                .select()
                .single();
            if (error) throw error;
            saved = data;
        } else {
            const { data, error } = await supabase
                .from('webhook_settings')
                .insert({ 
                    merchant_id: req.user.merchantId, 
                    url: url || '', 
                    secret_key: crypto.randomBytes(16).toString('hex'), 
                    is_active: isActive === true 
                })
                .select()
                .single();
            if (error) throw error;
            saved = data;
        }

        res.json({ success: true, message: 'Pengaturan webhook berhasil disimpan.', data: saved });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Webhook Settings: Generate Secret HMAC Key Baru
app.post('/api/merchant/webhook/generate-secret', authenticateJWT, async (req, res) => {
    try {
        const newSecret = crypto.randomBytes(24).toString('hex');
        const { error } = await supabase
            .from('webhook_settings')
            .update({ secret_key: newSecret })
            .eq('merchant_id', req.user.merchantId);

        if (error) throw error;
        res.json({ success: true, message: 'HMAC Secret Key berhasil di-regenerasi.', secretKey: newSecret });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Webhook Logs: Get Logs History
app.get('/api/merchant/webhook/logs', authenticateJWT, async (req, res) => {
    try {
        // Query log webhook dari transaksi milik merchant ini
        const { data, error } = await supabase
            .from('webhook_logs')
            .select('*, transactions(reference_id, base_amount, total_amount)')
            .order('created_at', { ascending: false })
            .limit(100);

        if (error) throw error;

        // Filter log hanya milik merchant
        const filtered = data.filter(log => log.transactions && log.transactions.merchant_id === req.user.merchantId);
        res.json({ success: true, data: filtered });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Webhook Logs: Manual Retry Webhook Kirim Ulang
app.post('/api/merchant/webhook/logs/retry', authenticateJWT, async (req, res) => {
    const { logId } = req.body;
    if (!logId) return res.status(400).json({ success: false, message: 'logId wajib disertakan.' });

    try {
        const { data: log, error } = await supabase
            .from('webhook_logs')
            .select('*, transactions(*)')
            .eq('id', logId)
            .single();

        if (error || !log) return res.status(404).json({ success: false, message: 'Log webhook tidak ditemukan.' });

        const settings = await supabase
            .from('webhook_settings')
            .select('*')
            .eq('merchant_id', log.transactions.merchant_id)
            .single();

        if (!settings.data || !settings.data.url) {
            return res.status(400).json({ success: false, message: 'URL Webhook merchant tidak aktif/tidak diatur.' });
        }

        // Kirim webhook
        const payload = log.payload;
        const signature = crypto.createHmac('sha256', settings.data.secret_key).update(JSON.stringify(payload)).digest('hex');
        payload.signature = signature;

        let responseStatus;
        let responseBody;
        let attempts = log.attempts + 1;
        let status = 'FAILED';

        try {
            const hookRes = await fetch(settings.data.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            responseStatus = hookRes.status;
            responseBody = await hookRes.text();
            if (hookRes.ok) status = 'SUCCESS';
        } catch (postErr) {
            responseStatus = 500;
            responseBody = postErr.message;
        }

        // Update log
        await supabase.from('webhook_logs').update({
            attempts,
            response_status: responseStatus,
            response_body: responseBody.slice(0, 1000), // Batasi panjang text
            status
        }).eq('id', log.id);

        res.json({
            success: status === 'SUCCESS',
            message: status === 'SUCCESS' ? 'Webhook berhasil dikirim ulang.' : 'Gagal mengirim ulang webhook.',
            status,
            responseStatus,
            responseBody
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API Keys: Get Public Key
app.get('/api/merchant/api-keys', authenticateJWT, async (req, res) => {
    try {
        const { data: keys, error } = await supabase
            .from('api_keys')
            .select('public_key, created_at')
            .eq('merchant_id', req.user.merchantId)
            .eq('is_active', true)
            .single();

        res.json({ success: true, data: keys || null });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API Keys: Rotate / Regenerate Key Baru
app.post('/api/merchant/api-keys/rotate', authenticateJWT, async (req, res) => {
    try {
        // Nonaktifkan kunci lama
        await supabase
            .from('api_keys')
            .update({ is_active: false })
            .eq('merchant_id', req.user.merchantId);

        // Generate kunci baru
        const pubKey = 'pk_' + crypto.randomBytes(16).toString('hex');
        const secKeyStr = 'sk_' + crypto.randomBytes(24).toString('hex');
        const secKeyHash = await bcrypt.hash(secKeyStr, 10);

        await supabase.from('api_keys').insert({
            merchant_id: req.user.merchantId,
            public_key: pubKey,
            secret_key_hash: secKeyHash
        });

        await createAuditLog(req.user.id, 'ROTATE_KEYS', 'Merotasi API Key publik & rahasia', req);

        res.json({
            success: true,
            message: 'API Key berhasil di-rotate. Catat Kunci Rahasia baru Anda segera!',
            publicKey: pubKey,
            secretKey: secKeyStr
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Riwayat Transaksi: List Transaksi Merchant
app.get('/api/merchant/transactions', authenticateJWT, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('transactions')
            .select('*')
            .eq('merchant_id', req.user.merchantId)
            .order('created_at', { ascending: false })
            .limit(100);

        if (error) throw error;
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Dashboard Statistics (Admin & Merchant view)
app.get('/api/merchant/statistics', authenticateJWT, async (req, res) => {
    try {
        // Query semua transaksi merchant ini
        const { data: trxs, error } = await supabase
            .from('transactions')
            .select('*')
            .eq('merchant_id', req.user.merchantId);

        if (error) throw error;

        let totalVolume = 0;
        let totalCount = 0;
        let platformIncome = 0;
        let pendingCount = 0;
        let chartData = {};

        (trxs || []).forEach(t => {
            if (t.status === 'PAID') {
                totalVolume += Number(t.base_amount);
                totalCount += 1;
                platformIncome += Number(t.unique_code);

                // Group by date (YYYY-MM-DD)
                const dateStr = new Date(t.created_at).toISOString().split('T')[0];
                chartData[dateStr] = (chartData[dateStr] || 0) + Number(t.base_amount);
            } else if (t.status === 'PENDING') {
                pendingCount += 1;
            }
        });

        // Data khusus Admin jika user role === 'admin'
        let adminStats = null;
        if (req.user.role === 'admin') {
            const { data: allTrxs } = await supabase.from('transactions').select('*');
            const { count: totalMerchants } = await supabase.from('merchants').select('*', { count: 'exact', head: true });
            
            let adminTotalVol = 0;
            let adminPlatformInc = 0;
            let adminPaidCount = 0;

            (allTrxs || []).forEach(t => {
                if (t.status === 'PAID') {
                    adminTotalVol += Number(t.base_amount);
                    adminPlatformInc += Number(t.unique_code);
                    adminPaidCount += 1;
                }
            });

            adminStats = {
                totalMerchants: totalMerchants || 0,
                totalVolume: adminTotalVol,
                totalPlatformIncome: adminPlatformInc,
                totalPaidTransactions: adminPaidCount
            };
        }

        res.json({
            success: true,
            data: {
                totalVolume,
                totalCount,
                platformIncome,
                pendingCount,
                chartData,
                adminStats
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Profil: Manual QRIS Generator (Merchant Session Auth)
app.post('/api/merchant/payment/generate', authenticateJWT, async (req, res) => {
    const { amount, description } = req.body;
    if (!amount || isNaN(amount) || Number(amount) <= 0) {
        return res.status(400).json({ success: false, message: 'Nominal tagihan wajib diisi dengan angka valid.' });
    }

    try {
        // 1. Ambil QRIS Statis Merchant
        const { data: qrisData, error: qError } = await supabase
            .from('merchant_qris')
            .select('*')
            .eq('merchant_id', req.user.merchantId)
            .single();

        if (qError || !qrisData || !qrisData.qris_string) {
            return res.status(400).json({ success: false, message: 'QRIS Merchant belum dikonfigurasi. Harap unggah QRIS di menu QRIS Merchant terlebih dahulu.' });
        }

        const baseAmountNum = Number(amount);
        const settings = getSaaSSettings();
        let codeLen = Number(settings.code_len) || 3;
        const requestedCodeLen = req.body.codeLen || req.body.code_len;
        if (requestedCodeLen && [2, 3, 4].includes(Number(requestedCodeLen))) {
            codeLen = Number(requestedCodeLen);
        }
        const limitMinutes = Number(settings.expiry_minutes) || 10;
        const timeThreshold = new Date(Date.now() - limitMinutes * 60 * 1000).toISOString();

        // 1.5. Batalkan otomatis transaksi PENDING yang telah kedaluwarsa untuk membebaskan kode unik
        await supabase
            .from('transactions')
            .update({ status: 'CANCELLED' })
            .eq('merchant_id', req.user.merchantId)
            .eq('status', 'PENDING')
            .lt('created_at', timeThreshold);

        // 2. Cegah tabrakan kode unik pada transaksi PENDING dengan nominal dasar yang sama
        const { data: activeTrxs } = await supabase
            .from('transactions')
            .select('unique_code')
            .eq('merchant_id', req.user.merchantId)
            .eq('status', 'PENDING')
            .eq('base_amount', baseAmountNum)
            .gte('created_at', timeThreshold);

        const activeCodes = (activeTrxs || []).map(t => Number(t.unique_code));

        const minCode = Math.pow(10, codeLen - 1);
        const maxCode = Math.pow(10, codeLen) - 1;
        let uniqueCodeSelected = null;

        for (let attempt = 0; attempt < 1000; attempt++) {
            const code = Math.floor(Math.random() * (maxCode - minCode + 1)) + minCode;
            if (!activeCodes.includes(code)) {
                uniqueCodeSelected = code;
                break;
            }
        }

        if (uniqueCodeSelected === null) {
            return res.status(409).json({ success: false, message: 'Tidak dapat mengalokasikan kode unik transaksi. Cobalah beberapa saat lagi.' });
        }

        const totalAmount = baseAmountNum + uniqueCodeSelected;

        // 3. Konversi QRIS statis merchant menjadi dinamis
        let dynamicQrisStr;
        try {
            dynamicQrisStr = qrisConverter(totalAmount, qrisData.qris_string);
        } catch (convErr) {
            return res.status(400).json({ success: false, message: 'Gagal mengonversi QRIS merchant: ' + convErr.message });
        }

        // 4. Generate QR code gambar sebagai Base64
        const dynamicQrisImage = await QRCode.toDataURL(dynamicQrisStr);

        // 5. Catat transaksi ke database Supabase
        const referenceId = 'TXMAN-' + Date.now();
        const { data: newTrx, error: tErr } = await supabase
            .from('transactions')
            .insert({
                merchant_id: req.user.merchantId,
                reference_id: referenceId,
                base_amount: baseAmountNum,
                unique_code: uniqueCodeSelected,
                total_amount: totalAmount,
                merchant_received_amount: baseAmountNum,
                platform_income: uniqueCodeSelected,
                status: 'PENDING',
                created_at: new Date().toISOString()
            })
            .select()
            .single();

        if (tErr) throw tErr;

        res.json({
            success: true,
            trxId: newTrx.id,
            referenceId: referenceId,
            amountBase: baseAmountNum,
            uniqueCode: uniqueCodeSelected,
            totalAmount: totalAmount,
            qrisString: dynamicQrisStr,
            qrisImage: dynamicQrisImage
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// --------------------------------------------------------------
// ENDPOINT INTEGRASI PIHAK KETIGA (AUTHENTICATED VIA API KEY)
// --------------------------------------------------------------

// API Pihak Ketiga: Membuat QRIS Dinamis Instan (Public / Secret Key Auth)
app.post('/api/payment/generate-qris', authenticateApiKey, async (req, res) => {
    const { amount, referenceId } = req.body;
    if (!amount || isNaN(amount) || Number(amount) <= 0) {
        return res.status(400).json({ success: false, message: 'Parameter amount wajib diisi dengan nominal yang valid.' });
    }
    if (!referenceId) {
        return res.status(400).json({ success: false, message: 'Parameter referenceId dari sistem Anda wajib disertakan.' });
    }

    try {
        // 1. Ambil QRIS Statis Merchant
        const { data: qrisData, error: qError } = await supabase
            .from('merchant_qris')
            .select('*')
            .eq('merchant_id', req.merchant.id)
            .single();

        if (qError || !qrisData || !qrisData.qris_string) {
            return res.status(400).json({ success: false, message: 'QRIS Merchant belum dikonfigurasi. Harap unggah QRIS di profil merchant Anda terlebih dahulu.' });
        }

        const baseAmountNum = Number(amount);
        const settings = getSaaSSettings();
        let codeLen = Number(settings.code_len) || 3;
        const requestedCodeLen = req.body.codeLen || req.body.code_len;
        if (requestedCodeLen && [2, 3, 4].includes(Number(requestedCodeLen))) {
            codeLen = Number(requestedCodeLen);
        }
        const limitMinutes = Number(settings.expiry_minutes) || 10;
        const timeThreshold = new Date(Date.now() - limitMinutes * 60 * 1000).toISOString();

        // 1.5. Batalkan otomatis transaksi PENDING yang telah kedaluwarsa untuk membebaskan kode unik
        await supabase
            .from('transactions')
            .update({ status: 'CANCELLED' })
            .eq('merchant_id', req.merchant.id)
            .eq('status', 'PENDING')
            .lt('created_at', timeThreshold);

        // 2. Cegah tabrakan kode unik pada transaksi PENDING dengan nominal dasar yang sama
        const { data: activeTrxs } = await supabase
            .from('transactions')
            .select('unique_code')
            .eq('merchant_id', req.merchant.id)
            .eq('status', 'PENDING')
            .eq('base_amount', baseAmountNum)
            .gte('created_at', timeThreshold);

        const activeCodes = (activeTrxs || []).map(t => Number(t.unique_code));

        const minCode = Math.pow(10, codeLen - 1);
        const maxCode = Math.pow(10, codeLen) - 1;
        let uniqueCodeSelected = null;

        for (let attempt = 0; attempt < 1000; attempt++) {
            const code = Math.floor(Math.random() * (maxCode - minCode + 1)) + minCode;
            if (!activeCodes.includes(code)) {
                uniqueCodeSelected = code;
                break;
            }
        }

        if (uniqueCodeSelected === null) {
            return res.status(409).json({ success: false, message: 'Tidak dapat mengalokasikan kode unik transaksi. Cobalah beberapa saat lagi.' });
        }

        const totalAmount = baseAmountNum + uniqueCodeSelected;

        // 3. Konversi ke QRIS Dinamis kustom
        const dynamicQrisStr = qrisConverter(totalAmount, qrisData.qris_string);
        const dynamicQrisImage = await QRCode.toDataURL(dynamicQrisStr);

        // 4. Catat transaksi di Supabase
        const { data: newTrx, error: tErr } = await supabase
            .from('transactions')
            .insert({
                merchant_id: req.merchant.id,
                reference_id: referenceId,
                base_amount: baseAmountNum,
                unique_code: uniqueCodeSelected,
                total_amount: totalAmount,
                merchant_received_amount: totalAmount, // Settlement masuk penuh ke Merchant
                platform_income: uniqueCodeSelected,   // Pendapatan dari selisih kode unik
                payment_method: 'QRIS',
                status: 'PENDING'
            })
            .select()
            .single();

        if (tErr) throw tErr;

        res.json({
            success: true,
            trxId: newTrx.id,
            referenceId: referenceId,
            amountBase: baseAmountNum,
            uniqueCode: uniqueCodeSelected,
            totalAmount: totalAmount,
            qrisString: dynamicQrisStr,
            qrisImage: dynamicQrisImage
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API Pihak Ketiga & Dashboard: Memeriksa Status Pembayaran
app.get('/api/payment/check', async (req, res) => {
    const { trxId, amount } = req.query;
    if (!trxId && (!amount || isNaN(amount))) {
        return res.status(400).json({ success: false, message: 'Parameter query trxId atau amount wajib diisi.' });
    }

    try {
        let matchedTrx = null;

        if (trxId) {
            const { data } = await supabase
                .from('transactions')
                .select('*')
                .eq('id', trxId)
                .single();
            matchedTrx = data;
        } else {
            // Jika hanya check via amount (fallback), cari transaksi pending/paid terbaru dalam 15 menit
            const targetAmount = parseInt(amount, 10);
            const timeThreshold = new Date(Date.now() - 15 * 60 * 1000).toISOString();
            const { data } = await supabase
                .from('transactions')
                .select('*')
                .eq('total_amount', targetAmount)
                .gte('created_at', timeThreshold)
                .order('created_at', { ascending: false })
                .limit(1)
                .single();
            matchedTrx = data;
        }

        if (!matchedTrx) {
            return res.status(404).json({ success: false, message: 'Transaksi tidak ditemukan.' });
        }

        res.json({
            success: true,
            status: matchedTrx.status, // PENDING, PAID, CANCELLED
            trxId: matchedTrx.id,
            referenceId: matchedTrx.reference_id,
            amountBase: matchedTrx.base_amount,
            uniqueCode: matchedTrx.unique_code,
            totalAmount: matchedTrx.total_amount,
            paidAt: matchedTrx.paid_at
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API Pihak Ketiga & Dashboard: Batalkan Transaksi
app.post('/api/payment/cancel', async (req, res) => {
    const { trxId } = req.body;
    if (!trxId) return res.status(400).json({ success: false, message: 'trxId wajib disertakan dalam request body.' });

    try {
        const { data: trx, error } = await supabase
            .from('transactions')
            .select('*')
            .eq('id', trxId)
            .single();

        if (error || !trx) {
            return res.status(404).json({ success: false, message: 'Transaksi tidak ditemukan.' });
        }

        if (trx.status !== 'PENDING') {
            return res.status(400).json({ success: false, message: 'Hanya transaksi PENDING yang dapat dibatalkan.' });
        }

        const { data: updated } = await supabase
            .from('transactions')
            .update({ status: 'CANCELLED' })
            .eq('id', trxId)
            .select()
            .single();

        res.json({ success: true, message: 'Transaksi berhasil dibatalkan.', status: 'CANCELLED' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API Pihak Ketiga: Mendapatkan Daftar Transaksi
app.get('/api/payment/transactions', authenticateApiKey, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('transactions')
            .select('*')
            .eq('merchant_id', req.merchant.id)
            .order('created_at', { ascending: false })
            .limit(100);

        if (error) throw error;
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API Pihak Ketiga: Mendapatkan Detail Transaksi Tunggal
app.get('/api/payment/transactions/:id', authenticateApiKey, async (req, res) => {
    const { id } = req.params;
    try {
        const { data, error } = await supabase
            .from('transactions')
            .select('*')
            .eq('id', id)
            .eq('merchant_id', req.merchant.id)
            .single();

        if (error || !data) return res.status(404).json({ success: false, message: 'Transaksi tidak ditemukan.' });
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// --------------------------------------------------------------
// PUBLIC WEBHOOK FORWARDER (MENERIMA PEMBERITAHUAN DARI APLIKASI)
// --------------------------------------------------------------
app.all(['/api/webhook/payment', '/api/webhook/payment/:merchantId'], async (req, res) => {
    const { merchantId } = req.params;
    
    // Mendukung baik GET (query parameters) maupun POST (body) dari berbagai aplikasi forwarder
    const name = (req.query.name || req.body.name || req.body.title || '').trim();
    const pkg = (req.query.pkg || req.body.pkg || '').trim();
    const text = (req.query.text || req.body.text || req.query.message || req.body.message || '').trim();
    const sign = (req.query.sign || req.body.sign || '').trim();

    if (!text) {
        return res.status(400).json({ success: false, message: 'Isi payload webhook notifikasi tidak valid.' });
    }

    // Verifikasi signature jika dikirimkan oleh forwarder
    if (sign && sign !== "h3ruc0d3") {
        return res.status(401).json({ success: false, message: 'Gagal Signature' });
    }

    try {
        const amountReceived = extractPaymentAmount(text);
        if (amountReceived <= 0) {
            return res.json({ success: true, message: 'Notifikasi diabaikan karena tidak mengandung nominal.' });
        }

        const settings = getSaaSSettings();
        const expiryMinutes = Number(settings.expiry_minutes) || 10;
        // Gunakan minimal 15 menit atau waktu expired yang diatur
        const limitMinutes = Math.max(15, expiryMinutes);
        const timeThreshold = new Date(Date.now() - limitMinutes * 60 * 1000).toISOString();

        let query = supabase
            .from('transactions')
            .select('*')
            .eq('total_amount', amountReceived)
            .eq('status', 'PENDING')
            .gte('created_at', timeThreshold);

        // Filter berdasarkan merchantId jika dispesifikasikan (multitenant isolation)
        let mId = merchantId;
        if (mId) {
            query = query.eq('merchant_id', mId);
        }

        const { data: matchedTrx, error: tErr } = await query
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        let targetTrx = matchedTrx;
        const paidAt = new Date().toISOString();

        if (tErr || !matchedTrx) {
            console.log(`[Webhook] Notifikasi tidak cocok dengan transaksi aktif. Membuat transaksi baru secara realtime untuk Rp ${amountReceived.toLocaleString('id-ID')}.`);
            
            // Resolve merchant ID fallback jika tidak dispesifikasikan
            if (!mId) {
                const { data: firstMerchant } = await supabase
                    .from('merchants')
                    .select('id')
                    .limit(1)
                    .maybeSingle();
                if (firstMerchant) mId = firstMerchant.id;
            }

            if (!mId) {
                return res.status(400).json({ success: false, message: 'ID Merchant tidak dapat ditentukan untuk transaksi baru.' });
            }

            // Buat transaksi baru dengan status langsung PAID (karena uang sudah diterima)
            const referenceId = 'TXUNEXPECTED-' + Date.now();
            const { data: newTrx, error: insertErr } = await supabase
                .from('transactions')
                .insert({
                    merchant_id: mId,
                    reference_id: referenceId,
                    base_amount: amountReceived,
                    unique_code: 0,
                    total_amount: amountReceived,
                    merchant_received_amount: amountReceived,
                    platform_income: 0,
                    status: 'PAID',
                    paid_at: paidAt,
                    created_at: paidAt,
                    payload_raw: { query: req.query, body: req.body }
                })
                .select()
                .single();

            if (insertErr) {
                console.error('Gagal memasukkan transaksi tidak aktif:', insertErr.message);
                return res.status(500).json({ success: false, error: insertErr.message });
            }

            targetTrx = newTrx;
            console.log(`[Webhook success] Transaksi baru dibuat! Ref: ${newTrx.reference_id}, Total: Rp ${amountReceived.toLocaleString('id-ID')}`);
        } else {
            // Update status transaksi aktif yang cocok menjadi PAID
            const { error: updateErr } = await supabase
                .from('transactions')
                .update({ 
                    status: 'PAID', 
                    paid_at: paidAt, 
                    payload_raw: { query: req.query, body: req.body } 
                })
                .eq('id', matchedTrx.id);

            if (updateErr) throw updateErr;
            console.log(`[Webhook success] Transaksi matched! Ref: ${matchedTrx.reference_id}, Total: Rp ${amountReceived.toLocaleString('id-ID')}`);
        }

        // 2. Dispatch Callback Webhook ke Server Merchant (jika terkonfigurasi)
        const { data: wSettings } = await supabase
            .from('webhook_settings')
            .select('*')
            .eq('merchant_id', targetTrx.merchant_id)
            .single();

        if (wSettings && wSettings.is_active && wSettings.url) {
            const webhookPayload = {
                transaction_id: targetTrx.id,
                merchant_id: targetTrx.merchant_id,
                amount: Number(targetTrx.base_amount),
                status: 'PAID',
                payment_method: 'QRIS',
                reference: targetTrx.reference_id,
                paid_at: paidAt
            };

            // Hitung signature HMAC SHA256
            const hmac = crypto.createHmac('sha256', wSettings.secret_key);
            hmac.update(JSON.stringify(webhookPayload));
            const signature = hmac.digest('hex');
            webhookPayload.signature = signature;

            // Lakukan pemanggilan (dispatch) secara asinkron (background)
            fetch(wSettings.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(webhookPayload)
            })
            .then(async (hookRes) => {
                const responseStatus = hookRes.status;
                const responseBody = await hookRes.text();
                
                await supabase.from('webhook_logs').insert({
                    transaction_id: targetTrx.id,
                    payload: webhookPayload,
                    response_status: responseStatus,
                    response_body: responseBody.slice(0, 1000),
                    attempts: 1,
                    status: hookRes.ok ? 'SUCCESS' : 'FAILED'
                });
            })
            .catch(async (postErr) => {
                await supabase.from('webhook_logs').insert({
                    transaction_id: targetTrx.id,
                    payload: webhookPayload,
                    response_status: 500,
                    response_body: postErr.message,
                    attempts: 1,
                    status: 'FAILED'
                });
            });
        }

        res.json({ success: true, message: 'Webhook diproses dan dicocokkan.' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Server listener
const server = app.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(`🚀 Gateway Pembayaran SaaS Webhook Aktif!`);
    console.log(`🌐 Akses panel di: http://localhost:${PORT}`);
    console.log(`===============================================`);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`===============================================`);
        console.error(`❌ Gagal memulai server: Port ${PORT} sudah digunakan!`);
        console.error(`💡 Tips: Silakan matikan proses node lain yang sedang berjalan`);
        console.error(`   atau ubah PORT di file .env Anda.`);
        console.error(`===============================================`);
    } else {
        console.error('❌ Terjadi kesalahan pada server:', err.message);
    }
    process.exit(1);
});

