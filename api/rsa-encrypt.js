// /api/rsa-encrypt.js
const fs = require('fs');
const path = require('path');
const NodeRSA = require('node-rsa');

export default function handler(req, res) {
  try {
    // Load the public key file
    const publicKeyData = fs.readFileSync(path.join(process.cwd(), 'MRAPublicKey.crt'), 'utf8');

    const key = new NodeRSA(publicKeyData);
    const payloadJSON = JSON.stringify(req.body.payload);

    const encrypted = key.encrypt(payloadJSON, 'base64');
    res.status(200).json({ encrypted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
