import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../.env') });

async function checkSupabase() {
    console.log('Testing Supabase Admin connection...');

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        console.error('❌ Missing Supabase env vars');
        return;
    }

    const supabaseAdmin = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const testUserId = "50e4d3d8-7662-4215-ac67-e7dd3e5e92f7"; // ID from user's payload

    try {
        // 1. Try to fetch the user profile
        console.log(`Checking if profile exists for ${testUserId}...`);
        const { data: profile, error: fetchError } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', testUserId)
            .single();

        if (fetchError) {
            console.error('❌ Fetch Error:', fetchError);
        } else {
            console.log('✅ Profile found:', profile);
        }

        // 2. Try to update the user profile
        console.log('Attempting update (is_premium: true)...');
        const { data: updateData, error: updateError } = await supabaseAdmin
            .from('profiles')
            .update({ is_premium: true })
            .eq('id', testUserId)
            .select(); // Add select() to verify return

        if (updateError) {
            console.error('❌ Update Error:', updateError);
        } else {
            console.log('✅ Update Success:', updateData);
        }

    } catch (err) {
        console.error('❌ Unexpected Exception:', err);
    }
}

checkSupabase();
