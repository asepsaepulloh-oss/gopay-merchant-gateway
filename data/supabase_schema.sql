-- ==============================================================
-- SKEMA DATABASE SUPABASE / POSTGRESQL - WEBHOOK GATEWAY QRIS
-- ==============================================================

-- Aktifkan ekstensi UUID-OSSP
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Tabel users (Autentikasi menggunakan WhatsApp & Password)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    whatsapp_number VARCHAR(20) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'merchant' CHECK (role IN ('merchant', 'admin')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Tabel merchants (Profil Merchant)
CREATE TABLE IF NOT EXISTS merchants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Tabel merchant_qris (String QRIS Merchant yang di-decode)
CREATE TABLE IF NOT EXISTS merchant_qris (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE UNIQUE NOT NULL,
    qris_string TEXT NOT NULL,
    original_filename VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Tabel api_keys (Akses API Publik & Secret)
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE NOT NULL,
    public_key VARCHAR(100) UNIQUE NOT NULL,
    secret_key_hash VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Tabel webhook_settings (URL callback & secret HMAC merchant)
CREATE TABLE IF NOT EXISTS webhook_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE UNIQUE NOT NULL,
    url VARCHAR(255) NOT NULL,
    secret_key VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. Tabel transactions (Invoice, kode unik & pendapatan platform)
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE NOT NULL,
    reference_id VARCHAR(100) NOT NULL,
    base_amount NUMERIC(15,2) NOT NULL,
    unique_code NUMERIC(15,2) NOT NULL,
    total_amount NUMERIC(15,2) NOT NULL,
    merchant_received_amount NUMERIC(15,2) NOT NULL,
    platform_income NUMERIC(15,2) NOT NULL,
    payment_method VARCHAR(50) DEFAULT 'QRIS',
    status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'CANCELLED')),
    payload_raw JSONB,
    paid_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 7. Tabel webhook_logs (Log histori pengiriman webhook merchant)
CREATE TABLE IF NOT EXISTS webhook_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id UUID REFERENCES transactions(id) ON DELETE CASCADE NOT NULL,
    payload JSONB NOT NULL,
    response_status INTEGER,
    response_body TEXT,
    attempts INTEGER DEFAULT 1,
    status VARCHAR(20) CHECK (status IN ('SUCCESS', 'FAILED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 8. Tabel otp_codes (Kode OTP login WhatsApp)
CREATE TABLE IF NOT EXISTS otp_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    whatsapp_number VARCHAR(20) NOT NULL,
    code VARCHAR(6) NOT NULL,
    is_used BOOLEAN DEFAULT FALSE,
    expired_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 9. Tabel password_reset_tokens (Token reset password)
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    whatsapp_number VARCHAR(20) NOT NULL,
    token VARCHAR(100) UNIQUE NOT NULL,
    is_used BOOLEAN DEFAULT FALSE,
    expired_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 10. Tabel payment_methods (Daftar metode pembayaran flexibel)
CREATE TABLE IF NOT EXISTS payment_methods (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE
);

-- 11. Tabel audit_logs (Log aktivitas sistem)
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    ip_address VARCHAR(45),
    details TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- --------------------------------------------------------------
-- MEMBUAT INDEX UNTUK OPTIMASI PERFORMA
-- --------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_users_whatsapp ON users(whatsapp_number);
CREATE INDEX IF NOT EXISTS idx_merchants_user ON merchants(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_merchant_status ON transactions(merchant_id, status);
CREATE INDEX IF NOT EXISTS idx_transactions_reference ON transactions(merchant_id, reference_id);
CREATE INDEX IF NOT EXISTS idx_transactions_amount ON transactions(total_amount);
CREATE INDEX IF NOT EXISTS idx_api_keys_public ON api_keys(public_key);
CREATE INDEX IF NOT EXISTS idx_otp_codes_number_code ON otp_codes(whatsapp_number, code);
CREATE INDEX IF NOT EXISTS idx_reset_tokens_val ON password_reset_tokens(token);

-- --------------------------------------------------------------
-- TRIGGER UNTUK UPDATE COLUMN 'updated_at' OTOMATIS
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_users_modtime ON users;
CREATE TRIGGER update_users_modtime 
    BEFORE UPDATE ON users 
    FOR EACH ROW 
    EXECUTE PROCEDURE update_updated_at_column();

-- Data awal Metode Pembayaran
INSERT INTO payment_methods (code, name) VALUES ('qris', 'QRIS Dinamis') ON CONFLICT (code) DO NOTHING;

-- --------------------------------------------------------------
-- ROW LEVEL SECURITY (RLS) POLICIES
-- --------------------------------------------------------------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_qris ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- Kebijakan RLS agar pengguna hanya bisa membaca/mengubah data miliknya
DROP POLICY IF EXISTS "Users can view their own data" ON users;
CREATE POLICY "Users can view their own data" ON users 
    FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Merchants can view their own profile" ON merchants;
CREATE POLICY "Merchants can view their own profile" ON merchants 
    FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Merchants can update their own profile" ON merchants;
CREATE POLICY "Merchants can update their own profile" ON merchants 
    FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Merchants can view their own QRIS" ON merchant_qris;
CREATE POLICY "Merchants can view their own QRIS" ON merchant_qris 
    FOR SELECT USING (merchant_id IN (SELECT id FROM merchants WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Merchants can modify their own QRIS" ON merchant_qris;
CREATE POLICY "Merchants can modify their own QRIS" ON merchant_qris 
    FOR ALL USING (merchant_id IN (SELECT id FROM merchants WHERE user_id = auth.uid()));
