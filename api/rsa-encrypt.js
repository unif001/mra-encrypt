import fs from "fs";
import path from "path";
import { publicEncrypt } from "crypto";

export default function handler(req, res) {
  try {
    // Load PEM-formatted public key
    const keyPath = path.join(__dirname, "MRAPublicKey.pem");
    const publicKeyPem = fs.readFileSync(keyPath, "utf8");

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
