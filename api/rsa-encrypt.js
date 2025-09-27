import { publicEncrypt, constants } from "crypto";
import fs from "fs";
import path from "path";

export default function handler(req, res) {
  try {
    // Resolve PEM file in the same folder as this API route
    const keyPath = path.join(__dirname, "MRAPublicKey.pem");
    const publicKeyPem = fs.readFileSync(keyPath, "utf8");

    const payloadJSON = JSON.stringify(req.body.payload);

    const encryptedBuffer = publicEncrypt(
      {
        key: publicKeyPem,
        padding: constants.RSA_PKCS1_PADDING,
      },
      Buffer.from(payloadJSON)
    );

    const encryptedBase64 = encryptedBuffer.toString("base64");
    res.status(200).json({ encrypted: encryptedBase64 });
  } catch (err) {
    console.error("rsa-encrypt error:", err);
    res.status(500).json({ error: err.message });
  }
}
