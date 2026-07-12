/**
 * SCRIPT PENGUJI API PAYMENT GATEWAY SAAS
 * 
 * Cara Menjalankan:
 * 1. Jalankan perintah: node test-api.js
 * 
 * Pastikan server utama (node server) sudah aktif berjalan.
 */

const http = require('http');
const https = require('https');
const readline = require('readline');
const qrcodeTerminal = require('qrcode-terminal');

// =====================================================================
// KONFIGURASI KREDENSIAL API (Ubah sesuai dengan Kunci API di Dashboard)
// =====================================================================
const PUBLIC_KEY = 'pk_96a7317fb3177f246857003e734cd7fc';
const SECRET_KEY = 'sk_c83d5fc2ee19043f32efd58e2cf62e5fd329a1b836127001';
const MERCHANT_ID = 'Ubah_Dengan_Merchant_ID_An00020101021126610014COM.GO-JEK.WWW01189360091431679533980210G1679533980303UMI51440014ID.CO.QRIS.WWW0215ID10265474788380303UMI5204573253033605802ID5925AANG FEBRIANSYAH, Elektro6011TANAH BUMBU61057227662070703A016304C19Bda';
const BASE_URL = 'https://febz-autopost.web.id';

console.log('====================================================');
console.log('⚡ MEMULAI PENGUJIAN INTEGRASI PAYMENT GATEWAY API');
console.log('====================================================\n');

// 1. Helper untuk menentukan Client HTTP atau HTTPS
function getClient(urlStr) {
    return urlStr.startsWith('https:') ? https : http;
}

// 2. Fungsi Helper untuk Request HTTP POST JSON (Mendukung HTTP & HTTPS)
function postJson(urlPath, headers, bodyData) {
    return new Promise((resolve, reject) => {
        const fullUrlStr = BASE_URL + urlPath;
        const url = new URL(fullUrlStr);
        const client = getClient(fullUrlStr);
        const dataString = JSON.stringify(bodyData);

        const options = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(dataString),
                ...headers
            }
        };

        const req = client.request(options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => { responseData += chunk; });
            res.on('end', () => {
                try {
                    resolve({
                        statusCode: res.statusCode,
                        data: JSON.parse(responseData)
                    });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, raw: responseData });
                }
            });
        });

        req.on('error', (e) => reject(e));
        req.write(dataString);
        req.end();
    });
}

// 3. Fungsi Helper untuk Request HTTP GET (Mendukung HTTP & HTTPS)
function getJson(urlPath) {
    return new Promise((resolve, reject) => {
        const fullUrlStr = BASE_URL + urlPath;
        const url = new URL(fullUrlStr);
        const client = getClient(fullUrlStr);

        const options = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search,
            method: 'GET'
        };

        const req = client.request(options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => { responseData += chunk; });
            res.on('end', () => {
                try {
                    resolve({
                        statusCode: res.statusCode,
                        data: JSON.parse(responseData)
                    });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, raw: responseData });
                }
            });
        });

        req.on('error', (e) => reject(e));
        req.end();
    });
}

// Interface Readline untuk Prompt Terminal
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function askQuestion(query) {
    return new Promise((resolve) => rl.question(query, resolve));
}

