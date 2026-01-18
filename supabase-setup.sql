-- =============================================
-- SUPABASE SETUP FOR DEBATE ROOM
-- Run this in your Supabase SQL Editor
-- =============================================

-- 1. Create profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT,
  name TEXT,
  is_premium BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create debates table to track all debates
CREATE TABLE IF NOT EXISTS debates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  idea TEXT NOT NULL,
  rounds INTEGER DEFAULT 0,
  advocate_arguments JSONB DEFAULT '[]'::jsonb,
  skeptic_arguments JSONB DEFAULT '[]'::jsonb,
  verdict TEXT,
  winner TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Auto-create profile when user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if exists and recreate
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4. Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE debates ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies for profiles
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- 6. RLS Policies for debates
CREATE POLICY "Users can view own debates"
  ON debates FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own debates"
  ON debates FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own debates"
  ON debates FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own debates"
  ON debates FOR DELETE
  USING (auth.uid() = user_id);

-- 7. Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_debates_user_id ON debates(user_id);
CREATE INDEX IF NOT EXISTS idx_debates_created_at ON debates(created_at DESC);

-- 8. Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER debates_updated_at
  BEFORE UPDATE ON debates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

