// Fonction Netlify : Génère automatiquement une session Stripe Checkout avec le montant exact du panier
exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Méthode non autorisée" }) };
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Clé STRIPE_SECRET_KEY manquante dans les variables d'environnement Netlify."
      })
    };
  }

  try {
    const { items, customerContact, delivery, successUrl, cancelUrl } = JSON.parse(event.body || "{}");

    if (!Array.isArray(items) || items.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: "Panier vide." }) };
    }

    // Informations de livraison saisies sur le site avant le paiement
    const clean = (v, max = 200) => String(v || "").trim().slice(0, max);
    const d = delivery && typeof delivery === "object" ? {
      firstName: clean(delivery.firstName, 80),
      lastName: clean(delivery.lastName, 80),
      email: clean(delivery.email, 200),
      phone: clean(delivery.phone, 30),
      address: clean(delivery.address),
      address2: clean(delivery.address2),
      zip: clean(delivery.zip, 10),
      city: clean(delivery.city, 100),
      notes: clean(delivery.notes, 450)
    } : null;

    const deliveryComplete = d && d.firstName && d.lastName && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)
      && d.phone && d.address && /^[0-9]{5}$/.test(d.zip) && d.city;

    if (!deliveryComplete) {
      return { statusCode: 400, body: JSON.stringify({ error: "Informations de livraison incomplètes." }) };
    }

    const fullName = `${d.firstName} ${d.lastName}`;

    const params = new URLSearchParams();
    params.append("mode", "payment");
    params.append("success_url", successUrl || "https://carreauxdas.net/?payment=success");
    params.append("cancel_url", cancelUrl || "https://carreauxdas.net/?payment=cancel");
    params.append("locale", "fr");
    params.append("billing_address_collection", "auto");
    params.append("customer_email", d.email);

    // Adresse de livraison rattachée au paiement (visible dans le tableau de bord Stripe)
    params.append("payment_intent_data[shipping][name]", fullName);
    params.append("payment_intent_data[shipping][phone]", d.phone);
    params.append("payment_intent_data[shipping][address][line1]", d.address);
    if (d.address2) params.append("payment_intent_data[shipping][address][line2]", d.address2);
    params.append("payment_intent_data[shipping][address][postal_code]", d.zip);
    params.append("payment_intent_data[shipping][address][city]", d.city);
    params.append("payment_intent_data[shipping][address][country]", "FR");

    // Copie dans les métadonnées de la session et du paiement
    const meta = {
      livraison_nom: fullName,
      livraison_email: d.email,
      livraison_telephone: d.phone,
      livraison_adresse: [d.address, d.address2].filter(Boolean).join(", "),
      livraison_code_postal: d.zip,
      livraison_ville: d.city
    };
    if (d.notes) meta.livraison_instructions = d.notes;
    Object.entries(meta).forEach(([k, v]) => {
      params.append(`metadata[${k}]`, v);
      params.append(`payment_intent_data[metadata][${k}]`, v);
    });
    if (customerContact && customerContact !== d.email) {
      params.append("metadata[contact_client]", clean(customerContact));
    }

    items.forEach((item, index) => {
      const amountInCents = Math.round(Number(item.price || 0) * 100);
      if (amountInCents > 0) {
        params.append(`line_items[${index}][price_data][currency]`, "eur");
        params.append(`line_items[${index}][price_data][product_data][name]`, String(item.title || "Carrelage Carreaux Das"));
        if (item.detail) {
          params.append(`line_items[${index}][price_data][product_data][description]`, String(item.detail));
        }
        params.append(`line_items[${index}][price_data][unit_amount]`, String(amountInCents));
        params.append(`line_items[${index}][quantity]`, "1");
      }
    });

    const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    });

    const session = await stripeRes.json();

    if (!stripeRes.ok) {
      return {
        statusCode: stripeRes.status,
        body: JSON.stringify({ error: session.error?.message || "Erreur Stripe" })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || "Erreur serveur interne" })
    };
  }
};
