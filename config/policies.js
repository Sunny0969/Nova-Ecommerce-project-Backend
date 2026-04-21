/**
 * Store policies used by the chatbot.
 * You can customize these and redeploy without changing code logic.
 */

module.exports = {
  shippingPolicy: `
Shipping policy (Nova Shop)
- Standard delivery: typically 3–5 business days (timing may vary by location).
- Express delivery: typically 1–2 business days where available.
- Shipping fees and free-shipping thresholds are shown at checkout.
- Tracking details are provided when your order ships (if supported by carrier).
`.trim(),

  returnPolicy: `
Return & refund policy (Nova Shop)
- Returns accepted within 30 days of delivery for unused items in original condition/packaging.
- Some items may be non-returnable for hygiene/safety reasons (if noted on the product page).
- Refunds are issued to the original payment method after inspection/approval.
- If your item arrives damaged or incorrect, contact support with your order ID and photos.
`.trim()
};

