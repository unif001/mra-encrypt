// api/generate-aes.js
import crypto from "crypto";


export default function handler(req, res) {
  try {
    // Generate random 32-byte AES key
    const key = crypto.randomBytes(32); // 256-bit
    const base64Key = key.toString("base64");

    res.status(200).json({
      aesKey: base64Key
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate AES key" });
  }
}
