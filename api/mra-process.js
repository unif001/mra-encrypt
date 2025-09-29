// api/mra-process.js
import fetch from "node-fetch";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Only POST allowed" });
    }

    const { invoice_id, invoice_number, invoice_data } = req.body;

    if (!invoice_id || !invoice_data) {
      return res.status(400).json({ error: "Missing invoice_id or invoice_data" });
    }

    // 🔹 1. Parse invoice_data from Zoho
    let zohoInvoice;
    try {
      zohoInvoice = JSON.parse(invoice_data);
    } catch (err) {
      return res.status(400).json({ error: "Invalid JSON in invoice_data", details: err.message });
    }

    // 🔹 2. Map Zoho fields to MRA JSON structure
    const seller = {
      name: "Electrum Mauritius Limited",
      tradeName: "Electrum Mauritius Limited",
      tan: "27124193",
      brn: "C11106429",
      businessAddr: "Mauritius",
      businessPhoneNo: "2302909090",
      ebsCounterNo: "17532654219210HODNOBG13W",
      cashierId: "SYSTEM",
    };

    const buyer = {
      name: zohoInvoice.customer_name || "",
      tan: "", // can map cf_tan later
      brn: "", // can map cf_brn later
      businessAddr: "",
      buyerType: "VATR",
      nic: "",
    };

    // 🔹 3. Items
    let itemList = [];
    try {
      const lineItems = JSON.parse(zohoInvoice.line_items);
      itemList = lineItems.map((li, index) => {
        const tax = (li.line_item_taxes && li.line_item_taxes[0]) || {};
        return {
          itemNo: (index + 1).toString(),
          nature: "GOODS",
          productCodeMra: "",
          productCodeOwn: li.item_id || "",
          itemDesc: li.name || "",
          quantity: li.quantity?.toString() || "1",
          currency: zohoInvoice.currency_code || "MUR",
          unitPrice: li.rate?.toString() || "0",
          amtWoVatCur: li.item_total?.toString() || "0",
          amtWoVatMur: li.item_total?.toString() || "0",
          vatAmt: (tax.tax_amount || 0).toString(),
          taxCode: tax.tax_name?.toUpperCase().includes("VAT") ? "TC01" : "TC02",
          totalPrice: (li.item_total + (tax.tax_amount || 0)).toString(),
          discount: "0",
          discountedValue: "0",
        };
      });
    } catch (err) {
      console.error("Line item parse error:", err);
    }

    // 🔹 4. Build invoice JSON (as per working Test Case 1)
    const invoiceJSON = [{
      invoiceCounter: invoice_id,
      transactionType: "B2C",
      personType: "VATR",
      invoiceTypeDesc: "STD",
      currency: zohoInvoice.currency_code || "MUR",
      invoiceIdentifier: "INV-" + invoice_number,
      invoiceRefIdentifier: "",
      previousNoteHash: "0",
      totalVatAmount: zohoInvoice.tax_total?.toString() || "0",
      totalAmtWoVatCur: zohoInvoice.sub_total?.toString() || "0",
      totalAmtWoVatMur: zohoInvoice.sub_total?.toString() || "0",
      invoiceTotal: zohoInvoice.total?.toString() || "0",
      discountTotalAmount: zohoInvoice.discount?.toString() || "0",
      totalAmtPaid: zohoInvoice.total?.toString() || "0",
      dateTimeInvoiceIssued: new Date().toISOString().replace("T"," ").substring(0,19),
      seller,
      buyer,
      itemList,
      salesTransactions: "CASH",
    }];

    // 🔹 5. AES Key
    const aesResp = await fetch("https://mra-encrypt-omega.vercel.app/api/generate-aes");
    const { aesKey } = await aesResp.json();

    // 🔹 6. RSA Encrypt AES
    const rsaResp = await fetch("https://mra-encrypt-omega.vercel.app/api/rsa-encrypt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Electrum",
        password: "Electrum@2025mra",
        encryptKey: aesKey,
        refreshToken: "false"
      })
    });
    const { encrypted } = await rsaResp.json();

    // 🔹 7. Generate Token
    const tokenResp = await fetch("https://vfisc.mra.mu/einvoice-token-service/token-api/generate-token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "username": "Electrum",
        "ebsMraId": "17532654219210HODNOBG13W",
        "areaCode": "721"
      },
      body: JSON.stringify({ requestId: "INV-" + invoice_number, payload: encrypted })
    });
    const tokenData = await tokenResp.json();

    const token = tokenData.token;
    const encKey = tokenData.key;

    // 🔹 8. Decrypt AES
    const decResp = await fetch("https://mra-encrypt-omega.vercel.app/api/decrypt-aes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ encryptedKey: encKey, aesKey })
    });
    const { decryptedKey } = await decResp.json();

    // 🔹 9. Encrypt Invoice
    const encInvoiceResp = await fetch("https://mra-encrypt-omega.vercel.app/api/encrypt-invoice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plainText: JSON.stringify(invoiceJSON), aesKey: decryptedKey })
    });
    const { encryptedText } = await encInvoiceResp.json();

    // 🔹 10. Transmit
    const transmitResp = await fetch("https://vfisc.mra.mu/realtime/invoice/transmit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "username": "Electrum",
        "ebsMraId": "17532654219210HODNOBG13W",
        "areaCode": "721",
        "token": token
      },
      body: JSON.stringify({
        requestId: "INV-" + invoice_number,
        requestDateTime: new Date().toISOString().replace("T"," ").substring(0,19),
        signedHash: "",
        encryptedInvoice: encryptedText
      })
    });
    const transmitData = await transmitResp.json();

    return res.status(200).json({
      status: "SUCCESS",
      invoice_id,
      invoice_number,
      invoice_json_preview: invoiceJSON,
      transmit_response: transmitData
    });

  } catch (err) {
    console.error("MRA Process Error:", err);
    return res.status(500).json({ error: "Internal Server Error", details: err.message });
  }
}
