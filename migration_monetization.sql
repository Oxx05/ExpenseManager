-- =========================================================================
-- MIGRATION: Monetization & Growth Features
-- Run this in Supabase SQL Editor BEFORE deploying the code changes
-- =========================================================================

-- 1. Add trial, referral, ad rewards, and streak fields to subscriptions
ALTER TABLE public.subscriptions 
  ADD COLUMN IF NOT EXISTS trial_used boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS trial_end timestamp with time zone,
  ADD COLUMN IF NOT EXISTS referral_code text UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS ad_rewards jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS streak_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_login_date date;

-- 2. Referrals tracking table
CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  referrer_id uuid REFERENCES public.profiles(id) NOT NULL,
  referred_id uuid REFERENCES public.profiles(id) NOT NULL,
  status text DEFAULT 'signed_up',
  reward_given boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own referrals" ON public.referrals 
  FOR SELECT USING (auth.uid() = referrer_id OR auth.uid() = referred_id);

-- 3. Update handle_new_user trigger to generate referral code
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name)
  VALUES (new.id, new.email, split_part(new.email, '@', 1));
  
  INSERT INTO public.subscriptions (user_id, is_pro, referral_code)
  VALUES (new.id, false, 'REF-' || upper(substr(new.id::text, 1, 8)));
  
  RETURN new;
END;
$$ LANGUAGE plpgsql security definer;

-- 4. RPC: Activate Trial (server-side validation)
CREATE OR REPLACE FUNCTION public.activate_trial()
RETURNS jsonb AS $$
DECLARE
  v_trial_used boolean;
BEGIN
  SELECT trial_used INTO v_trial_used FROM public.subscriptions WHERE user_id = auth.uid();
  
  IF v_trial_used THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRIAL_ALREADY_USED');
  END IF;

  UPDATE public.subscriptions 
  SET is_pro = true, 
      trial_used = true, 
      trial_end = now() + interval '7 days',
      updated_at = now()
  WHERE user_id = auth.uid();

  RETURN jsonb_build_object('success', true, 'trial_end', (now() + interval '7 days')::text);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. RPC: Check & expire trial on login
CREATE OR REPLACE FUNCTION public.check_trial_status()
RETURNS jsonb AS $$
DECLARE
  v_sub record;
