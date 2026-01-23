import Stripe from 'stripe';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load env vars
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../.env') });

if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    console.error('Error: STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET is missing in .env');
    process.exit(1);
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

const payload = {
    id: 'evt_test_webhook_' + Date.now(),
    object: 'event',
    type: 'checkout.session.completed',
    created: Math.floor(Date.now() / 1000),
    data: {
        object: {
            id: 'cs_test_session_' + Date.now(),
            object: 'checkout.session',
            metadata: {
                userId: 'test_user_id_123'
            },
            customer_email: 'test@example.com',
            payment_status: 'paid'
        }
    }
};

const payloadString = JSON.stringify(payload, null, 2);

const header = stripe.webhooks.generateTestHeaderString({
    payload: payloadString,
    secret: webhookSecret,
});

console.log('🚀 Sending test webhook...');

try {
    const response = await fetch('http://localhost:3000/api/webhook', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Stripe-Signature': header,
        },
        body: payloadString,
    });

    const text = await response.text();
    console.log(`Response status: ${response.status}`);
    console.log(`Response body: ${text}`);

    if (response.status === 200) {
        console.log('✅ Webhook delivered successfully! Check server logs for "User upgraded to Premium".');
    } else {
        console.log('❌ Webhook delivery failed.');
    }
} catch (err) {
    console.error('Error sending webhook:', err);
}
