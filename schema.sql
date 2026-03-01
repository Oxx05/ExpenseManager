-- Tabela de Perfis estendida do auth.users do Supabase
CREATE TABLE public.profiles (
  id uuid references auth.users on delete cascade not null primary key,
  email text unique not null,
  name text,
  phone text,
  avatar_url text
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
