const { Jimp } = require('jimp');
const jsQR = require('jsqr');

/**
 * Mendecode gambar QR code dari path file menjadi string teks QRIS.
 * 
 * @param {string} filePath Absolute path ke gambar QR code yang diupload
 * @returns {Promise<string>} String QRIS
 */
async function decodeQrisImage(filePath) {
    try {
        const image = await Jimp.read(filePath);
        const { data, width, height } = image.bitmap;
        
        // jsQR memerlukan Uint8ClampedArray untuk datanya
        const clampedData = new Uint8ClampedArray(data);
        const code = jsQR(clampedData, width, height);
        
        if (!code || !code.data) {
            throw new Error('QR Code tidak terdeteksi pada gambar. Pastikan gambar QR memiliki resolusi dan pencahayaan yang cukup.');
        }

        const qrisString = code.data.trim();
        
        // Validasi format QRIS dasar (wajib diawali dengan tag standar 000201)
        if (!qrisString.startsWith('000201')) {
            throw new Error('QR Code yang diunggah bukan QRIS Statis standar yang valid (harus diawali 000201).');
        }

        return qrisString;
    } catch (err) {
        throw new Error('Gagal mendecode QRIS: ' + err.message);
    }
}

module.exports = {
    decodeQrisImage
};
