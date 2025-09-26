// api/rsa-encrypt.js
import { publicEncrypt } from "crypto";

export default function handler(req, res) {
  try {
    const publicKeyPem = process.env.MRA_PUBLIC_KEY;
    if (!publicKeyPem) {
      return res.status(500).json({ error: "MRA public key not configured" });
    }

    const payloadJSON = JSON.stringify(req.body.payload);
    const encryptedBuffer = publicEncrypt(publicKeyPem, Buffer.from(payloadJSON));
    const encryptedBase64 = encryptedBuffer.toString("base64");

    res.status(200).json({ encrypted: encryptedBase64 });
  } catch (err) {
    console.error("rsa-encrypt error:", err);
    res.status(500).json({ error: err.message });
  }
}
