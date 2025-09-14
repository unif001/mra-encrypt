import fs from "fs";
import path from "path";
import { X509Certificate, publicEncrypt } from "crypto";

export default function handler(req, res) {
  try {
    // Load certificate (.crt file from MRA)
    const certPath = path.join(__dirname, "MRAPublicKey.crt");
    const certData = fs.readFileSync(certPath);

    // Extract public key in PEM format
    const x509 = new X509Certificate(certData);
    const publicKeyPem = x509.publicKey.export({ type: "spki", format: "pem" });

    // Encrypt payload JSON
    const payloadJSON = JSON.stringify(req.body.payload);
    const encryptedBuffer = publicEncrypt(publicKeyPem, Buffer.from(payloadJSON));
    const encryptedBase64 = encryptedBuffer.toString("base64");

    res.status(200).json({ encrypted: encryptedBase64 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
