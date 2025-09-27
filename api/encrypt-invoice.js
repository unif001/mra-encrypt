import crypto from "crypto";

export default function handler(req, res) {
  try {
    const { plainText, aesKey } = req.body;

    if (!plainText || !aesKey) {
      return res.status(400).json({ error: "Missing plainText or aesKey" });
    }

    // 🔑 Decode Base64 AES key into raw bytes
    const keyBuffer = Buffer.from(aesKey, "base64");

    // ECB mode doesn’t use IV → pass null
    const cipher = crypto.createCipheriv("aes-256-ecb", keyBuffer, null);

    let encrypted = cipher.update(plainText, "utf8", "base64");
    encrypted += cipher.final("base64");

    res.status(200).json({ encryptedText: encrypted });
  } catch (err) {
    console.error("encrypt-invoice error:", err);
    res.status(500).json({ error: err.message });
  }
}
