// Simulate missing env vars
process.env.STRIPE_SECRET_KEY = '';
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';

console.log('Testing app startup with missing env vars...');

try {
    const { default: Stripe } = await import('stripe');
    console.log('Imported Stripe');

    // This should throw
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    console.log('Stripe initialized (unexpected)');

} catch (err) {
    console.log('✅ Caught expected error initializing Stripe:', err.message);
}

try {
    const { createClient } = await import('@supabase/supabase-js');
    console.log('Imported Supabase');

    // This should throw
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    console.log('Supabase initialized (unexpected)');
} catch (err) {
    console.log('✅ Caught expected error initializing Supabase:', err.message);
}
