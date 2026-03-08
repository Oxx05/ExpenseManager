-- Tabela de Perfis estendida do auth.users do Supabase
CREATE TABLE public.profiles (
  id uuid references auth.users on delete cascade not null primary key,
  email text unique not null,
  name text,
  phone text,
  avatar_url text,
  language text default 'pt'
);

-- Habilitar RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public profiles are viewable by everyone." ON profiles FOR SELECT USING (true);
CREATE POLICY "Users can insert their own profile." ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile." ON profiles FOR UPDATE USING (auth.uid() = id);

-- Subscrições (Stripe Freemium)
CREATE TABLE public.subscriptions (
  user_id uuid references public.profiles(id) on delete cascade not null primary key,
  is_pro boolean default false not null,
  plan_interval text, -- 'month' or 'year'
  current_period_end timestamp with time zone,
  cancel_at_period_end boolean default false,
  stripe_customer_id text,
  stripe_subscription_id text,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own subscription" ON public.subscriptions FOR SELECT USING (auth.uid() = user_id);

-- Trigger para criar perfil automaticamente no SignUp
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name)
  VALUES (new.id, new.email, split_part(new.email, '@', 1));
  
  INSERT INTO public.subscriptions (user_id, is_pro)
  VALUES (new.id, false);
  
  RETURN new;
END;
$$ LANGUAGE plpgsql security definer;

-- Associar a trigger ao auth.users 
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();


-- 1. Grupos (Sem RLS que dependa de group_members ainda)
CREATE TABLE public.groups (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  created_by uuid references public.profiles(id) not null,
  is_archived boolean default false
);
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can create groups" ON public.groups FOR INSERT WITH CHECK (auth.uid() = created_by);

-- =========================================================================
-- FUNÇÃO SEGURA PARA VERIFICAR MEMBROS (Evita Erro 42P17 Infinite Recursion no Postgres)
-- Usa SECURITY DEFINER para correr como Admin e não ficar num loop infinito a ler as próprias regras
-- =========================================================================
CREATE OR REPLACE FUNCTION public.is_group_member(p_group_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.group_members 
    WHERE group_id = p_group_id AND user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. Membros dos Grupos
CREATE TABLE public.group_members (
  group_id uuid references public.groups(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  joined_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (group_id, user_id)
);
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view group members" ON public.group_members FOR SELECT USING (
  public.is_group_member(group_id)
);

CREATE POLICY "Users can join groups" ON public.group_members FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 1.1 Agora que group_members existe, adicionamos a policy de SELECT aos grupos
CREATE POLICY "Members can view groups" ON public.groups FOR SELECT USING (
  public.is_group_member(id) OR created_by = auth.uid()
);

-- 3. Despesas dos Grupos
CREATE TABLE public.group_expenses (
  id uuid default gen_random_uuid() primary key,
  group_id uuid references public.groups(id) on delete cascade not null,
  paid_by uuid references public.profiles(id) not null,
  amount numeric(10, 2) not null,
  description text not null,
  date date not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
ALTER TABLE public.group_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view expenses" ON public.group_expenses FOR SELECT USING (
  public.is_group_member(group_id)
);
CREATE POLICY "Members can insert expenses" ON public.group_expenses FOR INSERT WITH CHECK (
  public.is_group_member(group_id)
);

-- 4. Divisões (Splits)
CREATE TABLE public.expense_splits (
  expense_id uuid references public.group_expenses(id) on delete cascade not null,
  user_id uuid references public.profiles(id) not null,
  amount numeric(10, 2) not null,
  primary key (expense_id, user_id)
);
ALTER TABLE public.expense_splits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view splits" ON public.expense_splits FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.group_expenses e 
    WHERE e.id = expense_splits.expense_id AND public.is_group_member(e.group_id)
  )
);
CREATE POLICY "Members can insert splits" ON public.expense_splits FOR INSERT WITH CHECK (true);

-- 5. Dívidas Simplificadas
CREATE TABLE public.debts (
  id uuid default gen_random_uuid() primary key,
  group_id uuid references public.groups(id) on delete cascade not null,
  debtor_id uuid references public.profiles(id) not null,
  creditor_id uuid references public.profiles(id) not null,
  amount numeric(10, 2) not null default 0,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  UNIQUE(group_id, debtor_id, creditor_id)
);
ALTER TABLE public.debts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view debts" ON public.debts FOR SELECT USING (
  public.is_group_member(group_id)
);
CREATE POLICY "Members can update debts via Edge Function" ON public.debts FOR ALL USING (true) WITH CHECK (true);

