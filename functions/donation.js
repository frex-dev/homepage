
export async function onRequestPost({ request, env }) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "https://fantomx.pages.dev",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });

  try {
    if (!(request.headers.get("content-type") || "").includes("application/json")) {
      return json({ error: "Expected JSON" }, 415);
    }

    const data = await request.json();

    const allowedMethods = [
      "UPI",
      "Litecoin (LTC)",
      "Solana (SOL)",
      "USDC (Solana)",
      "Polygon (POL)",
      "USDT (Polygon)",
      "Stellar (XLM)",
      "USDC (Stellar)",
    ];

    const method = String(data.method || "").slice(0, 80);
    const amount = String(data.amount || "").slice(0, 40);
    const reference = String(data.reference || "Not provided").slice(0, 150);
    const displayName = String(data.displayName || "Anonymous").slice(0, 80);
    const email = String(data.email || "Not provided").slice(0, 150);
    const message = String(data.message || "No message").slice(0, 500);
    const anonymous = Boolean(data.anonymous);
    const consent = Boolean(data.consent);

    if (!allowedMethods.includes(method)) {
      return json({ error: "Invalid payment method" }, 400);
    }

    if (!amount || !/^[0-9]+(?:\.[0-9]{1,2})?$/.test(amount)) {
      return json({ error: "Invalid amount" }, 400);
    }

    if (!consent) {
      return json({ error: "Consent is required" }, 400);
    }

    if (!env.DISCORD_WEBHOOK_URL) {
      return json({ error: "Notification service is not configured" }, 500);
    }

    const safe = (value) => value.replace(/@/g, "@\u200b");

    const fields = [
      { name: "Payment method", value: safe(method), inline: true },
      { name: "Amount claimed", value: `$${safe(amount)}`, inline: true },
      { name: "Transaction reference", value: safe(reference) },
      {
        name: "Display name",
        value: safe(anonymous ? "Anonymous" : displayName),
        inline: true,
      },
      { name: "Contact email", value: safe(email) },
      { name: "Message", value: safe(message) },
      { name: "Public display consent", value: "Yes", inline: true },
    ];

    const response = await fetch(env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        allowed_mentions: { parse: [] },
        embeds: [{
          title: "New Donation Submission",
          description: "⚠️ Pending verification — this is not proof of payment.",
          color: 0x8b5cf6,
          fields,
          timestamp: new Date().toISOString(),
        }],
      }),
    });

    if (!response.ok) {
      return json({ error: "Could not send notification" }, 502);
    }

    return json({ success: true });
  } catch {
    return json({ error: "Invalid submission or server error" }, 400);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "https://fantomx.pages.dev",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

