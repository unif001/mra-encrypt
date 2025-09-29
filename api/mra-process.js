// api/mra-process.js
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ status: "ERROR", message: "Method not allowed (use POST)" });
    }

    console.log("=== MRA eInvoice Process Started ===");

    // Accept invoice_data as object or stringified JSON
    const { invoice_id, invoice_number, invoice_data } = req.body || {};

    if (!invoice_id || !invoice_number || (invoice_data === undefined || invoice_data === null)) {
      return res.status(400).json({
        status: "ERROR",
        message: "Missing required body fields: invoice_id, invoice_number, invoice_data"
      });
    }

    // helper to parse strings which may contain JSON
    const parseMaybeString = (v) => {
      if (v === null || v === undefined) return null;
      if (typeof v === "object") return v;
      if (typeof v === "string") {
        try {
          return JSON.parse(v);
        } catch (e) {
          // not valid JSON string -> return original string
          return v;
        }
      }
      return v;
    };

    // Parse invoice_data if it was sent as a JSON-string
    let invoiceData = parseMaybeString(invoice_data);
    if (!invoiceData || typeof invoiceData !== "object") {
      // invoice_data must be an object after parsing
      return res.status(400).json({
        status: "ERROR",
        message: "invoice_data must be a JSON object (or JSON-string). Received: " + typeof invoice_data
      });
    }

    // ========================
    // REQUIRED FIELD VALIDATION (no fallbacks)
    // ========================
    // 1) Date/time of invoice: require created_time (ISO) or a field that includes time.
    const createdTimeRaw = invoiceData.created_time || invoiceData.date_time || invoiceData.date;
    if (!createdTimeRaw) {
      return res.status(400).json({
        status: "ERROR",
        message: "Missing required invoice date/time. Provide invoice_data.created_time (ISO with time) e.g. 2025-09-15T12:00:00+0400"
      });
    }

    // helper to convert a datetime string (with T and hh:mm:ss) into yyyyMMdd HH:mm:ss
    const toMraDate = (dtStr) => {
      if (!dtStr || typeof dtStr !== "string") {
        throw new Error("Invalid datetime string");
      }
      // Prefer to extract YYYY-MM-DD and HH:MM:SS from ISO-like strings to preserve original local time
      const isoMatch = dtStr.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
      if (isoMatch) {
        return `${isoMatch[1].replace(/-/g, "")} ${isoMatch[2]}`; // yyyyMMdd HH:mm:ss
      }
      // If not ISO-like, attempt Date parse and convert (note: this normalizes timezone)
      const d = new Date(dtStr);
      if (isNaN(d.getTime())) {
        throw new Error("Invalid invoice date/time format. Provide ISO datetime (e.g. 2025-09-15T12:00:00+0400)");
      }
      const pad = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };

    let dateTimeInvoiceIssued;
    try {
      dateTimeInvoiceIssued = toMraDate(createdTimeRaw);
    } catch (err) {
      return res.status(400).json({
        status: "ERROR",
        message: "Invalid invoice date/time: " + err.message
      });
    }

    // 2) line_items must exist and be a non-empty array (Zoho sends as JSON-string)
    const rawLineItems = invoiceData.line_items;
    if (!rawLineItems) {
      return res.status(400).json({
        status: "ERROR",
        message: "Missing required invoice_data.line_items (Zoho returns this as a JSON-string)."
      });
    }
    let lineItemsParsed = parseMaybeString(rawLineItems);
    if (!Array.isArray(lineItemsParsed)) {
      return res.status(400).json({
        status: "ERROR",
        message: "invoice_data.line_items is not a JSON array. Ensure Zoho line_items is passed correctly as JSON or JSON-string."
      });
    }
    if (lineItemsParsed.length === 0) {
      return res.status(400).json({
        status: "ERROR",
        message: "Invoice must contain at least one line item."
      });
    }

    // 3) Buyer required fields: customer_name and custom fields cf_vat and cf_brn (per your note)
    if (!invoiceData.customer_name || typeof invoiceData.customer_name !== "string" || invoiceData.customer_name.trim() === "") {
      return res.status(400).json({
        status: "ERROR",
        message: "Missing required buyer name: invoice_data.customer_name"
      });
    }
    // API custom field names you indicated: cf_vat (TAN) and cf_brn (BRN)
    const buyerTan = invoiceData.cf_vat;
    const buyerBrn = invoiceData.cf_brn;
    if (!buyerTan || !buyerBrn) {
      return res.status(400).json({
        status: "ERROR",
        message: "Missing buyer custom fields: invoice_data.cf_vat (TAN) and/or invoice_data.cf_brn (BRN). These are required — do not leave blank."
      });
    }

    // Parse billing_address if present (Zoho passes this as a JSON-string)
    let billingObj = {};
    if (invoiceData.billing_address) {
      const parsed = parseMaybeString(invoiceData.billing_address);
      if (typeof parsed === "object") billingObj = parsed;
      else billingObj = {};
    }

    // ========================
    // 🔹 Config (unchanged)
    // ========================
    const MRA_USERNAME = "Electrum";
    const MRA_PASSWORD = "Electrum@2025mra";
    const EBS_MRA_ID = "17532654219210HODNOBG13W"; // kept for token header; seller.ebsCounterNo left blank per instruction
    const AREA_CODE = "721";
    const BASE_URL = process.env.BASE_URL || "https://mra-encrypt-omega.vercel.app";

    const RSA_URL = `${BASE_URL}/api/rsa-encrypt`;
    const AES_URL = `${BASE_URL}/api/generate-aes`;
    const DECRYPT_URL = `${BASE_URL}/api/decrypt-aes`;
    const ENCRYPT_INV = `${BASE_URL}/api/encrypt-invoice`;
    const TOKEN_URL = "https://vfisc.mra.mu/einvoice-token-service/token-api/generate-token";
    const TRANSMIT_URL = "https://vfisc.mra.mu/realtime/invoice/transmit";

    // ========================
    // 🔹 MAP ITEMS -> MRA itemList
    // ========================
    const mraItems = lineItemsParsed.map((item, idx) => {
      const qty = Number(item.quantity || item.qty || 1);
      const rate = Number(item.rate || item.unit_price || item.sales_rate || 0);
      const itemTotal = Number(item.item_total != null ? item.item_total : (qty * rate));
      // detect VAT from first tax if present
      let taxAmt = 0;
      let taxCode = "TC02";
      if (item.line_item_taxes && Array.isArray(item.line_item_taxes) && item.line_item_taxes.length > 0) {
        const firstTax = item.line_item_taxes[0];
        taxAmt = Number(firstTax.tax_amount || 0);
        const taxName = (firstTax.tax_name || "").toString().toUpperCase();
        if (taxName.includes("VAT")) taxCode = "TC01";
      }
      return {
        itemNo: String(idx + 1),
        taxCode: taxCode,
        nature: "GOODS",
        currency: invoiceData.currency_code || "MUR",
        itemDesc: item.name || item.item_description || "",
        quantity: String(qty),
        unitPrice: String(Number(rate).toFixed(2)),
        discount: String(item.discount_amount || 0),
        discountedValue: String(Number(item.discounted_value || item.discountedValue || item.item_total || itemTotal).toFixed(2)),
        amtWoVatCur: String(Number(itemTotal).toFixed(2)),
        amtWoVatMur: String(Number(itemTotal).toFixed(2)),
        vatAmt: String(Number(taxAmt).toFixed(2)),
        totalPrice: String(Number(itemTotal + Number(taxAmt)).toFixed(2)),
        productCodeOwn: item.item_id || item.product_code || ""
      };
    });

    // ========================
    // 🔹 BUILD MRA Invoice JSON (no fallbacks for required)
    // ========================
    const mraInvoice = {
      invoiceCounter: String(invoice_id),
      transactionType: "B2C",
      personType: "VATR",
      invoiceTypeDesc: "STD",
      currency: invoiceData.currency_code || "MUR",
      invoiceIdentifier: `INV-${invoice_number}`,
      invoiceRefIdentifier: "",
      previousNoteHash: "0",
      totalVatAmount: String(Number(invoiceData.tax_total || 0).toFixed(2)),
      totalAmtWoVatCur: String(Number(invoiceData.sub_total || 0).toFixed(2)),
      totalAmtWoVatMur: String(Number(invoiceData.sub_total || 0).toFixed(2)),
      invoiceTotal: String(Number(invoiceData.total || 0).toFixed(2)),
      discountTotalAmount: String(Number(invoiceData.discount || 0).toFixed(2)),
      totalAmtPaid: String(Number(invoiceData.total || 0).toFixed(2)),
      dateTimeInvoiceIssued: dateTimeInvoiceIssued, // already validated format yyyyMMdd HH:mm:ss
      seller: {
        name: "Electrum Mauritius Limited",
        tradeName: "Electrum Mauritius Limited",
        tan: "27124193",
        brn: "C11106429",
        businessAddr: "Mauritius",
        businessPhoneNo: "2302909090",
        ebsCounterNo: "", // left blank on purpose per instruction
        cashierId: "SYSTEM"
      },
      buyer: {
        name: invoiceData.customer_name,
        tan: String(buyerTan),
        brn: String(buyerBrn),
        businessAddr: (billingObj && billingObj.address) ? String(billingObj.address) : "",
        buyerType: "VATR",
        nic: invoiceData.nic || ""
      },
      itemList: mraItems,
      salesTransactions: "CASH"
    };

    console.log("Invoice JSON ready for encryption:", JSON.stringify(mraInvoice));

    // ========================
    // 🔹 STEP 1: AES
    // ========================
    console.log("Step 1: requesting AES key from middleware:", AES_URL);
    const aesResp = await fetch(AES_URL, { method: "GET" });
    const aesData = await aesResp.json();
    console.log("AES Response:", JSON.stringify(aesData));
    if (!aesData || !aesData.aesKey) {
      return res.status(500).json({ status: "ERROR", message: "AES generation failed", detail: aesData });
    }
    const aesKey = aesData.aesKey;

    // ========================
    // 🔹 STEP 2: RSA (encrypt AES key)
    // ========================
    console.log("Step 2: RSA encrypt AES key");
    const rsaResp = await fetch(RSA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payload: {
          username: MRA_USERNAME,
          password: MRA_PASSWORD,
          encryptKey: aesKey,
          refreshToken: "false"
        }
      })
    });
    const rsaData = await rsaResp.json();
    console.log("RSA Response:", JSON.stringify(rsaData));
    const rsaEncrypted = rsaData && (rsaData.encrypted || rsaData.encryptedAES || rsaData.encryptedKey || rsaData.encryptedText);
    if (!rsaEncrypted) {
      return res.status(500).json({ status: "ERROR", message: "RSA encryption failed", detail: rsaData });
    }

    // ========================
    // 🔹 STEP 3: Token generation
    // ========================
    console.log("Step 3: Token request to MRA token endpoint");
    // create requestId same as invoiceIdentifier
    const requestId = mraInvoice.invoiceIdentifier;
    const tokenResp = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        username: MRA_USERNAME,
        ebsMraId: EBS_MRA_ID,
        areaCode: AREA_CODE
      },
      body: JSON.stringify({
        requestId: requestId,
        payload: rsaEncrypted
      })
    });
    const tokenData = await tokenResp.json();
    console.log("Token Response:", JSON.stringify(tokenData));
    if (!tokenData || !tokenData.token) {
      return res.status(500).json({ status: "ERROR", message: "Token generation failed", detail: tokenData });
    }
    const token = tokenData.token;
    const encKey = tokenData.key;

    // ========================
    // 🔹 STEP 4: Decrypt AES (middleware)
    // ========================
    console.log("Step 4: Decrypt AES from token response");
    const decResp = await fetch(DECRYPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        encryptedKey: encKey,
        aesKey: aesKey
      })
    });
    const decData = await decResp.json();
    console.log("Decrypt Response:", JSON.stringify(decData));
    const finalAES = decData && (decData.decryptedKey || decData.decrypted || decData.key);
    if (!finalAES) {
      return res.status(500).json({ status: "ERROR", message: "AES decrypt failed", detail: decData });
    }

    // ========================
    // 🔹 STEP 5: Encrypt invoice payload
    // ========================
    console.log("Step 5: Encrypting invoice payload via middleware");
    const encInvoiceResp = await fetch(ENCRYPT_INV, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plainText: JSON.stringify([mraInvoice]), // must be an array in the plainText
        aesKey: finalAES
      })
    });
    const encInvoiceData = await encInvoiceResp.json();
    console.log("Encrypt Invoice Response:", JSON.stringify(encInvoiceData));
    const encryptedInvoice = encInvoiceData && (encInvoiceData.encryptedText || encInvoiceData.encrypted);
    if (!encryptedInvoice) {
      return res.status(500).json({
        status: "ERROR",
        message: "Encrypt-invoice failed (encrypted payload empty)",
        detail: encInvoiceData
      });
    }

    // ========================
    // 🔹 STEP 6: Transmit to MRA
    // ========================
    // requestDateTime must be yyyyMMdd HH:mm:ss (17 chars)
    const pad = (n) => String(n).padStart(2, "0");
    const now = new Date();
    const requestDateTime = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    console.log("Step 6: Transmitting to MRA realtime API. requestDateTime:", requestDateTime);

    const transmitResp = await fetch(TRANSMIT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        username: MRA_USERNAME,
        ebsMraId: EBS_MRA_ID,
        areaCode: AREA_CODE,
        token: token
      },
      body: JSON.stringify({
        requestId: requestId,
        requestDateTime: requestDateTime,
        signedHash: "",
        encryptedInvoice: encryptedInvoice
      })
    });

    const transmitData = await transmitResp.json();
    console.log("Transmit Response:", JSON.stringify(transmitData));

    // Extract IRN if present
    let irn = "";
    if (transmitData && Array.isArray(transmitData.fiscalisedInvoices) && transmitData.fiscalisedInvoices.length > 0) {
      irn = transmitData.fiscalisedInvoices[0].irn || "";
    }

    return res.status(200).json({
      status: "SUCCESS",
      IRN: irn,
      transmit_response: transmitData,
      preview_json: mraInvoice
    });

  } catch (err) {
    console.error("MRA Process Error:", err && (err.stack || err.message || err));
    return res.status(500).json({
      status: "ERROR",
      message: err.message || String(err)
    });
  }
}