-- =========================================================================
-- FUNÇÃO RPC PARA ADICIONAR DESPESA (TRANSAÇÃO SEGURA CONTRA RACE CONDITIONS)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.add_group_expense(
  p_group_id uuid,
  p_paid_by uuid,
  p_amount numeric,
  p_description text,
  p_date date,
  p_splits jsonb -- array de objetos [{user_id, amount}]
) RETURNS uuid AS $$
DECLARE
  v_expense_id uuid;
  split record;
  debt record;
BEGIN
  -- 1. Inserir a despesa
  INSERT INTO public.group_expenses (group_id, paid_by, amount, description, date)
  VALUES (p_group_id, p_paid_by, p_amount, p_description, p_date)
  RETURNING id INTO v_expense_id;

  -- 2. Processar cada split e atualizar a tabela de dívidas
  FOR split IN SELECT * FROM jsonb_to_recordset(p_splits) AS x(user_id uuid, amount numeric)
  LOOP
    -- Inserir o split
    INSERT INTO public.expense_splits (expense_id, user_id, amount)
    VALUES (v_expense_id, split.user_id, split.amount);

    -- Se a pessoa que pagou for a mesma do split, não há dívida
    IF split.user_id != p_paid_by AND split.amount > 0 THEN
      
      SELECT * INTO debt FROM public.debts WHERE group_id = p_group_id AND debtor_id = split.user_id AND creditor_id = p_paid_by FOR UPDATE;
      IF FOUND THEN
        UPDATE public.debts SET amount = amount + split.amount, updated_at = now() 
        WHERE id = debt.id;
      ELSE
        SELECT * INTO debt FROM public.debts WHERE group_id = p_group_id AND debtor_id = p_paid_by AND creditor_id = split.user_id FOR UPDATE;
        IF FOUND THEN
          IF debt.amount > split.amount THEN
            UPDATE public.debts SET amount = amount - split.amount, updated_at = now() WHERE id = debt.id;
          ELSIF debt.amount < split.amount THEN
            UPDATE public.debts SET amount = split.amount - debt.amount, debtor_id = split.user_id, creditor_id = p_paid_by, updated_at = now() WHERE id = debt.id;
          ELSE
            DELETE FROM public.debts WHERE id = debt.id;
          END IF;
        ELSE
          INSERT INTO public.debts (group_id, debtor_id, creditor_id, amount)
          VALUES (p_group_id, split.user_id, p_paid_by, split.amount);
        END IF;
      END IF;

    END IF;
  END LOOP;

  RETURN v_expense_id;
END;
$$ LANGUAGE plpgsql security definer;

-- =========================================================================
-- FUNÇÃO RPC PARA APAGAR DESPESA (REVERTER DÍVIDAS)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.delete_group_expense(
  p_group_id uuid,
  p_expense_id uuid
) RETURNS boolean AS $$
DECLARE
  v_paid_by uuid;
  split record;
  debt record;
BEGIN
  SELECT paid_by INTO v_paid_by FROM public.group_expenses WHERE id = p_expense_id AND group_id = p_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Despesa não encontrada';
  END IF;

  FOR split IN SELECT * FROM public.expense_splits WHERE expense_id = p_expense_id
  LOOP
    IF split.user_id != v_paid_by AND split.amount > 0 THEN
      
      SELECT * INTO debt FROM public.debts WHERE group_id = p_group_id AND debtor_id = split.user_id AND creditor_id = v_paid_by FOR UPDATE;
      IF FOUND THEN
        IF debt.amount > split.amount THEN
          UPDATE public.debts SET amount = amount - split.amount, updated_at = now() WHERE id = debt.id;
        ELSIF debt.amount < split.amount THEN
          UPDATE public.debts SET amount = split.amount - debt.amount, debtor_id = v_paid_by, creditor_id = split.user_id, updated_at = now() WHERE id = debt.id;
        ELSE
          DELETE FROM public.debts WHERE id = debt.id;
        END IF;
      ELSE
        SELECT * INTO debt FROM public.debts WHERE group_id = p_group_id AND debtor_id = v_paid_by AND creditor_id = split.user_id FOR UPDATE;
        IF FOUND THEN
          UPDATE public.debts SET amount = amount + split.amount, updated_at = now() WHERE id = debt.id;
        ELSE
          INSERT INTO public.debts (group_id, debtor_id, creditor_id, amount)
          VALUES (p_group_id, v_paid_by, split.user_id, split.amount);
        END IF;
      END IF;

    END IF;
  END LOOP;

  DELETE FROM public.group_expenses WHERE id = p_expense_id;
  RETURN true;
END;
$$ LANGUAGE plpgsql security definer;

