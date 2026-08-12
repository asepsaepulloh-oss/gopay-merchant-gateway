document.addEventListener('DOMContentLoaded', () => {
    // --------------------------------------------------------------
    // CEK SESI LOGIN AKTIF
    // --------------------------------------------------------------
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
    if (!token || !parseJwt(token)?.whatsappNumber) {
        localStorage.clear();
        window.location.href = '/';
        return;
    }

    let isAuthErrorHandled = false;
    let hasQrisConfigured = false;

    // Wrapper API Fetch untuk JWT
    async function apiFetch(url, options = {}) {
        const jwt = localStorage.getItem('jwtToken');
        if (!options.headers) options.headers = {};
        if (jwt) options.headers['Authorization'] = `Bearer ${jwt}`;
        
        const res = await fetch(url, options);
        if (res.status === 401 || res.status === 403) {
            if (!isAuthErrorHandled) {
                isAuthErrorHandled = true;
                localStorage.removeItem('jwtToken');
                alert('Sesi login Anda telah berakhir. Silakan login kembali.');
                window.location.href = '/';
            }
            throw new Error('Sesi tidak valid.');
        }
        return res;
    }

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
    // COLLAPSE SIDEBAR TOGGLE
    // ==========================================
    const sidebar = document.getElementById('sidebar');
    const btnToggleSidebar = document.getElementById('btnToggleSidebar');

    btnToggleSidebar?.addEventListener('click', () => {
        sidebar.classList.toggle('active');
    });

    // Close sidebar on mobile when click outside
    document.addEventListener('click', (e) => {
        if (window.innerWidth < 992) {
            if (!sidebar.contains(e.target) && !btnToggleSidebar.contains(e.target)) {
                sidebar.classList.remove('active');
            }
        }
    });

    // ==========================================
    // SIDEBAR TABS SWITCHING
    // ==========================================
    const menuLinks = document.querySelectorAll('.sidebar .nav-link');
    const sections = document.querySelectorAll('.dashboard-section');

    menuLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            const target = link.getAttribute('data-target');
            if (!target) return; // Skip logout & api-docs links
            
            e.preventDefault();

            // Sembunyikan semua section
            sections.forEach(sec => sec.classList.add('hidden'));
            menuLinks.forEach(lnk => lnk.classList.remove('active'));

            // Aktifkan section & menu yang dipilih
            document.getElementById(target).classList.remove('hidden');
            link.classList.add('active');

            // Close sidebar on mobile
            if (window.innerWidth < 992) {
                sidebar.classList.remove('active');
            }

            // Update title topbar
            document.getElementById('dashboard-merchant-title').textContent = link.textContent.trim();

            // Pemicu Fetch data sesuai tab
            if (target === 'section-dashboard') fetchStatistics();
            else if (target === 'section-profile') fetchProfile();
            else if (target === 'section-qris') fetchQrisString();
            else if (target === 'section-webhook') {
                fetchWebhookConfig();
                fetchWebhookLogs();
            }
            else if (target === 'section-apikeys') fetchApiKeys();
            else if (target === 'section-transactions') fetchTransactions();
            else if (target === 'section-settings') fetchSaaSSettings();
        });
    });

    // Logout
    document.getElementById('btnLogout')?.addEventListener('click', (e) => {
        e.preventDefault();
        if (confirm('Apakah Anda yakin ingin keluar dari sistem?')) {
            localStorage.clear();
            window.location.href = '/';
        }
    });

    // ==========================================
    // PORTAL DATA LOADING SERVICES
    // ==========================================

    // Inisialisasi merchant info di topbar
    const localMerchantName = localStorage.getItem('merchantName') || 'Merchant';
    document.getElementById('display-merchant-name').textContent = localMerchantName;

    // 1. Tab Dashboard: Statistik data
    async function fetchStatistics() {
        try {
            const res = await apiFetch('/api/merchant/statistics');
            const data = await res.json();
            
            if (data.success) {
                const stats = data.data;
                document.getElementById('stat-total-volume').textContent = 'Rp ' + Number(stats.totalVolume).toLocaleString('id-ID');
                document.getElementById('stat-platform-income').textContent = 'Rp ' + Number(stats.platformIncome).toLocaleString('id-ID');
                document.getElementById('stat-pending-count').textContent = stats.pendingCount;

                // Tampilkan statistik global admin jika tersedia
                if (stats.adminStats) {
                    document.getElementById('admin-statistics-card').classList.remove('hidden');
                    document.getElementById('admin-total-merchants').textContent = stats.adminStats.totalMerchants;
                    document.getElementById('admin-total-volume').textContent = 'Rp ' + Number(stats.adminStats.totalVolume).toLocaleString('id-ID');
                    document.getElementById('admin-platform-income').textContent = 'Rp ' + Number(stats.adminStats.totalPlatformIncome).toLocaleString('id-ID');
                    document.getElementById('admin-paid-count').textContent = stats.adminStats.totalPaidTransactions;
                } else {
                    document.getElementById('admin-statistics-card').classList.add('hidden');
                }
            }
        } catch (e) {
            console.error('Gagal mengambil statistik dashboard:', e);
        }
    }

    // 2. Tab Profil: Get & Update
    async function fetchProfile() {
        try {
            const res = await apiFetch('/api/merchant/profile');
            const data = await res.json();
            
            if (data.success) {
                const profile = data.data;
                document.getElementById('profile-wa').value = '+' + (profile.users?.whatsapp_number || '');
                document.getElementById('profile-name').value = profile.name;
                document.getElementById('profile-email').value = profile.email || '';
            }
        } catch (e) {
            console.error('Gagal memuat profil merchant:', e);
        }
    }

    document.getElementById('profile-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('profile-name').value;
        const email = document.getElementById('profile-email').value;

        const btn = document.getElementById('btnUpdateProfile');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Menyimpan...';

        try {
            const res = await apiFetch('/api/merchant/profile', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email })
            });

            const data = await res.json();
            if (data.success) {
                showToast('Sukses', 'Profil merchant berhasil disimpan.');
                localStorage.setItem('merchantName', name);
                document.getElementById('display-merchant-name').textContent = name;
            } else {
                showToast('Gagal', data.message || 'Gagal menyimpan profil.', false);
            }
        } catch (err) {
            showToast('Error', 'Terjadi kesalahan sistem.', false);
        } finally {
            btn.disabled = false;
            btn.innerHTML = 'Simpan Perubahan';
        }
    });

    // 3. Tab QRIS: Manual Text String Input & Validation
    const qrisStringInput = document.getElementById('qris-string-input');
    const btnUploadQris = document.getElementById('btnUploadQris');
    const qrDropzone = document.getElementById('qr-dropzone');
    const qrisFileInput = document.getElementById('qris-file-input');
    const qrPreviewBox = document.getElementById('qr-image-preview-box');
    const qrPreviewImg = document.getElementById('qr-preview-img');
    const qrDecodedStatus = document.getElementById('qr-decoded-status');
    const qrUploadPlaceholder = document.getElementById('qr-upload-placeholder');
    const btnRemovePreview = document.getElementById('btnRemovePreview');

    let currentDecodedFilename = '';

    function updateWebhookForwarderUI() {
        const inputForwarder = document.getElementById('forwarder-url');
        const btnCopy = document.getElementById('btnCopyForwarderUrl');
        if (!inputForwarder) return;

        if (!hasQrisConfigured) {
            inputForwarder.value = 'Harap lengkapi/konfigurasi QRIS Merchant Anda terlebih dahulu di menu QRIS Merchant.';
            inputForwarder.classList.add('text-muted');
            inputForwarder.disabled = true;
            if (btnCopy) btnCopy.disabled = true;
        } else {
            const payload = parseJwt(token);
            if (payload && payload.merchantId) {
                const forwarderUrl = `${window.location.protocol}//${window.location.host}/api/webhook/payment/${payload.merchantId}`;
                inputForwarder.value = forwarderUrl;
                inputForwarder.classList.remove('text-muted');
                inputForwarder.disabled = false;
                if (btnCopy) btnCopy.disabled = false;
            }
        }
    }

    async function fetchQrisString() {
        try {
            const res = await apiFetch('/api/merchant/qris');
            const data = await res.json();
            const statusBox = document.getElementById('qris-status-box');
            const qrisCode = document.getElementById('qris-string-active');

            if (data.success && data.qrisString) {
                hasQrisConfigured = true;
                if (statusBox) statusBox.innerHTML = '<span class="badge bg-success"><i class="fas fa-check-circle"></i> Telah Dikonfigurasi</span>';
                if (qrisCode) qrisCode.textContent = data.qrisString;
                if (qrisStringInput) {
                    qrisStringInput.value = data.qrisString;
                }
            } else {
                hasQrisConfigured = false;
                if (statusBox) statusBox.innerHTML = '<span class="badge bg-danger"><i class="fas fa-times-circle"></i> Belum Dikonfigurasi</span>';
                if (qrisCode) qrisCode.textContent = 'Belum ada data.';
                if (qrisStringInput) {
                    qrisStringInput.value = '';
                }
            }
            updateWebhookForwarderUI();
        } catch (e) {
            console.error('Gagal mengambil string QRIS:', e);
        }
    }

    // QRIS Image Dropzone interaction
    qrDropzone?.addEventListener('click', (e) => {
        if (e.target !== btnRemovePreview && !btnRemovePreview?.contains(e.target)) {
            qrisFileInput?.click();
        }
    });

    qrDropzone?.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (qrDropzone) {
            qrDropzone.style.borderColor = '#22d3ee';
            qrDropzone.style.background = 'rgba(34, 211, 238, 0.05)';
        }
    });

    qrDropzone?.addEventListener('dragleave', () => {
        if (qrDropzone) {
            qrDropzone.style.borderColor = 'rgba(255,255,255,0.15)';
            qrDropzone.style.background = 'rgba(0,0,0,0.2)';
        }
    });

    qrDropzone?.addEventListener('drop', (e) => {
        e.preventDefault();
        if (qrDropzone) {
            qrDropzone.style.borderColor = 'rgba(255,255,255,0.15)';
            qrDropzone.style.background = 'rgba(0,0,0,0.2)';
        }
        
        const files = e.dataTransfer.files;
        if (files.length > 0 && qrisFileInput) {
            qrisFileInput.files = files;
            qrisFileInput.dispatchEvent(new Event('change'));
        }
    });

    // Handle selected image file decoding
    qrisFileInput?.addEventListener('change', async () => {
        const file = qrisFileInput.files[0];
        if (!file) return;

        // Show local preview
        const reader = new FileReader();
        reader.onload = (e) => {
            if (qrPreviewImg) qrPreviewImg.src = e.target.result;
            qrPreviewBox?.classList.remove('hidden');
            qrUploadPlaceholder?.classList.add('hidden');
        };
        reader.readAsDataURL(file);

        if (qrDecodedStatus) {
            qrDecodedStatus.innerHTML = '<span class="text-info"><i class="fas fa-spinner fa-spin me-1"></i> Mendeteksi & Mendecode QRIS...</span>';
        }

        const formData = new FormData();
        formData.append('qris_image', file);

        try {
            const token = localStorage.getItem('jwtToken');
            const res = await fetch('/api/merchant/qris/decode', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });

            const data = await res.json();
            if (data.success && data.qrisString) {
                if (qrisStringInput) qrisStringInput.value = data.qrisString;
                currentDecodedFilename = data.filename || file.name;
                if (qrDecodedStatus) {
                    qrDecodedStatus.innerHTML = '<span class="text-success"><i class="fas fa-check-circle me-1"></i> QRIS terdeteksi! Klik tombol <strong>"Simpan & Aktifkan QRIS"</strong> di bawah untuk mengaktifkan.</span>';
                }
                showToast('Sukses', 'QRIS berhasil didekode! Klik tombol Simpan untuk mengaktifkan.');
            } else {
                if (qrDecodedStatus) {
                    qrDecodedStatus.innerHTML = `<span class="text-danger"><i class="fas fa-exclamation-circle me-1"></i> ${data.message || 'Gagal mendecode QRIS.'}</span>`;
                }
                showToast('Gagal', data.message || 'QRIS tidak terdeteksi pada gambar.', false);
            }
        } catch (err) {
            console.error('Error during decode:', err);
            if (qrDecodedStatus) {
                qrDecodedStatus.innerHTML = '<span class="text-danger"><i class="fas fa-exclamation-circle me-1"></i> Kesalahan sistem menghubungi server decoder.</span>';
            }
            showToast('Error', 'Gagal memproses gambar: ' + err.message, false);
        }
    });

    btnRemovePreview?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (qrisFileInput) qrisFileInput.value = '';
        if (qrPreviewImg) qrPreviewImg.src = '';
        qrPreviewBox?.classList.add('hidden');
        qrUploadPlaceholder?.classList.remove('hidden');
        currentDecodedFilename = '';
        if (qrDecodedStatus) qrDecodedStatus.innerHTML = '';
    });

    // Save QRIS text string form submission handler
    document.getElementById('qris-upload-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const qrisStr = qrisStringInput?.value?.trim();
        if (!qrisStr) {
            showToast('Gagal', 'Kode string QRIS tidak boleh kosong.', false);
            return;
        }

        if (btnUploadQris) {
            btnUploadQris.disabled = true;
            btnUploadQris.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Menyimpan & Mengaktifkan...';
        }

        try {
            const token = localStorage.getItem('jwtToken');
            const res = await fetch('/api/merchant/qris', {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    qris_string: qrisStr,
                    filename: currentDecodedFilename
                })
            });

            const data = await res.json();
            if (data.success) {
                showToast('Sukses', 'QRIS Merchant berhasil disimpan dan diaktifkan!');
                fetchQrisString();
                // Reset file preview after successful save
                btnRemovePreview?.click();
            } else {
                showToast('Gagal', data.message || 'Gagal menyimpan QRIS.', false);
            }
        } catch (err) {
            console.error('Error during QRIS save:', err);
            showToast('Error', 'Gagal menyimpan QRIS: ' + err.message, false);
        } finally {
            if (btnUploadQris) {
                btnUploadQris.disabled = false;
                btnUploadQris.innerHTML = 'Simpan & Aktifkan QRIS';
            }
        }
    });

    // 4. Tab Webhook Settings & History Logs
    async function fetchWebhookConfig() {
        try {
            // Isi otomatis URL Forwarder Notifikasi Android khusus merchant berdasarkan status QRIS
            updateWebhookForwarderUI();

            const res = await apiFetch('/api/merchant/webhook');
            const data = await res.json();
            
            if (data.success && data.data) {
                const hook = data.data;
                document.getElementById('webhook-url').value = hook.url || '';
                document.getElementById('webhook-active').checked = hook.is_active === true;
                document.getElementById('webhook-secret-key').value = hook.secret_key || '';
            }
        } catch (e) {
            console.error('Gagal mengambil webhook settings:', e);
        }
    }

    document.getElementById('btnCopyForwarderUrl')?.addEventListener('click', () => {
        if (!hasQrisConfigured) {
            showToast('Gagal', 'Harap konfigurasi QRIS Merchant Anda terlebih dahulu.', false);
            return;
        }
        const input = document.getElementById('forwarder-url');
        if (input) {
            input.select();
            navigator.clipboard.writeText(input.value)
                .then(() => showToast('Berhasil', 'URL Forwarder disalin ke clipboard!'))
                .catch(() => showToast('Gagal', 'Gagal menyalin URL.', false));
        }
    });

    document.getElementById('webhook-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const url = document.getElementById('webhook-url').value;
        const isActive = document.getElementById('webhook-active').checked;

        const btn = document.getElementById('btnSaveWebhook');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Menyimpan...';

        try {
            const res = await apiFetch('/api/merchant/webhook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, isActive })
            });

            const data = await res.json();
            if (data.success) {
                showToast('Sukses', 'Pengaturan Webhook berhasil disimpan.');
                fetchWebhookConfig();
            } else {
                showToast('Gagal', data.message || 'Gagal menyimpan config.', false);
            }
        } catch (err) {
            showToast('Error', 'Terjadi kesalahan sistem.', false);
        } finally {
            btn.disabled = false;
            btn.innerHTML = 'Simpan Pengaturan';
        }
    });
    document.getElementById('btnToggleSecretWebhook')?.addEventListener('click', () => {
        const input = document.getElementById('webhook-secret-key');
        const icon = document.querySelector('#btnToggleSecretWebhook i');
        if (input.type === 'password') {
            input.type = 'text';
            icon.className = 'fas fa-eye-slash';
        } else {
            input.type = 'password';
            icon.className = 'fas fa-eye';
        }
    });

    document.getElementById('btnCopyWebhookSecret')?.addEventListener('click', () => {
        const input = document.getElementById('webhook-secret-key');
        if (!input.value) return;
        input.select();
        navigator.clipboard.writeText(input.value)
            .then(() => showToast('Berhasil', 'Secret HMAC Signature disalin ke clipboard!'))
            .catch(() => showToast('Gagal', 'Gagal menyalin signature.', false));
    });
    document.getElementById('btnRegenWebhookSecret')?.addEventListener('click', async () => {
        if (confirm('Apakah Anda yakin ingin merotasi HMAC Secret Key Anda? Pihak ketiga wajib menyesuaikan signature validasinya.')) {
            try {
                const res = await apiFetch('/api/merchant/webhook/generate-secret', { method: 'POST' });
                const data = await res.json();
                if (data.success) {
                    showToast('Sukses', 'Secret Key berhasil diganti.');
                    document.getElementById('webhook-secret-key').value = data.secretKey;
                }
            } catch (err) {
                showToast('Error', 'Gagal merotasi secret key.', false);
            }
        }
    });

    // Webhook History Log
    async function fetchWebhookLogs() {
        const body = document.getElementById('webhook-logs-body');
        if (!body) return;

        try {
            const res = await apiFetch('/api/merchant/webhook/logs');
            const data = await res.json();

            if (data.success && data.data && data.data.length > 0) {
                body.innerHTML = '';
                data.data.forEach(log => {
                    const date = new Date(log.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' - ' + new Date(log.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
                    const statusBadge = log.status === 'SUCCESS' ? 'bg-success' : 'bg-danger';
                    const payload = log.payload || {};

                    body.insertAdjacentHTML('beforeend', `
                        <tr class="align-middle">
                            <td class="small opacity-75">${date}</td>
                            <td class="fw-bold">${payload.reference || '-'}</td>
                            <td>Rp ${Number(payload.amount).toLocaleString('id-ID')}</td>
                            <td class="text-center font-monospace small">${log.response_status || '-'}</td>
                            <td class="text-center">
                                <span class="badge ${statusBadge}">${log.status}</span>
                            </td>
                            <td class="text-center">
                                <button class="btn btn-sm btn-outline-info btn-retry-webhook" data-id="${log.id}" title="Kirim Ulang">
                                    <i class="fas fa-paper-plane"></i> Retry
                                </button>
                            </td>
                        </tr>
                    `);
                });

                // Attach retry event listeners
                document.querySelectorAll('.btn-retry-webhook').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const logId = btn.getAttribute('data-id');
                        btn.disabled = true;
                        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Retrying';

                        try {
                            const retryRes = await apiFetch('/api/merchant/webhook/logs/retry', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ logId })
                            });
                            const retryData = await retryRes.json();
                            
                            if (retryData.success) {
                                showToast('Sukses', 'Webhook berhasil terkirim ulang (Respon 200).');
                            } else {
                                showToast('Gagal', `Retry gagal. Kode respon: ${retryData.responseStatus}`, false);
                            }
                            fetchWebhookLogs();
                        } catch (err) {
                            showToast('Error', 'Gagal memicu pengiriman ulang.', false);
                            btn.disabled = false;
                            btn.innerHTML = '<i class="fas fa-paper-plane"></i> Retry';
                        }
                    });
                });
            } else {
                body.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-white-50">Belum ada log pengiriman.</td></tr>';
            }
        } catch (e) {
            console.error('Gagal mengambil webhook logs:', e);
        }
    }

    document.getElementById('btnRefreshWebhookLogs')?.addEventListener('click', fetchWebhookLogs);

    // 5. Tab API Keys
    async function fetchApiKeys() {
        try {
            const res = await apiFetch('/api/merchant/api-keys');
            const data = await res.json();
            if (data.success && data.data) {
                document.getElementById('api-public-key').value = data.data.public_key || '';
            }
        } catch (e) {
            console.error('Gagal mengambil api keys:', e);
        }
    }

    document.getElementById('btnCopyPublicKey')?.addEventListener('click', () => {
        const input = document.getElementById('api-public-key');
        input.select();
        navigator.clipboard.writeText(input.value)
            .then(() => showToast('Berhasil', 'Kunci Publik API disalin ke clipboard!'))
            .catch(() => showToast('Gagal', 'Gagal menyalin kunci.', false));
    });

    document.getElementById('btnToggleSecretApiKey')?.addEventListener('click', () => {
        const input = document.getElementById('api-secret-key');
        const icon = document.querySelector('#btnToggleSecretApiKey i');
        if (input.type === 'password') {
            input.type = 'text';
            icon.className = 'fas fa-eye-slash';
        } else {
            input.type = 'password';
            icon.className = 'fas fa-eye';
        }
    });

    document.getElementById('btnCopySecretKey')?.addEventListener('click', () => {
        const input = document.getElementById('api-secret-key');
        if (!input.value) return;
        input.select();
        navigator.clipboard.writeText(input.value)
            .then(() => showToast('Berhasil', 'Kunci Rahasia API disalin ke clipboard!'))
            .catch(() => showToast('Gagal', 'Gagal menyalin kunci.', false));
    });

    document.getElementById('btnRotateApiKeys')?.addEventListener('click', async () => {
        if (confirm('Apakah Anda yakin ingin merotasi API Key Anda? Kunci API lama akan langsung tidak berlaku.')) {
            try {
                const res = await apiFetch('/api/merchant/api-keys/rotate', { method: 'POST' });
                const data = await res.json();
                if (data.success) {
                    document.getElementById('api-public-key').value = data.publicKey;
                    const secretInput = document.getElementById('api-secret-key');
                    if (secretInput) {
                        secretInput.value = data.secretKey;
                        // Ubah type ke text agar user langsung melihat key-nya
                        secretInput.type = 'text';
                        const icon = document.querySelector('#btnToggleSecretApiKey i');
                        if (icon) icon.className = 'fas fa-eye-slash';
                    }
                    const copyBtn = document.getElementById('btnCopySecretKey');
                    if (copyBtn) copyBtn.removeAttribute('disabled');
                    
                    showToast('Sukses', 'Rotasi Kunci API Berhasil! Secret Key baru telah dimasukkan ke kolom input dan siap disalin.');
                }
            } catch (err) {
                showToast('Error', 'Gagal merotasi API keys.', false);
            }
        }
    });

    // 6. Tab Riwayat Transaksi
    async function fetchTransactions() {
        const body = document.getElementById('transaction-list-body');
        if (!body) return;

        try {
            const res = await apiFetch('/api/merchant/transactions');
            const data = await res.json();

            if (data.success && data.data && data.data.length > 0) {
                body.innerHTML = '';
                data.data.forEach(t => {
                    const date = new Date(t.created_at).toLocaleString('id-ID', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                    let badgeClass = 'bg-warning text-dark';
                    if (t.status === 'PAID') badgeClass = 'bg-success';
                    else if (t.status === 'CANCELLED') badgeClass = 'bg-danger';

                    body.insertAdjacentHTML('beforeend', `
                        <tr class="align-middle">
                            <td class="small opacity-75">${date}</td>
                            <td class="fw-bold">${t.reference_id}</td>
                            <td>Rp ${Number(t.base_amount).toLocaleString('id-ID')}</td>
                            <td class="text-info font-monospace">+Rp ${Number(t.unique_code).toLocaleString('id-ID')}</td>
                            <td class="fw-bold text-success">Rp ${Number(t.total_amount).toLocaleString('id-ID')}</td>
                            <td class="text-center">
                                <span class="badge ${badgeClass}"><i class="fas ${t.status === 'PAID' ? 'fa-check-circle' : t.status === 'CANCELLED' ? 'fa-times-circle' : 'fa-spinner fa-spin'} me-1"></i>${t.status}</span>
                            </td>
                        </tr>
                    `);
                });
            } else {
                body.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-white-50">Belum ada riwayat transaksi.</td></tr>';
            }
        } catch (e) {
            console.error('Gagal memuat daftar transaksi:', e);
            body.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-danger">Gagal memuat transaksi.</td></tr>';
        }
    }

    document.getElementById('btnRefreshTransactions')?.addEventListener('click', fetchTransactions);

    // 7. Tab Pengaturan SaaS
    async function fetchSaaSSettings() {
        try {
            const res = await apiFetch('/api/saas-settings');
            const data = await res.json();
            if (data.success && data.data) {
                document.getElementById('settings-code-len').value = data.data.code_len || '3';
                document.getElementById('settings-expiry').value = data.data.expiry_minutes || '10';
                currentExpiryMinutes = Number(data.data.expiry_minutes) || 10;
            }
        } catch (e) {
            console.error('Gagal mengambil pengaturan SaaS:', e);
        }
    }

    document.getElementById('settings-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const codeLen = document.getElementById('settings-code-len').value;
        const expiryMinutes = document.getElementById('settings-expiry').value;

        const btn = document.getElementById('btnSaveSettings');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Menyimpan...';

        try {
            const res = await apiFetch('/api/saas-settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code_len: codeLen, expiry_minutes: expiryMinutes })
            });

            const data = await res.json();
            if (data.success) {
                showToast('Sukses', 'Pengaturan SaaS berhasil disimpan.');
                fetchSaaSSettings();
            } else {
                showToast('Gagal', data.message || 'Gagal menyimpan pengaturan.', false);
            }
        } catch (err) {
            showToast('Error', 'Terjadi kesalahan sistem.', false);
        } finally {
            btn.disabled = false;
            btn.innerHTML = 'Simpan Pengaturan';
        }
    });

    // --------------------------------------------------------------
    // LOGIKA MANUAL BILLING (BUAT TAGIHAN MANUAL)
    // --------------------------------------------------------------
    let billingPollInterval = null;
    let billingTimerInterval = null;
    let activeBillingTrxId = null;
    let currentExpiryMinutes = 10;

    function setQrOverlay(text, colorClass) {
        const container = document.getElementById('billing-qr-container');
        if (!container) return;
        
        const oldOverlay = container.querySelector('.qr-overlay');
        if (oldOverlay) oldOverlay.remove();

        const qrImg = document.getElementById('billing-qr-img');

        if (text) {
            const overlay = document.createElement('div');
            overlay.className = 'qr-overlay';
            overlay.style = `
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.7);
                display: flex;
                align-items: center;
                justify-content: center;
                color: #fff;
                font-weight: bold;
                font-size: 1.25rem;
                letter-spacing: 2px;
                text-transform: uppercase;
                z-index: 10;
            `;
            overlay.innerHTML = `<span class="${colorClass}">${text}</span>`;
            container.appendChild(overlay);
            
            if (qrImg) qrImg.style.filter = 'blur(8px) grayscale(100%)';
        } else {
            if (qrImg) qrImg.style.filter = 'none';
        }
    }

    document.getElementById('billing-manual-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const amount = document.getElementById('billing-amount').value;
        const description = document.getElementById('billing-description').value;

        const btn = document.getElementById('btnCreateManualBill');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Memproses...';

        // Reset state sebelumnya
        clearInterval(billingPollInterval);
        clearInterval(billingTimerInterval);
        setQrOverlay(null);

        try {
            const res = await apiFetch('/api/merchant/payment/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount, description })
            });
            const data = await res.json();

            if (data.success) {
                activeBillingTrxId = data.trxId;
                
                // Tampilkan card hasil
                const resultCard = document.getElementById('billing-result-card');
                resultCard.classList.remove('hidden');
                
                // Isi data
                document.getElementById('billing-qr-img').src = data.qrisImage;
                document.getElementById('billing-display-amount').textContent = 'Rp ' + Number(data.totalAmount).toLocaleString('id-ID');
                
                // Setup status spinner awal
                const statusSpinner = document.getElementById('billing-status-spinner');
                statusSpinner.innerHTML = `
                    <div class="spinner-grow spinner-grow-sm text-info" role="status"></div>
                    <span class="text-info fw-bold" id="billing-display-status">Menunggu Pembayaran...</span>
                `;

                // Mulai Hitung Mundur Dinamik
                let timeLeft = currentExpiryMinutes * 60;
                const timerEl = document.getElementById('billing-display-timer');
                timerEl.className = "badge bg-danger bg-opacity-10 border border-danger border-opacity-25 text-danger py-2 px-3 rounded-pill mb-3";
                timerEl.innerHTML = `<i class="fas fa-clock me-1"></i> Berlaku: ${Math.floor(timeLeft / 60)}:00`;
 
                billingTimerInterval = setInterval(() => {
                    timeLeft--;
                    if (timeLeft <= 0) {
                        clearInterval(billingTimerInterval);
                        clearInterval(billingPollInterval);
                        
                        // Batalkan transaksi di server secara otomatis karena kedaluwarsa
                        if (activeBillingTrxId) {
                            apiFetch('/api/payment/cancel', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ trxId: activeBillingTrxId })
                            }).catch(err => console.error('Gagal membatalkan transaksi kedaluwarsa:', err));
                        }
 
                        timerEl.innerHTML = `<i class="fas fa-exclamation-triangle me-1"></i> Telah Kedaluwarsa`;
                        statusSpinner.innerHTML = `
                            <i class="fas fa-exclamation-circle text-danger"></i>
                            <span class="text-danger fw-bold">Tagihan Kedaluwarsa.</span>
                        `;
                        setQrOverlay('KEDALUWARSA', 'text-warning');
                        showToast('Kedaluwarsa', 'Waktu pembayaran tagihan manual telah habis.', false);
                    } else {
                        const mins = Math.floor(timeLeft / 60).toString().padStart(2, '0');
                        const secs = (timeLeft % 60).toString().padStart(2, '0');
                        timerEl.innerHTML = `<i class="fas fa-clock me-1"></i> Berlaku: ${mins}:${secs}`;
                    }
                }, 1000);

                // Mulai Polling Status Transaksi
                billingPollInterval = setInterval(async () => {
                    if (!activeBillingTrxId) return;
                    try {
                        const checkRes = await apiFetch(`/api/payment/check?trxId=${activeBillingTrxId}`);
                        const checkData = await checkRes.json();
                        
                        if (checkData.success) {
                            if (checkData.status === 'PAID') {
                                clearInterval(billingPollInterval);
                                clearInterval(billingTimerInterval);
                                
                                timerEl.className = "badge bg-success bg-opacity-10 border border-success border-opacity-25 text-success py-2 px-3 rounded-pill mb-3";
                                timerEl.innerHTML = `<i class="fas fa-check-circle me-1"></i> Sukses Dibayar`;
                                
                                statusSpinner.innerHTML = `
                                    <i class="fas fa-check-circle text-success fa-lg"></i>
                                    <span class="text-success fw-bold">Pembayaran Sukses!</span>
                                `;
                                setQrOverlay('LUNAS', 'text-success');
                                showToast('Pembayaran Diterima', 'Tagihan manual Anda telah berhasil lunas.');
                                
                                // Refresh statistik & daftar transaksi
                                fetchStatistics();
                                fetchTransactions();
                            } else if (checkData.status === 'CANCELLED') {
                                clearInterval(billingPollInterval);
                                clearInterval(billingTimerInterval);
                                
                                timerEl.className = "badge bg-secondary bg-opacity-10 border border-secondary border-opacity-25 text-white-50 py-2 px-3 rounded-pill mb-3";
                                timerEl.innerHTML = `<i class="fas fa-times me-1"></i> Dibatalkan`;
                                
                                statusSpinner.innerHTML = `
                                    <i class="fas fa-times-circle text-danger fa-lg"></i>
                                    <span class="text-danger fw-bold">Transaksi Dibatalkan.</span>
                                `;
                                setQrOverlay('DIBATALKAN', 'text-danger');
                            }
                        }
                    } catch (err) {
                        console.error('Gagal polling status tagihan manual:', err);
                    }
                }, 3000);

                showToast('Sukses', 'Tagihan QRIS dinamis berhasil dibuat.');
            } else {
                showToast('Gagal', data.message || 'Gagal membuat tagihan.', false);
            }
        } catch (err) {
            showToast('Error', 'Terjadi kesalahan sistem saat membuat tagihan.', false);
        } finally {
            btn.disabled = false;
            btn.innerHTML = 'Buat QRIS Dinamis';
        }
    });

    document.getElementById('btnCancelManualBill')?.addEventListener('click', async () => {
        if (!activeBillingTrxId) return;
        const btn = document.getElementById('btnCancelManualBill');
        btn.disabled = true;

        try {
            const res = await apiFetch('/api/payment/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ trxId: activeBillingTrxId })
            });
            const data = await res.json();

            if (data.success) {
                clearInterval(billingPollInterval);
                clearInterval(billingTimerInterval);
                
                document.getElementById('billing-display-timer').className = "badge bg-secondary bg-opacity-10 border border-secondary border-opacity-25 text-white-50 py-2 px-3 rounded-pill mb-3";
                document.getElementById('billing-display-timer').innerHTML = `<i class="fas fa-times me-1"></i> Dibatalkan`;
                
                document.getElementById('billing-status-spinner').innerHTML = `
                    <i class="fas fa-times-circle text-danger fa-lg"></i>
                    <span class="text-danger fw-bold">Transaksi Dibatalkan.</span>
                `;
                setQrOverlay('DIBATALKAN', 'text-danger');
                showToast('Dibatalkan', 'Tagihan manual berhasil dibatalkan.');
                fetchStatistics();
                fetchTransactions();
            } else {
                showToast('Gagal', data.message || 'Gagal membatalkan tagihan.', false);
            }
        } catch (err) {
            showToast('Error', 'Gagal membatalkan tagihan.', false);
        } finally {
            btn.disabled = false;
        }
    });

    document.getElementById('btnResetManualForm')?.addEventListener('click', async () => {
        if (activeBillingTrxId) {
            try {
                await apiFetch('/api/payment/cancel', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ trxId: activeBillingTrxId })
                });
            } catch (err) {
                console.error('Gagal membatalkan transaksi aktif saat reset:', err);
            }
        }
        clearInterval(billingPollInterval);
        clearInterval(billingTimerInterval);
        activeBillingTrxId = null;
        setQrOverlay(null);

        document.getElementById('billing-amount').value = '';
        document.getElementById('billing-description').value = '';
        document.getElementById('billing-result-card').classList.add('hidden');
    });

    // Muat data awal dashboard
    fetchStatistics();
    fetchWebhookConfig();
    fetchQrisString();
    fetchSaaSSettings();

    // Real-time polling untuk dashboard dan transaksi (tanpa refresh)
    setInterval(() => {
        fetchStatistics();
        fetchTransactions();
    }, 5000); // Polling setiap 5 detik
});