// 4. Jalankan Skenario Tes Alur Transaksi
async function runTest() {
    try {
        if (PUBLIC_KEY.startsWith('pk_Ubah_')) {
            console.log('⚠️  PERINGATAN: Harap ubah variabel PUBLIC_KEY dan SECRET_KEY di dalam script ini');
            console.log('   menggunakan Kunci API asli dari menu "API Key Akses" pada panel dashboard.\n');
        }

        // --- SKENARIO 1: MEMBUAT INVOICE QRIS DINAMIS ---
        console.log('🚀 [Langkah 1] Membuat Tagihan QRIS Dinamis...');
        const refId = 'INV-TEST-' + Math.floor(Math.random() * 1000000);
        const amount = 1000; // Nominal dasar Rp 1.000

        const genRes = await postJson('/api/payment/generate-qris', {
            'x-api-key': PUBLIC_KEY,
            'x-secret-key': SECRET_KEY
        }, {
            amount: amount,
            referenceId: refId
        });

        if (genRes.statusCode !== 200 || !genRes.data.success) {
            console.error('❌ Gagal membuat QRIS:', genRes.data || genRes.raw);
            console.log('\n💡 Tips: Pastikan server menyala dan API Keys Anda sudah didaftarkan/diaktifkan.');
            rl.close();
            return;
        }

        const trxData = genRes.data;
        console.log('\n✅ QRIS Dinamis Berhasil Dibuat!');
        console.log(`   - ID Transaksi (trxId) : ${trxData.trxId}`);
        console.log(`   - Kode Referensi       : ${trxData.referenceId}`);
        console.log(`   - Nominal Dasar        : Rp ${trxData.amountBase.toLocaleString('id-ID')}`);
        console.log(`   - Kode Unik Transaksi  : +Rp ${trxData.uniqueCode}`);
        console.log(`   - Total Harus Bayar    : Rp ${trxData.totalAmount.toLocaleString('id-ID')}`);
        console.log('----------------------------------------------------');
        console.log('📲 SCAN QRIS DI BAWAH INI UNTUK MEMBAYAR:');
        console.log('----------------------------------------------------');
        
        // Tampilkan QR Code di Terminal
        qrcodeTerminal.generate(trxData.qrisString, { small: true });

        console.log('----------------------------------------------------');
        console.log('💡 CARA SIMULASI PEMBAYARAN VIA TERMINAL LAIN:');
        const curlGetUrl = `${BASE_URL}/api/webhook/payment/${MERCHANT_ID}?name=gopay&pkg=com.gojek.gopay&text=transfer%20Rp%20${trxData.totalAmount}&sign=h3ruc0d3`;
        console.log(`   curl -X GET "${curlGetUrl}"`);
        console.log('----------------------------------------------------');

        // Loop Menu Pertanyaan
        while (true) {
            console.log('\nPILIH TINDAKAN TRANSAKSI:');
            console.log('1. Cancel Pembayaran (Batalkan Transaksi)');
            console.log('2. Lanjut Pembayaran (Cek / Polling Status Pembayaran)');
            console.log('3. Keluar Script');
            
            const choice = await askQuestion('\nMasukkan pilihan Anda (1/2/3): ');
            
            if (choice === '1') {
                console.log('\n⏳ Membatalkan transaksi...');
                const cancelRes = await postJson('/api/payment/cancel', {}, { trxId: trxData.trxId });
                if (cancelRes.statusCode === 200 && cancelRes.data.success) {
                    console.log('✅ Transaksi Berhasil DIBATALKAN!');
                } else {
                    console.log('❌ Gagal membatalkan transaksi:', cancelRes.data || cancelRes.raw);
                }
                break;
            } 
            else if (choice === '2') {
                console.log('\n⏳ Memulai Polling Status Pembayaran... (Kirim notifikasi pembayaran untuk melihat perubahan)');
                console.log('Tekan Ctrl+C untuk menghentikan polling.\n');
                
                let isPaid = false;
                for (let i = 0; i < 40; i++) { // Polling maksimal selama ~2 menit
                    const checkRes = await getJson(`/api/payment/check?trxId=${trxData.trxId}`);
                    const status = checkRes.data ? checkRes.data.status : 'UNKNOWN';
                    
                    process.stdout.write(`\r[Detik ${(i * 3)}] Status transaksi: [${status}] ... `);
                    
                    if (status === 'PAID') {
                        console.log('\n\n🎉 PEMBAYARAN SUKSES DITERIMA!');
                        console.log(`   - Waktu Bayar: ${checkRes.data.paidAt}`);
                        console.log(`   - Nominal: Rp ${checkRes.data.totalAmount.toLocaleString('id-ID')}`);
                        isPaid = true;
                        break;
                    } else if (status === 'CANCELLED') {
                        console.log('\n\n❌ TRANSAKSI DIBATALKAN / KEDALUWARSA!');
                        break;
                    }
                    
                    await new Promise((resolve) => setTimeout(resolve, 3000));
                }
                if (!isPaid) {
                    console.log('\n⚠️ Polling berakhir. Transaksi belum terbayar.');
                }
                break;
            } 
            else if (choice === '3') {
                console.log('\n👋 Keluar dari script pengujian.');
                break;
            } 
            else {
                console.log('❌ Pilihan tidak valid. Silakan ketik angka 1, 2, atau 3.');
            }
        }

    } catch (error) {
        console.error('❌ Terjadi kesalahan koneksi sistem:', error.message);
    } finally {
        rl.close();
    }
}

runTest();