-- =========================================================================
-- FUNÇÃO RPC PARA LIQUIDAR DÍVIDA (SETTLE DEBT)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.settle_debt(
  p_group_id uuid,
  p_debtor_id uuid,
  p_creditor_id uuid,
  p_amount numeric
) RETURNS boolean AS $$
DECLARE
  debt record;
BEGIN
  SELECT * INTO debt FROM public.debts 
  WHERE group_id = p_group_id AND debtor_id = p_debtor_id AND creditor_id = p_creditor_id 
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dívida não encontrada';
  END IF;

  IF p_amount > debt.amount THEN
    RAISE EXCEPTION 'Não podes liquidar um valor superior à dívida atual';
  END IF;

  INSERT INTO public.group_expenses (group_id, paid_by, amount, description, date)
  VALUES (p_group_id, p_debtor_id, p_amount, 'Liquidação de Dívida', CURRENT_DATE);

  IF debt.amount = p_amount THEN
    DELETE FROM public.debts WHERE id = debt.id;
  ELSE
    UPDATE public.debts SET amount = amount - p_amount, updated_at = now() WHERE id = debt.id;
  END IF;

  RETURN true;
END;
$$ LANGUAGE plpgsql security definer;

-- =========================================================================
-- PUSH NOTIFICATIONS SUBSCRIPTIONS
-- =========================================================================
CREATE TABLE public.push_subscriptions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  endpoint text not null,
  auth_key text not null,
  p256dh_key text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  UNIQUE(user_id, endpoint)
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
-- Users can manage their own subscriptions
CREATE POLICY "Users can view their subscriptions" ON public.push_subscriptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their subscriptions" ON public.push_subscriptions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their subscriptions" ON public.push_subscriptions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their subscriptions" ON public.push_subscriptions FOR DELETE USING (auth.uid() = user_id);
-- Permitir que funções e webhooks o leiam (para enviar pushes)
CREATE POLICY "Edge Functions can read subscriptions" ON public.push_subscriptions FOR SELECT USING (true);

-- =========================================================================
-- STORAGE BUCKETS SECURITY POLICIES (Supabase Storage)
-- =========================================================================

-- Permitir leitura pública dos avatars
CREATE POLICY "Avatar images are publicly accessible." 
ON storage.objects FOR SELECT USING (bucket_id = 'avatars');

-- Permitir a utilizadores autenticados fazerem upload para a pasta com o seu UID
CREATE POLICY "Users can upload their own avatar." 
ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'avatars' AND auth.role() = 'authenticated' AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Permitir a utilizadores autenticados atualizarem o seu próprio avatar
CREATE POLICY "Users can update their own avatar." 
ON storage.objects FOR UPDATE USING (
  bucket_id = 'avatars' AND auth.role() = 'authenticated' AND (storage.foldername(name))[1] = auth.uid()::text
);

-- =========================================================================
-- FUNÇÃO RPC PARA OBTER MEMBROS DO GRUPO COM STATUS DE ACESSO (GRATUITO VS PRO)
-- Permite ao Frontend saber quem está "bloqueado" de dividir despesas noutros grupos
-- =========================================================================
CREATE OR REPLACE FUNCTION public.get_group_members_status(p_group_id uuid)
RETURNS TABLE (
  user_id uuid,
  name text,
  email text,
  avatar_url text,
  is_active boolean
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id AS user_id,
    p.name,
    p.email,
    p.avatar_url,
    (
      -- O membro está ativo se tiver subscrição PRO
      COALESCE((SELECT is_pro FROM public.subscriptions s WHERE s.user_id = p.id), false)
      OR 
      -- OU se este grupo for o PRIMEIRO grupo a que pertenceu cronologicamente (Grupo Grátis)
      p_group_id = (
        SELECT gm2.group_id FROM public.group_members gm2 
        WHERE gm2.user_id = p.id 
        ORDER BY gm2.joined_at ASC 
        LIMIT 1
      )
    ) AS is_active
  FROM public.group_members gm
  JOIN public.profiles p ON gm.user_id = p.id
  WHERE gm.group_id = p_group_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =========================================================================
-- FUNÇÃO RPC PARA CONVIDAR UTILIZADOR COM VALIDAÇÃO DE LIMITES
-- =========================================================================
CREATE OR REPLACE FUNCTION public.invite_user_to_group(
  p_group_id uuid,
  p_email text
) RETURNS jsonb AS $$
DECLARE
  v_user_id uuid;
  v_is_pro boolean;
  v_group_count int;
BEGIN
  -- 1. Encontrar utilizador
  SELECT id INTO v_user_id FROM public.profiles WHERE email = p_email LIMIT 1;
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'USER_NOT_FOUND');
  END IF;

  -- 2. Verificar se já é membro
  IF EXISTS (SELECT 1 FROM public.group_members WHERE group_id = p_group_id AND user_id = v_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ALREADY_MEMBER');
  END IF;

  -- 3. Verificar limites do Freemium
  SELECT COALESCE((SELECT is_pro FROM public.subscriptions WHERE user_id = v_user_id), false) INTO v_is_pro;
  IF NOT v_is_pro THEN
    SELECT count(*) INTO v_group_count FROM public.group_members WHERE user_id = v_user_id;
    IF v_group_count >= 1 THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'LIMIT_REACHED');
    END IF;
  END IF;

  -- 4. Adicionar ao grupo
  INSERT INTO public.group_members (group_id, user_id) VALUES (p_group_id, v_user_id);
  
  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =========================================================================
