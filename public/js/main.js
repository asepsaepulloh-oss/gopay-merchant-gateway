document.addEventListener('DOMContentLoaded', () => {
    function parseJwt(token) {
        try {
            const base64Url = token.split('.')[1];
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function(c) {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));
            return JSON.parse(jsonPayload);
        } catch (e) {
            return null;
        }
    }

    const token = localStorage.getItem('jwtToken');
    const urlParams = new URLSearchParams(window.location.search);
    const resetToken = urlParams.get('token');

    // Jika token reset password ada di URL, tampilkan form Reset Password secara langsung
    if (resetToken) {
        switchAuthMode('reset');
    } else if (token) {
        const payload = parseJwt(token);
        if (payload && payload.whatsappNumber) {
            // Jika sudah login dengan token valid, alihkan langsung ke Dashboard Merchant
            window.location.href = '/gateway';
            return;
        } else {
            // Bersihkan token lama/tidak kompatibel
            localStorage.clear();
        }
    }

    let activeWaNumber = '';

    // ==========================================
    // NOTIFIKASI TOAST SYSTEM
    // ==========================================
    function showToast(title, message, isSuccess = true) {
        const toastEl = document.getElementById('appToast');
        if (!toastEl) return;
        document.getElementById('toastTitle').textContent = title;
        document.getElementById('toastMessage').textContent = message;
        document.getElementById('toastIcon').className = isSuccess ? 'fas fa-check-circle text-success me-2' : 'fas fa-exclamation-circle text-danger me-2';
        const toast = new bootstrap.Toast(toastEl, { delay: 4000 });
        toast.show();
    }

    // ==========================================
    // NAVIGASI SWITCH AUTH FORM
    // ==========================================
    window.switchAuthMode = function(mode) {
        // Sembunyikan semua form
        document.getElementById('form-login').classList.add('hidden');
        document.getElementById('form-otp').classList.add('hidden');
        document.getElementById('form-register').classList.add('hidden');
        document.getElementById('form-forgot').classList.add('hidden');
        document.getElementById('form-reset').classList.add('hidden');
        document.getElementById('auth-tab-headers')?.classList.remove('hidden');

        // Navigasi aktif di tab headers
        document.getElementById('tab-login')?.classList.remove('active');
        document.getElementById('tab-register')?.classList.remove('active');

        if (mode === 'login') {
            document.getElementById('form-login').classList.remove('hidden');
            document.getElementById('tab-login')?.classList.add('active');
        } else if (mode === 'register') {
            document.getElementById('form-register').classList.remove('hidden');
            document.getElementById('tab-register')?.classList.add('active');
        } else if (mode === 'otp') {
            document.getElementById('form-otp').classList.remove('hidden');
            document.getElementById('auth-tab-headers')?.classList.add('hidden');
        } else if (mode === 'forgot') {
            document.getElementById('form-forgot').classList.remove('hidden');
            document.getElementById('auth-tab-headers')?.classList.add('hidden');
        } else if (mode === 'reset') {
            document.getElementById('form-reset').classList.remove('hidden');
            document.getElementById('auth-tab-headers')?.classList.add('hidden');
        }
    };

    // ==========================================
    // ACTION FORM HANDLERS
    // ==========================================

    // 1. REGISTER
    document.getElementById('form-register')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('reg-name').value;
        const whatsappNumber = document.getElementById('reg-wa').value;
        const email = document.getElementById('reg-email').value;
        const password = document.getElementById('reg-pass').value;

        const btn = document.getElementById('btnRegisterSubmit');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Mendaftar...';

        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, whatsappNumber, email, password })
            });

            const data = await res.json();
            if (data.success) {
                // Tampilkan kunci API rahasia yang digenerate sistem
                alert(`Pendaftaran Berhasil!\n\nKUNCI API ANDA:\nPublic Key: ${data.apiKeys.publicKey}\nSecret Key: ${data.apiKeys.secretKey}\n\nHarap catat dan simpan Secret Key ini baik-baik. Kunci ini hanya ditampilkan satu kali demi keamanan.`);
                showToast('Sukses', 'Registrasi merchant berhasil! Silakan login.');
                switchAuthMode('login');
            } else {
                showToast('Registrasi Gagal', data.message || 'Terjadi kesalahan.', false);
            }
        } catch (err) {
            showToast('Error', 'Gagal menghubungkan ke server.', false);
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-user-plus me-1"></i> Daftar Sekarang';
        }
    });

    // 2. LOGIN (MENGIRIM OTP)
    document.getElementById('form-login')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const whatsappNumber = document.getElementById('login-wa').value;
        const password = document.getElementById('login-pass').value;

        const btn = document.getElementById('btnLoginSubmit');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Memverifikasi...';

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ whatsappNumber, password })
            });

            const data = await res.json();
            if (data.success) {
                activeWaNumber = whatsappNumber;
                document.getElementById('display-otp-wa').textContent = whatsappNumber;
                
                showToast('OTP Terkirim', 'Kode OTP 6 digit telah dikirim ke nomor WhatsApp Anda.');
                switchAuthMode('otp');
            } else {
                showToast('Login Gagal', data.message || 'Password atau WhatsApp salah.', false);
            }
        } catch (err) {
            showToast('Error', 'Gagal menghubungi server.', false);
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-paper-plane me-1"></i> Kirim OTP';
        }
    });

    // 3. VERIFIKASI OTP & TERBITKAN TOKEN
    document.getElementById('form-otp')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = document.getElementById('otp-code').value;

        const btn = document.getElementById('btnOtpSubmit');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Verifikasi...';

        try {
            const res = await fetch('/api/auth/verify-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ whatsappNumber: activeWaNumber, code })
            });

            const data = await res.json();
            if (data.success) {
                // Simpan token JWT di localStorage
                localStorage.setItem('jwtToken', data.token);
                localStorage.setItem('merchantName', data.user.name);
                localStorage.setItem('whatsappNumber', data.user.whatsappNumber);
                
                showToast('Login Sukses', 'Selamat datang kembali!');
                setTimeout(() => {
                    window.location.href = '/gateway';
                }, 1000);
            } else {
                showToast('Verifikasi Gagal', data.message || 'Kode OTP salah.', false);
            }
        } catch (err) {
            showToast('Error', 'Gagal memverifikasi OTP.', false);
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-check-circle me-1"></i> Verifikasi & Masuk';
        }
    });

    // 4. LUPA PASSWORD (KIRIM RESET LINK WA)
    document.getElementById('form-forgot')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const whatsappNumber = document.getElementById('forgot-wa').value;

        const btn = document.getElementById('btnForgotSubmit');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Mengirim...';

        try {
            const res = await fetch('/api/auth/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ whatsappNumber })
            });

            const data = await res.json();
            if (data.success) {
                showToast('Sukses', data.message || 'Tautan reset password berhasil dikirim.');
                switchAuthMode('login');
            } else {
                showToast('Gagal', data.message || 'Gagal mengirim link.', false);
            }
        } catch (err) {
            showToast('Error', 'Gagal memproses lupa password.', false);
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-paper-plane me-1"></i> Kirim Tautan Reset';
        }
    });

    // 5. UPDATE PASSWORD DENGAN TOKEN RESET
    document.getElementById('form-reset')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newPassword = document.getElementById('reset-pass').value;

        const btn = document.getElementById('btnResetSubmit');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Memproses...';

        try {
            const res = await fetch('/api/auth/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: resetToken, newPassword })
            });

            const data = await res.json();
            if (data.success) {
                showToast('Sukses', 'Password Anda berhasil diupdate. Silakan login.');
                // Hapus token dari url address bar
                window.history.replaceState({}, document.title, "/");
                switchAuthMode('login');
            } else {
                showToast('Gagal', data.message || 'Token tidak valid.', false);
            }
        } catch (err) {
            showToast('Error', 'Gagal mereset password.', false);
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-check me-1"></i> Update Password';
        }
    });
});