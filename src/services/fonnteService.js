const dotenv = require('dotenv');
const dns = require('dns');

// Paksa Node.js mendahulukan IPv4 untuk menghindari timeout koneksi pada IPv6
if (typeof dns.setDefaultResultOrder === 'function') {
    dns.setDefaultResultOrder('ipv4first');
}

dotenv.config();

const FONNTE_TOKEN = process.env.FONNTE_TOKEN || '';

/**
 * Mengirim pesan WhatsApp menggunakan Fonnte API dengan format FormData (Multipart/form-data).
 * 
 * @param {string} target Nomor WhatsApp tujuan
 * @param {string} message Isi pesan teks
 * @returns {Promise<{success: boolean, simulated?: boolean, error?: string, raw?: any}>}
 */
async function sendWhatsAppMessage(target, message) {
    if (!FONNTE_TOKEN) {
        console.log(`================================================================`);
        console.log(`📢 [Fonnte SIMULASI WA]`);
        console.log(`📱 Tujuan: ${target}`);
        console.log(`💬 Isi Pesan: \n${message}`);
        console.log(`================================================================`);
        return { success: true, simulated: true };
    }

    try {
        // Menggunakan standard FormData global dari Node.js v22
        const data = new FormData();
        data.append("target", target);
        data.append("message", message);
        data.append("countryCode", "62"); // Auto replace leading 0 ke 62 dari Fonnte

        console.log(`[Fonnte] Mengirim pesan ke ${target} via FormData...`);

        const response = await fetch("https://api.fonnte.com/send", {
            method: "POST",
            headers: {
                "Authorization": FONNTE_TOKEN,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "*/*"
            },
            body: data
        });

        const resData = await response.json();
        console.log('[Fonnte API Respon Raw]:', JSON.stringify(resData));

        const isSuccess = resData.status === true || resData.status === 'true' || resData.status === 1 || resData.status === "true";
        return { success: isSuccess, raw: resData };
    } catch (err) {
        console.error('[Fonnte Error] Gagal mengirim pesan WhatsApp:', err.message, err.cause ? 'Cause: ' + err.cause.message : '');
        if (err.cause) {
            console.error('[Fonnte Error Cause Detail]:', err.cause);
        }
        return { success: false, error: err.message + (err.cause ? ' (' + err.cause.message + ')' : '') };
    }
}

module.exports = {
    sendWhatsAppMessage
};
