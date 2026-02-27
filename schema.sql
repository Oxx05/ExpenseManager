-- Tabela de Perfis estendida do auth.users do Supabase
CREATE TABLE public.profiles (
  id uuid references auth.users on delete cascade not null primary key,
  email text unique not null,
  name text
);

-- Habilitar RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public profiles are viewable by everyone." ON profiles FOR SELECT USING (true);
CREATE POLICY "Users can insert their own profile." ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile." ON profiles FOR UPDATE USING (auth.uid() = id);

-- Trigger para criar perfil automaticamente no SignUp
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name)
  VALUES (new.id, new.email, split_part(new.email, '@', 1));
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
  created_by uuid references public.profiles(id) not null
);
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can create groups" ON public.groups FOR INSERT WITH CHECK (auth.uid() = created_by);

-- 2. Membros dos Grupos
CREATE TABLE public.group_members (
  group_id uuid references public.groups(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  joined_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (group_id, user_id)
);
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view group members" ON public.group_members FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.group_id = group_members.group_id AND gm.user_id = auth.uid())
);
CREATE POLICY "Users can join groups" ON public.group_members FOR INSERT WITH CHECK (auth.uid() = user_id OR EXISTS (
  SELECT 1 FROM public.groups g WHERE g.id = group_id AND g.created_by = auth.uid()
));

-- 1.1 Agora que group_members existe, adicionamos a policy de SELECT aos grupos
CREATE POLICY "Members can view groups" ON public.groups FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.group_members WHERE group_id = groups.id AND user_id = auth.uid()) OR created_by = auth.uid()
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
  EXISTS (SELECT 1 FROM public.group_members WHERE group_id = group_expenses.group_id AND user_id = auth.uid())
);
CREATE POLICY "Members can insert expenses" ON public.group_expenses FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.group_members WHERE group_id = group_expenses.group_id AND user_id = auth.uid())
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
    SELECT 1 FROM public.group_members m 
    JOIN public.group_expenses e ON e.group_id = m.group_id
    WHERE e.id = expense_splits.expense_id AND m.user_id = auth.uid()
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
  EXISTS (SELECT 1 FROM public.group_members WHERE group_id = debts.group_id AND user_id = auth.uid())
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
