// api/encrypt-invoice.js
import crypto from "crypto";


export default function handler(req, res) {
  try {
    const { plainText, aesKey } = req.body || {};
    if (!plainText || !aesKey) {
      return res.status(400).json({ error: "Missing plainText or aesKey" });
    }

    const keyBuf = Buffer.from(aesKey, "utf8"); // decrypted MRA key is plain string (not base64)
    const cipher = crypto.createCipheriv("aes-256-ecb", keyBuf, null);
    cipher.setAutoPadding(true);
    const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]).toString("base64");

    return res.status(200).json({ encryptedText: encrypted });
  } catch (err) {
    console.error("encrypt-invoice error:", err);
    return res.status(500).json({ error: err.message });
  }
}
