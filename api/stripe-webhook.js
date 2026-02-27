const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

// Create a Supabase client with the SERVICE_ROLE key (bypasses RLS)
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// We need the raw body to verify the Stripe signature
export const config = {
    api: {
        bodyParser: false,
    },
};

async function buffer(readable) {
    const chunks = [];
    for await (const chunk of readable) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks);
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).end('Method Not Allowed');
    }

    const buf = await buffer(req);
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        event = stripe.webhooks.constructEvent(buf, sig, webhookSecret);
    } catch (err) {
        console.error(`Webhook Error: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;

        // This is the user's ID we passed from the frontend
        const userId = session.client_reference_id;
        const customerId = session.customer;
        const subscriptionId = session.subscription;

        if (userId) {
            // Upgrade user to PRO in Supabase
            const { error } = await supabase
                .from('subscriptions')
                .update({
                    is_pro: true,
                    stripe_customer_id: customerId,
                    stripe_subscription_id: subscriptionId,
                    updated_at: new Date().toISOString()
                })
                .eq('user_id', userId);

            if (error) {
                console.error('Error updating Supabase subscription:', error);
                return res.status(500).json({ error: 'Database update failed' });
            }
            console.log(`Successfully upgraded user ${userId} to PRO`);
        }
    } else if (event.type === 'customer.subscription.deleted') {
        // Se a pessoa cancelar a subscrição, tiramos o Pro
        const subscription = event.data.object;
        const { error } = await supabase
            .from('subscriptions')
            .update({
                is_pro: false,
                updated_at: new Date().toISOString()
            })
            .eq('stripe_subscription_id', subscription.id);
        if (error) console.error('Downgrade error:', error);
    }

    // Return a 200 response to acknowledge receipt of the event
    res.json({ received: true });
}
