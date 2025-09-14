import fs from 'fs';
import path from 'path';
import { X509Certificate } from 'crypto';
import NodeRSA from 'node-rsa';

export default function handler(req, res) {
  try {
    // Load .crt file
    const certPath = path.join(__dirname, 'MRAPublicKey.crt');
    const certData = fs.readFileSync(certPath);

    // Extract the public key from the certificate
    const x509 = new X509Certificate(certData);
    const publicKeyPem = x509.publicKey.export({ type: 'spki', format: 'pem' });

    // Initialize RSA with the extracted key
    const key = new NodeRSA(publicKeyPem, 'pkcs8-public');

    const payloadJSON = JSON.stringify(req.body.payload);
    const encrypted = key.encrypt(payloadJSON, 'base64');

    res.status(200).json({ encrypted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
