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

    console.log('[Webhook] Received request');
    console.log('[Webhook] Env check:', {
        hasStripeKey: !!process.env.STRIPE_SECRET_KEY,
        hasWebhookSecret: !!webhookSecret,
        hasSupabaseUrl: !!process.env.SUPABASE_URL,
        hasServiceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY
    });

    try {
        event = stripe.webhooks.constructEvent(buf, sig, webhookSecret);
        console.log('[Webhook] Event verified:', event.type);
    } catch (err) {
        console.error(`[Webhook] Signature verification FAILED: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const userId = session.client_reference_id;
        const subscriptionId = session.subscription;

        console.log('[Webhook] checkout.session.completed:', { userId, subscriptionId, customer: session.customer });

        if (userId && subscriptionId) {
            // Fetch subscription details from Stripe
            const subscription = await stripe.subscriptions.retrieve(subscriptionId);
            const plan = subscription.items.data[0].plan;

            console.log('[Webhook] Updating Supabase for user:', userId, 'plan:', plan.interval, 'period_end:', subscription.current_period_end);

            const periodEnd = subscription.current_period_end
                ? new Date(subscription.current_period_end * 1000).toISOString()
                : null;

            // Upgrade user to PRO in Supabase (upsert: creates row if missing)
            const { data: updateData, error, count } = await supabase
                .from('subscriptions')
                .upsert({
                    user_id: userId,
                    is_pro: true,
                    stripe_customer_id: session.customer,
                    stripe_subscription_id: subscriptionId,
                    plan_interval: plan.interval, // 'month' or 'year'
                    current_period_end: periodEnd,
                    cancel_at_period_end: subscription.cancel_at_period_end,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'user_id' });

            if (error) {
                console.error('[Webhook] Supabase update FAILED:', error);
                return res.status(500).json({ error: 'Database update failed' });
            }
            console.log(`[Webhook] SUCCESS — upgraded user ${userId} to PRO (${plan.interval})`);
        } else {
            console.warn('[Webhook] Missing userId or subscriptionId:', { userId, subscriptionId });
        }
    } else if (event.type === 'customer.subscription.updated') {
        const subscription = event.data.object;
        const plan = subscription.items.data[0].plan;

        // Keep Supabase in sync when subscription changes (e.g. renewal, cancellation toggled)
        const { error } = await supabase
            .from('subscriptions')
            .update({
                is_pro: subscription.status === 'active' || subscription.status === 'trialing',
                plan_interval: plan.interval,
                current_period_end: subscription.current_period_end
                    ? new Date(subscription.current_period_end * 1000).toISOString()
                    : null,
                cancel_at_period_end: subscription.cancel_at_period_end,
                updated_at: new Date().toISOString()
            })
            .eq('stripe_subscription_id', subscription.id);

        if (error) console.error('Update error:', error);
    } else if (event.type === 'customer.subscription.deleted') {
        // Se a pessoa cancelar a subscrição, tiramos o Pro
        const subscription = event.data.object;
        const { error } = await supabase
            .from('subscriptions')
            .update({
                is_pro: false,
                cancel_at_period_end: false,
                updated_at: new Date().toISOString()
            })
            .eq('stripe_subscription_id', subscription.id);
        if (error) console.error('Downgrade error:', error);
    }

    // Return a 200 response to acknowledge receipt of the event
    res.json({ received: true });
}