BEGIN
  SELECT * INTO v_sub FROM public.subscriptions WHERE user_id = auth.uid();
  
  IF v_sub IS NULL THEN
    RETURN jsonb_build_object('is_pro', false, 'trial_active', false);
  END IF;

  -- If trial has expired and user has no Stripe subscription, revoke PRO
  IF v_sub.trial_end IS NOT NULL AND v_sub.trial_end < now() 
     AND v_sub.stripe_subscription_id IS NULL THEN
    UPDATE public.subscriptions 
    SET is_pro = false, updated_at = now()
    WHERE user_id = auth.uid();
    
    RETURN jsonb_build_object(
      'is_pro', false, 
      'trial_active', false, 
      'trial_expired', true,
      'trial_used', true
    );
  END IF;

  RETURN jsonb_build_object(
    'is_pro', v_sub.is_pro, 
    'trial_active', v_sub.trial_end IS NOT NULL AND v_sub.trial_end > now() AND v_sub.stripe_subscription_id IS NULL,
    'trial_end', v_sub.trial_end,
    'trial_used', v_sub.trial_used,
    'trial_expired', false
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. RPC: Process Referral on Signup
CREATE OR REPLACE FUNCTION public.process_referral(p_referral_code text)
RETURNS jsonb AS $$
DECLARE
  v_referrer_id uuid;
BEGIN
  -- Find referrer
  SELECT user_id INTO v_referrer_id FROM public.subscriptions WHERE referral_code = p_referral_code;
  IF v_referrer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_CODE');
  END IF;

  -- Don't allow self-referral
  IF v_referrer_id = auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'SELF_REFERRAL');
  END IF;

  -- Check if already referred
  IF EXISTS (SELECT 1 FROM public.referrals WHERE referred_id = auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_REFERRED');
  END IF;

  -- Store referral
  UPDATE public.subscriptions SET referred_by = v_referrer_id WHERE user_id = auth.uid();
  INSERT INTO public.referrals (referrer_id, referred_id) VALUES (v_referrer_id, auth.uid());

  -- Grant 3 days premium to BOTH users
  -- Referrer: extend or start premium
  UPDATE public.subscriptions 
  SET is_pro = true,
      trial_end = GREATEST(COALESCE(trial_end, now()), now()) + interval '3 days',
      updated_at = now()
  WHERE user_id = v_referrer_id AND stripe_subscription_id IS NULL;

  -- Referred user: extend or start premium  
  UPDATE public.subscriptions 
  SET is_pro = true,
      trial_end = GREATEST(COALESCE(trial_end, now()), now()) + interval '3 days',
      updated_at = now()
  WHERE user_id = auth.uid() AND stripe_subscription_id IS NULL;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. RPC: Update Streak
CREATE OR REPLACE FUNCTION public.update_streak()
RETURNS jsonb AS $$
DECLARE
  v_sub record;
  v_today date := current_date;
  v_new_streak integer;
  v_milestone boolean := false;
BEGIN
  SELECT * INTO v_sub FROM public.subscriptions WHERE user_id = auth.uid();
  IF v_sub IS NULL THEN
    RETURN jsonb_build_object('streak', 0, 'milestone', false);
  END IF;

  -- Same day: no change
  IF v_sub.last_login_date = v_today THEN
    RETURN jsonb_build_object('streak', v_sub.streak_count, 'milestone', false);
  END IF;

  -- Consecutive day
  IF v_sub.last_login_date = v_today - 1 THEN
    v_new_streak := v_sub.streak_count + 1;
  ELSE
    v_new_streak := 1;
  END IF;

  -- Check milestones (7, 14, 30 days)
  IF v_new_streak IN (7, 14, 30) THEN
    v_milestone := true;
    -- Grant 1 day premium
    UPDATE public.subscriptions 
    SET is_pro = true,
        trial_end = GREATEST(COALESCE(trial_end, now()), now()) + interval '1 day',
        updated_at = now()
    WHERE user_id = auth.uid() AND stripe_subscription_id IS NULL;
  END IF;

  UPDATE public.subscriptions 
  SET streak_count = v_new_streak, 
      last_login_date = v_today,
      updated_at = now()
  WHERE user_id = auth.uid();

  RETURN jsonb_build_object('streak', v_new_streak, 'milestone', v_milestone);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. RPC: Grant Ad Reward (server-side to prevent cheating)
CREATE OR REPLACE FUNCTION public.grant_ad_reward(p_reward_type text)
RETURNS jsonb AS $$
DECLARE
  v_rewards jsonb;
  v_current_count integer;
BEGIN
  SELECT COALESCE(ad_rewards, '{}') INTO v_rewards FROM public.subscriptions WHERE user_id = auth.uid();

  CASE p_reward_type
    WHEN 'group_expense' THEN
      v_current_count := COALESCE((v_rewards->>'group_expenses_extra')::integer, 0);
      v_rewards := v_rewards || jsonb_build_object('group_expenses_extra', v_current_count + 1);
    WHEN 'export' THEN
      v_current_count := COALESCE((v_rewards->>'exports_this_month')::integer, 0);
      v_rewards := v_rewards || jsonb_build_object('exports_this_month', v_current_count + 1);
    WHEN 'charts_24h' THEN
      v_rewards := v_rewards || jsonb_build_object('charts_until', (now() + interval '24 hours')::text);
    WHEN 'category' THEN
      v_current_count := COALESCE((v_rewards->>'categories_extra')::integer, 0);
      v_rewards := v_rewards || jsonb_build_object('categories_extra', v_current_count + 1);
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_REWARD');
  END CASE;

  UPDATE public.subscriptions SET ad_rewards = v_rewards, updated_at = now() WHERE user_id = auth.uid();
  RETURN jsonb_build_object('success', true, 'rewards', v_rewards);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
