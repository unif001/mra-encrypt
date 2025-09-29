// api/mra-process.js
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    console.log("=== MRA eInvoice Process Started ===");

    const { invoice_id, invoice_number, invoice_data } = req.body;

    if (!invoice_id || !invoice_number || !invoice_data) {
      return res.status(400).json({
        status: "ERROR",
        message:
          "Missing required fields: invoice_id, invoice_number, invoice_data",
      });
    }

    // 🔹 Config
    const MRA_USERNAME = "Electrum";
    const MRA_PASSWORD = "Electrum@2025mra";
    const EBS_MRA_ID = "17532654219210HODNOBG13W";
    const AREA_CODE = "721";
    const BASE_URL =
      process.env.BASE_URL || "https://mra-encrypt-omega.vercel.app";

    const RSA_URL = `${BASE_URL}/api/rsa-encrypt`;
    const AES_URL = `${BASE_URL}/api/generate-aes`;
    const DECRYPT_URL = `${BASE_URL}/api/decrypt-aes`;
    const ENCRYPT_INV = `${BASE_URL}/api/encrypt-invoice`;

    const TOKEN_URL =
      "https://vfisc.mra.mu/einvoice-token-service/token-api/generate-token";
    const TRANSMIT_URL = "https://vfisc.mra.mu/realtime/invoice/transmit";

    // ========================
    // 🔹 STEP 0: MAP ZOHO → MRA
    // ========================

    const mraInvoice = {
      invoiceCounter: invoice_id,
      invoiceIdentifier: `INV-${invoice_number}`,
      transactionType: "B2C",
      personType: "VATR",
      invoiceTypeDesc: "STD",
      currency: invoice_data.currency_code || "MUR",
      invoiceRefIdentifier: "",
      previousNoteHash: "0",
      totalVatAmount: invoice_data.tax_total || "0.00",
      totalAmtWoVatCur: invoice_data.sub_total || "0.00",
      totalAmtWoVatMur: invoice_data.sub_total || "0.00",
      invoiceTotal: invoice_data.total || "0.00",
      discountTotalAmount: invoice_data.discount || "0.00",
      totalAmtPaid: invoice_data.total || "0.00",
      dateTimeInvoiceIssued: (invoice_data.date ||
        new Date().toISOString().substring(0, 19)
      ).replace("T", " "),
      seller: {
        name: "Electrum Mauritius Limited",
        tradeName: "Electrum Mauritius Limited",
        tan: "27124193",
        brn: "C11106429",
        businessAddr: "Mauritius",
        businessPhoneNo: "2302909090",
        ebsCounterNo: "", // ✅ leave blank (not EBS_MRA_ID)
        cashierId: "SYSTEM",
      },
      buyer: {
        name: invoice_data.customer_name || "Unknown Customer",
        tan: "", // optional, map from custom field if exists
        brn: "",
        businessAddr: invoice_data.billing_address?.address || "",
        buyerType: "VATR",
        nic: "",
      },
      itemList: (invoice_data.line_items || []).map((item, idx) => {
        let taxAmt = 0;
        let taxCode = "TC02"; // default non-VAT
        if (item.line_item_taxes && item.line_item_taxes.length > 0) {
          taxAmt = item.line_item_taxes[0].tax_amount || 0;
          if (
            (item.line_item_taxes[0].tax_name || "")
              .toUpperCase()
              .includes("VAT")
          ) {
            taxCode = "TC01";
          }
        }
        return {
          itemNo: (idx + 1).toString(),
          nature: "GOODS",
          productCodeMra: "",
          productCodeOwn: item.item_id || "",
          itemDesc: item.name || "",
          quantity: String(item.quantity || "1"),
          unitPrice: String(item.rate || "0.00"),
          amtWoVatCur: String(item.item_total || "0.00"),
          amtWoVatMur: String(item.item_total || "0.00"),
          vatAmt: String(taxAmt),
          taxCode: taxCode,
          totalPrice: String((item.item_total || 0) + taxAmt),
          discount: String(item.discount_amount || "0"),
          discountedValue: String(item.item_total || "0.00"),
          currency: invoice_data.currency_code || "MUR",
        };
      }),
      salesTransactions: "CASH",
    };

    console.log("Mapped MRA Invoice JSON:", JSON.stringify(mraInvoice));

    // ========================
    // 🔹 STEP 1: AES
    // ========================
    const aesResp = await fetch(AES_URL, { method: "GET" });
    const aesData = await aesResp.json();
    if (!aesData.aesKey) throw new Error("AES key generation failed");
    const aesKey = aesData.aesKey;

    // 🔹 Step 2: RSA
    const rsaResp = await fetch(RSA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payload: {
          username: MRA_USERNAME,
          password: MRA_PASSWORD,
          encryptKey: aesKey,
          refreshToken: "false",
        },
      }),
    });
    const rsaData = await rsaResp.json();
    if (!rsaData.encrypted) throw new Error("RSA encryption failed");

    // 🔹 Step 3: Token
    const tokenResp = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        username: MRA_USERNAME,
        ebsMraId: EBS_MRA_ID,
        areaCode: AREA_CODE,
      },
      body: JSON.stringify({
        requestId: `INV-${invoice_number}`,
        payload: rsaData.encrypted,
      }),
    });
    const tokenData = await tokenResp.json();
    if (!tokenData.token) throw new Error("Token generation failed");
    const token = tokenData.token;
    const encKey = tokenData.key;

    // 🔹 Step 4: Decrypt AES
    const decResp = await fetch(DECRYPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        encryptedKey: encKey,
        aesKey: aesKey,
      }),
    });
    const decData = await decResp.json();
    if (!decData.decryptedKey) throw new Error("AES decryption failed");
    const finalAES = decData.decryptedKey;

    // 🔹 Step 5: Encrypt Invoice
    const encInvoiceResp = await fetch(ENCRYPT_INV, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plainText: JSON.stringify([mraInvoice]), // must be array like in curl
        aesKey: finalAES,
      }),
    });
    const encInvoiceData = await encInvoiceResp.json();
    if (!encInvoiceData.encryptedText)
      throw new Error("Invoice encryption failed");

    // 🔹 Step 6: Transmit
    const formatDateTimeForMRA = () => {
      const now = new Date();
      const yyyy = now.getFullYear();
      const MM = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      const HH = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      return `${yyyy}-${MM}-${dd} ${HH}:${mm}`; // ✅ no seconds
    };

    const transmitResp = await fetch(TRANSMIT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        username: MRA_USERNAME,
        ebsMraId: EBS_MRA_ID,
        areaCode: AREA_CODE,
        token: token,
      },
      body: JSON.stringify({
        requestId: `INV-${invoice_number}`,
        requestDateTime: formatDateTimeForMRA(), // ✅ fixed format
        signedHash: "",
        encryptedInvoice: encInvoiceData.encryptedText,
      }),
    });
    const transmitData = await transmitResp.json();

    // IRN extraction
    let irn = "";
    if (
      transmitData.fiscalisedInvoices &&
      transmitData.fiscalisedInvoices.length > 0
    ) {
      irn = transmitData.fiscalisedInvoices[0].irn || "";
    }

    return res.status(200).json({
      status: "SUCCESS",
      IRN: irn,
      transmit_response: transmitData,
      preview_json: mraInvoice,
    });
  } catch (err) {
    console.error("MRA Process Error:", err);
    return res.status(500).json({
      status: "ERROR",
      message: err.message,
    });
  }
}