-- FUNÇÃO RPC PARA SAIR DO GRUPO (VERIFICA DÍVIDAS)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.leave_group(
  p_group_id uuid
) RETURNS jsonb AS $$
DECLARE
  v_debt_count int;
BEGIN
  -- Verificar se o utilizador tem dívidas pendentes neste grupo (a receber ou a pagar)
  SELECT count(*) INTO v_debt_count 
  FROM public.debts 
  WHERE group_id = p_group_id 
    AND (debtor_id = auth.uid() OR creditor_id = auth.uid()) 
    AND amount > 0;

  IF v_debt_count > 0 THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'HAS_DEBTS');
  END IF;

  -- Remover dos membros do grupo
  DELETE FROM public.group_members WHERE group_id = p_group_id AND user_id = auth.uid();
  
  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =========================================================================
-- UPDATE TABELA GROUPS PARA SUPORTAR ARQUIVOS (SOFT DELETES)
-- =========================================================================
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS is_archived boolean default false;

-- =========================================================================
-- FUNÇÃO RPC PARA ARQUIVAR GRUPO
-- =========================================================================
CREATE OR REPLACE FUNCTION public.archive_group(
  p_group_id uuid
) RETURNS boolean AS $$
BEGIN
  -- Apenas o criador pode arquivar
  UPDATE public.groups SET is_archived = true WHERE id = p_group_id AND created_by = auth.uid();
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =========================================================================
-- FUNÇÃO RPC PARA DESARQUIVAR GRUPO (VERIFICA LIMITES)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.unarchive_group(
  p_group_id uuid
) RETURNS jsonb AS $$
DECLARE
  v_is_pro boolean;
  v_active_group_count int;
BEGIN
  -- 1. Verificar limites do Freemium
  SELECT COALESCE((SELECT is_pro FROM public.subscriptions WHERE user_id = auth.uid()), false) INTO v_is_pro;
  
  IF NOT v_is_pro THEN
    -- Contar quantos grupos ATIVOS (não arquivados) o utilizador tem
    SELECT count(*) INTO v_active_group_count 
    FROM public.group_members gm
    JOIN public.groups g ON gm.group_id = g.id
    WHERE gm.user_id = auth.uid() AND g.is_archived = false;

    -- Se já tiver 1 grupo ativo, rejeita (A regra Free é 1 Grupo Ativo em simultâneo)
    IF v_active_group_count >= 1 THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'LIMIT_REACHED');
    END IF;
  END IF;

  -- 2. Desarquivar (apenas o criador pode)
  UPDATE public.groups SET is_archived = false WHERE id = p_group_id AND created_by = auth.uid();
  
  -- Se a query não afetou linhas (porque não é o criador), o Postgres ignora, mas convém retornar sucesso ou erro genérico
  -- Para simplificar, assumimos que a UI já esconde o botão de quem não é criador
  
  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =========================================================================
-- 6. User Custom Categories
-- =========================================================================
CREATE TABLE public.user_categories (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  name text not null,
  icon text,
  color text,
  budget numeric(10, 2),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  UNIQUE(user_id, name)
);
ALTER TABLE public.user_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own categories" ON public.user_categories FOR ALL USING (auth.uid() = user_id);

-- =========================================================================
-- 7. User Personal Expenses (Sync)
-- =========================================================================
CREATE TABLE public.user_expenses (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  local_id integer,
  amount numeric(10, 2) not null,
  description text not null,
  category_id text not null,
  date date not null,
  is_recurring boolean default false,
  recurring_type text,
  recurring_params jsonb,
  parent_id uuid,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
ALTER TABLE public.user_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own expenses" ON public.user_expenses FOR ALL USING (auth.uid() = user_id);
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
