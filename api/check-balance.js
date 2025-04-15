const StellarSdk = require('stellar-sdk');
const bip39 = require('bip39');
const HDKey = require('hdkey');
const fetch = require('node-fetch');

// Cấu hình
const PI_API_URL = "https://api.mainnet.minepi.com";
const DEFAULT_MIN_BALANCE = 0.05;

// Tạo keypair từ mnemonic
async function getKeyPairFromMnemonic(mnemonic) {
    const seed = await bip39.mnemonicToSeed(mnemonic);
    const derivationPath = "m/44'/314159'/0'";
    const hdkey = HDKey.fromMasterSeed(seed);
    const childKey = hdkey.derive(derivationPath);
    const privateKey = childKey.privateKey;
    return StellarSdk.Keypair.fromRawEd25519Seed(privateKey);
}

// Kiểm tra số dư tài khoản
async function checkAccountBalance(publicKey) {
    const response = await fetch(`${PI_API_URL}/accounts/${publicKey}`);
    
    if (response.status === 404) {
        return 0;
    }
    
    if (!response.ok) {
        throw new Error(`Lỗi API: ${response.status}`);
    }
    
    const data = await response.json();
    
    let balance = 0;
    for (const balanceInfo of data.balances) {
        if (balanceInfo.asset_type === "native") {
            balance = parseFloat(balanceInfo.balance);
            break;
        }
    }
    
    return balance;
}

module.exports = async (req, res) => {
    // Cấu hình CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Chỉ chấp nhận phương thức POST' });
    }

    try {
        const { mnemonic } = req.body;
        
        if (!mnemonic) {
            return res.status(400).json({ error: 'Thiếu mnemonic' });
        }
        
        const keypair = await getKeyPairFromMnemonic(mnemonic);
        const publicKey = keypair.publicKey();
        const balance = await checkAccountBalance(publicKey);
        
        const minBalance = DEFAULT_MIN_BALANCE;
        const txFee = 0.01;
        
        let canSend = false;
        let availableToSend = 0;
        
        if (balance > minBalance + txFee) {
            canSend = true;
            availableToSend = balance - minBalance - txFee;
        }
        
        res.status(200).json({
            publicKey,
            balance,
            canSend,
            availableToSend,
            minBalance,
            txFee
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
