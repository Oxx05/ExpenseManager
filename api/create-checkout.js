const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
    // Vercel CORS headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { userId, email, priceId } = req.body;

        if (!userId || !email) {
            return res.status(400).json({ error: 'Missing userId or email' });
        }

        // Default to monthly plan if no priceId provided
        const selectedPrice = priceId || 'price_1T6FvwCnM4wZXaMWsz4HUgGj';

        const session = await stripe.checkout.sessions.create({
            customer_email: email,
            line_items: [
                {
                    price: selectedPrice,
                    quantity: 1,
                },
            ],
            mode: 'subscription',
            // Defaulting to origin or the Vercel app
            success_url: `${req.headers.origin || 'https://expense-manager-brown-psi.vercel.app'}?checkout=success`,
            cancel_url: `${req.headers.origin || 'https://expense-manager-brown-psi.vercel.app'}?checkout=cancel`,
            // Essential to link the Stripe transaction back to the Supabase database
            client_reference_id: userId,
        });

        res.status(200).json({ url: session.url });
    } catch (err) {
        console.error('Error creating checkout:', err);
        res.status(500).json({ error: err.message });
    }
}
