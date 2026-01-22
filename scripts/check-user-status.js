
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkUsers() {
    console.log('Checking user profiles...');
    const { data: profiles, error } = await supabase
        .from('profiles')
        .select('email, is_premium, id');

    if (error) {
        console.error('Error fetching profiles:', error);
        return;
    }

    if (profiles.length === 0) {
        console.log('No profiles found.');
    } else {
        console.table(profiles.map(p => ({
            email: p.email,
            is_premium: p.is_premium,
            id: p.id
        })));
    }
}

checkUsers();
