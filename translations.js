const translations = {
    pt: {
        // App
        "app_title": "💰 Despesas",
        // Calendar Tab
        "month_total_label": "Total do mês",
        "day_mon": "Seg",
        "day_tue": "Ter",
        "day_wed": "Qua",
        "day_thu": "Qui",
        "day_fri": "Sex",
        "day_sat": "Sáb",
        "day_sun": "Dom",
        // Fab Buttons & Modals
        "add_expense_fab": "Adicionar despesa",
        "add_expense_day": "Adicionar neste dia",
        // Form: Add Expense
        "new_expense_title": "Nova Despesa",
        "edit_expense_title": "Editar Despesa",
        "expense_amount_label": "Valor (€)",
        "expense_desc_label": "Descrição",
        "expense_desc_placeholder": "Ex: Supermercado",
        "expense_date_label": "Data",
        "expense_cat_label": "Categoria",
        "expense_recurring_label": "Despesa recorrente",
        // Form: Recurring Config
        "rec_daily": "Diário",
        "rec_weekly": "Semanal",
        "rec_monthly": "Mensal",
        "rec_yearly": "Anual",
        "week_days": "Dias da semana",
        "monthly_type": "Tipo mensal",
        "always_on_day": "Sempre no dia",
        "first_week": "Primeira", "second_week": "Segunda", "third_week": "Terceira", "fourth_week": "Quarta", "fifth_week": "Quinta",
        "monday": "Segunda", "tuesday": "Terça", "wednesday": "Quarta", "thursday": "Quinta", "friday": "Sexta", "saturday": "Sábado", "sunday": "Domingo",
        "yearly_type": "Tipo anual",
        "fixed_date": "Data fixa (dia",
        "of_month": "de",
        "jan": "Janeiro", "feb": "Fevereiro", "mar": "Março", "apr": "Abril", "may": "Maio", "jun": "Junho", "jul": "Julho", "aug": "Agosto", "sep": "Setembro", "oct": "Outubro", "nov": "Novembro", "dec": "Dezembro",
        // Buttons
        "btn_save": "Guardar",
        "btn_delete": "Eliminar",
        "btn_add": "Adicionar",
        "btn_cancel": "Cancelar",
        "btn_ok": "OK",
        "confirm_title": "Confirmar",
        "btn_invite": "Convidar",
        // Delete Modal
        "delete_expense_title": "Eliminar despesa",
        "delete_recurring_text": "Esta despesa é recorrente. O que queres fazer?",
        "delete_only_this": "Só esta",
        "delete_from_here": "Desta em diante",
        "delete_all": "Todas",
        // Categories Tab
        "categories_title": "Categorias",
        "new_cat_placeholder": "Nova categoria...",
        // Summary Tab
        "summary_title": "Resumo",
        "summary_total": "Total",
        // Groups Tab
        "groups_title": "👥 Grupos",
        "logout_tooltip": "Sair da Conta",
        "restricted_access": "Acesso Restrito",
        "restricted_desc": "Precisas de ter sessão iniciada para usar os Grupos Partilhados.",
        "go_to_account": "Ir para a Conta",
        "my_groups": "Os Meus Grupos",
        "new_group_btn": "Novo Grupo",
        "group_detail_title": "Grupo",
        "tab_expenses": "Despesas",
        "tab_balances": "Saldos & Membros",
        "add_group_expense_fab": "Adicionar Despesa de Grupo",
        "group_members_title": "Membros",
        "invite_placeholder": "Email para convidar...",
        // Group Expense Form
        "new_group_expense_title": "Nova Despesa",
        "group_exp_amount": "Valor Total (€)",
        "group_exp_desc": "Descrição",
        "group_exp_desc_placeholder": "Ex: Jantar de Sábado",
        "group_exp_date": "Data",
        "group_exp_payer": "Quem pagou?",
        "group_exp_splits": "Divisão em partes iguais",
        "btn_save_group_exp": "Guardar Despesa",
        // Account Tab
        "account_title": "👤 Conta",
        "your_account": "A Tua Conta",
        "account_desc": "Inicia sessão para sincronizar os teus grupos e dados partilhados.",
        "email_address": "Endereço de Email",
        "email_placeholder": "exemplo@email.com",
        "send_magic_link": "Enviar Magic Link",
        "btn_logout": "Sair da Conta",
        "profile_name": "Nome",
        "profile_phone": "Telemóvel (opcional)",
        "btn_save_profile": "Guardar Perfil",
        // Export Tab
        "export_title": "Exportar",
        "export_from": "De",
        "export_to": "Até",
        "btn_export_excel": "📥 Exportar Excel (.xlsx)",
        "export_hint": "O ficheiro será descarregado automaticamente.",
        // Bottom Nav
        "nav_calendar": "Calendário",
        "nav_categories": "Categorias",
        "nav_summary": "Resumo",
        "nav_groups": "Grupos",
        "nav_account": "Conta",
        // Paywall
        "pro_title": "Desbloqueia o Premium 🌟",
        "pro_desc": "Passa para a versão PRO e leva a tua gestão de despesas ao máximo nível.",
        "pro_groups": "Grupos Partilhados Ilimitados",
        "pro_categories": "Categorias Personalizadas Ilimitadas",
        "pro_export": "Exportação Pessoal em Excel",
        "btn_upgrade": "Fazer Upgrade por 1,99€/mês",
        "btn_no_thanks": "Não, obrigado",
        "pro_locked_group_alert": "Os teus grupos extra foram bloqueados porque o Premium expirou. Renova para lhes acederes novamente.",
        "pro_locked_badge": "Bloqueado",
        // JS generated
        "js_others": "Outros",
        "js_total": "Total:",
        "js_group_badge": "Grupo",
        "js_confirm_delete": "Eliminar esta despesa?",
        "js_confirm_delete_cat": "Eliminar esta categoria?",
        "js_cat_exists": "Já existe uma categoria com esse nome.",
        "js_you": "Tu",
        "js_owes": "deve a",
        "js_owes_you": "deve-te",
        "js_you_owe": "Deves a",
        "js_settled": "Tudo liquidado",
        "js_settle_btn": "Liquidar",
        "js_no_debts": "Ainda não há dívidas.",
        "js_created_group": "Ainda sem despesas.",
        "js_prompt_group_name": "Nome do novo grupo:",
        "js_err_group_name": "Nome inválido",
        "js_confirm_settle": "Marcar dívida como paga no valor de percebido?",
        "js_loading_groups": "A carregar grupos...",
        "js_no_groups": "Ainda não pertenceste a nenhum grupo.",
        "js_creator": "Criador",
        "js_member": "Membro",
        "js_all_settled_debts": "Tudo saldado! Ninguém deve nada. 🎉",
        "js_someone": "Alguém",
        "js_btn_pay": "Pagar",
        "js_no_group_expenses": "Ainda não há despesas neste grupo.",
        "js_paid_by": "Pago por",
        "js_confirm_settle_debt": "Queres liquidar esta dívida de",
        "js_err_settle": "Erro ao liquidar dívida: ",
        "js_select_dates": "Seleciona as datas de início e fim.",
        "js_no_exp_period": "Sem despesas neste período.",
        "js_sending_link": "A enviar link...",
        "js_error": "Erro:",
        "js_check_email_login": "Verifica o teu email para entrar!",
        "js_new_group_prompt": "Nome do novo grupo:",
        "js_err_create_group": "Erro ao criar grupo",
        "js_err_user_not_found": "Utilizador não registado na aplicação.",
        "js_err_add_member": "Erro ao adicionar membro ou já pertence ao grupo.",
        "js_invalid_expense": "Despesa inválida",
        "js_err_save": "Erro ao guardar:",
        "btn_leave_group": "Sair do Grupo",
        "js_err_leave_debts": "Tens de saldar as tuas dívidas (a pagar ou a receber) antes de sair do grupo.",
        "js_confirm_leave_group": "Tens a certeza que queres sair deste grupo?",
        "js_err_invite_limit": "Este utilizador já atingiu o limite de grupos gratuitos. Ele precisa do Premium para entrar noutro grupo.",
        "js_err_invite_member": "Este utilizador já faz parte do grupo.",
        "js_invite_not_found": "Utilizador não encontrado.\nQueres partilhar um convite da App com ele via WhatsApp ou Email?",
        "js_invite_share_title": "Junta-te a mim no Despesas!",
        "js_invite_share_text": "Criei um grupo partilhado e preciso que entres.",
        "btn_archive_group": "Arquivar Grupo",
        "btn_unarchive_group": "Desarquivar",
        "group_archived_banner": "GRUPO ARQUIVADO (Apenas Leitura)",
        "js_confirm_archive_group": "Tens a certeza que queres arquivar este grupo? Ficará apenas de leitura.",
        "js_confirm_unarchive_group": "Tens a certeza que queres reativar este grupo?",
        "js_err_unarchive_limit": "Atingiste o limite da conta Free. Já tens um grupo Ativo. Transforma-o em Arquivo primeiro ou faz Upgrade para Premium.",
        "modal_create_group_title": "Novo Grupo",
        "modal_create_group_desc": "Dá um nome ao teu grupo partilhado.",
        "modal_create_group_placeholder": "Ex: Casa, Férias, Escritório...",
        "btn_cancel": "Cancelar",
        "btn_create": "Criar",
        "js_free_expense_limit": "Atingiste o limite de 5 despesas de grupo por mês no plano gratuito.",
        "js_exporting": "A exportar...",
        "chart_daily_trend": "Tendência Diária",
        "pro_charts_hint": "Desbloqueia gráficos detalhados com o PRO",
        "budget_placeholder": "Orçamento",
        "pwa_install_title": "Instala a App!",
        "pwa_install_desc": "Acesso rápido e funciona offline.",
        "pwa_install_btn": "Instalar",
        "search_placeholder": "Pesquisar despesas...",
        "search_no_results": "Sem resultados",
        "vs_last_month": "vs mês anterior",
        "no_prev_data": "Sem dados do mês anterior",
        "onboarding_1_title": "Calendário",
        "onboarding_1_desc": "Vê as tuas despesas organizadas por dia. Toca num dia para ver detalhes ou adiciona novas despesas com o botão +.",
        "onboarding_2_title": "Categorias",
        "onboarding_2_desc": "Organiza as tuas despesas por categorias personalizadas. Define orçamentos mensais para controlar os gastos.",
        "onboarding_3_title": "Grupos",
        "onboarding_3_desc": "Partilha despesas com amigos e família. Divide contas automaticamente e vê quem deve o quê.",
        "btn_next": "Seguinte",
        "btn_skip": "Saltar tutorial",
        "btn_start": "Começar! 🚀",
        // Recurring display
        "js_daily": "Diário",
        "js_weekly": "Semanal",
        "js_monthly": "Mensal",
        "js_yearly": "Anual",
        "no_recurring": "Não existem despesas recorrentes ativas.",
        "active_recurring": "Recorrentes Ativas",
        // Sign out
        "confirm_signout_title": "Sair da Conta",
        "confirm_signout_text": "Tens a certeza que queres sair da conta?",
        // Profile
        "js_saving_profile": "A guardar...",
        "js_profile_saved": "Perfil guardado!",
        "js_no_changes": "Sem alterações",
        // Category editing
        "edit_category_title": "Editar Categoria",
        "js_edit_cat": "Editar",
        // Subscription
        "subscription_title": "Subscrição",
        "plan_free": "Plano Gratuito",
        "plan_pro": "Plano Premium",
        "plan_monthly": "Plano Mensal",
        "plan_yearly": "Plano Anual",
        "subscription_active_until": "Ativo até",
        "subscription_cancels_on": "Cancela a",
        "btn_manage_subscription": "Gerir Subscrição",
        "btn_cancel_subscription": "Cancelar Renovação",
        "btn_upgrade_pro": "Fazer Upgrade para PRO",
        "confirm_cancel_sub_title": "Cancelar Renovação",
        "confirm_cancel_sub_text": "A tua subscrição ficará ativa até ao final do período atual, mas não será renovada. Tens a certeza?",
        "plan_toggle_monthly": "Mensal",
        "plan_toggle_yearly": "Anual",
        "plan_save_badge": "POUPA 37%",
        "manage_sub_title": "Gerir Subscrição",
        "manage_sub_desc": "Acede ao portal seguro do Stripe para gerir a tua subscrição PRO.",
        "manage_sub_payment": "Alterar método de pagamento",
        "manage_sub_plan": "Alterar plano (Mensal ↔ Anual)",
        "manage_sub_invoices": "Ver faturas e histórico",
        "manage_sub_cancel": "Cancelar subscrição",
        "manage_sub_open_portal": "Abrir Portal de Gestão",
        "btn_close": "Fechar"
    },
    en: {
        // App
        "app_title": "💰 Expenses",
        // Calendar Tab
        "month_total_label": "Month Total",
        "day_mon": "Mon",
        "day_tue": "Tue",
        "day_wed": "Wed",
        "day_thu": "Thu",
        "day_fri": "Fri",
        "day_sat": "Sat",
        "day_sun": "Sun",
        // Fab Buttons & Modals
        "add_expense_fab": "Add expense",
        "add_expense_day": "Add on this day",
        // Form: Add Expense
        "new_expense_title": "New Expense",
        "edit_expense_title": "Edit Expense",
        "expense_amount_label": "Amount (€)",
        "expense_desc_label": "Description",
        "expense_desc_placeholder": "E.g.: Groceries",
        "expense_date_label": "Date",
        "expense_cat_label": "Category",
        "expense_recurring_label": "Recurring expense",
        // Form: Recurring Config
        "rec_daily": "Daily",
        "rec_weekly": "Weekly",
        "rec_monthly": "Monthly",
        "rec_yearly": "Yearly",
        "week_days": "Days of the week",
        "monthly_type": "Monthly type",
        "always_on_day": "Always on day",
        "first_week": "First", "second_week": "Second", "third_week": "Third", "fourth_week": "Fourth", "fifth_week": "Fifth",
        "monday": "Monday", "tuesday": "Tuesday", "wednesday": "Wednesday", "thursday": "Thursday", "friday": "Friday", "saturday": "Saturday", "sunday": "Sunday",
        "yearly_type": "Yearly type",
        "fixed_date": "Fixed date (day",
        "of_month": "of",
        "jan": "January", "feb": "February", "mar": "March", "apr": "April", "may": "May", "jun": "June", "jul": "July", "aug": "August", "sep": "September", "oct": "October", "nov": "November", "dec": "December",
        // Buttons
        "btn_save": "Save",
        "btn_delete": "Delete",
        "btn_add": "Add",
        "btn_cancel": "Cancel",
        "btn_ok": "OK",
        "confirm_title": "Confirm",
        "btn_invite": "Invite",
        // Delete Modal
        "delete_expense_title": "Delete Expense",
        "delete_recurring_text": "This is a recurring expense. What do you want to do?",
        "delete_only_this": "Only this one",
        "delete_from_here": "This and following",
        "delete_all": "All of them",
        // Categories Tab
        "categories_title": "Categories",
        "new_cat_placeholder": "New category...",
        // Summary Tab
        "summary_title": "Summary",
        "summary_total": "Total",
        // Groups Tab
        "groups_title": "👥 Groups",
        "logout_tooltip": "Sign Out",
        "restricted_access": "Restricted Access",
        "restricted_desc": "You need to be signed in to use Shared Groups.",
        "go_to_account": "Go to Account",
        "my_groups": "My Groups",
        "new_group_btn": "New Group",
        "group_detail_title": "Group",
        "tab_expenses": "Expenses",
        "tab_balances": "Balances & Members",
        "add_group_expense_fab": "Add Group Expense",
        "group_members_title": "Members",
        "invite_placeholder": "Email to invite...",
        // Group Expense Form
        "new_group_expense_title": "New Expense",
        "group_exp_amount": "Total Amount (€)",
        "group_exp_desc": "Description",
        "group_exp_desc_placeholder": "E.g.: Saturday Dinner",
        "group_exp_date": "Date",
        "group_exp_payer": "Who paid?",
        "group_exp_splits": "Split equally",
        "btn_save_group_exp": "Save Expense",
        // Account Tab
        "account_title": "👤 Account",
        "your_account": "Your Account",
        "account_desc": "Sign in to securely sync your groups and shared data.",
        "email_address": "Email Address",
        "email_placeholder": "example@email.com",
        "send_magic_link": "Send Magic Link",
        "btn_logout": "Sign Out",
        "profile_name": "Name",
        "profile_phone": "Phone (optional)",
        "btn_save_profile": "Save Profile",
        // Export Tab
        "export_title": "Export",
        "export_from": "From",
        "export_to": "To",
        "btn_export_excel": "📥 Export Excel (.xlsx)",
        "export_hint": "The file will be downloaded automatically.",
        // Bottom Nav
        "nav_calendar": "Calendar",
        "nav_categories": "Categories",
        "nav_summary": "Summary",
        "nav_groups": "Groups",
        "nav_account": "Account",
        // Paywall
        "pro_title": "Unlock Premium 🌟",
        "pro_desc": "Upgrade to PRO and take your expense management to the highest level.",
        "pro_groups": "Unlimited Shared Groups",
        "pro_categories": "Unlimited Custom Categories",
        "pro_export": "Personal Excel Exports",
        "btn_upgrade": "Upgrade for 1.99€/month",
        "btn_no_thanks": "No, thanks",
        "pro_locked_group_alert": "Your extra groups have been locked because Premium expired. Renew to access them.",
        "pro_locked_badge": "Locked",
        // JS generated
        "js_others": "Others",
        "js_total": "Total:",
        "js_group_badge": "Group",
        "js_confirm_delete": "Delete this expense?",
        "js_confirm_delete_cat": "Delete this category?",
        "js_cat_exists": "A category with this name already exists.",
        "js_you": "You",
        "js_owes": "owes",
        "js_owes_you": "owes you",
        "js_you_owe": "You owe",
        "js_settled": "All settled",
        "js_settle_btn": "Settle",
        "js_no_debts": "No debts yet.",
        "js_created_group": "No expenses yet.",
        "js_prompt_group_name": "New group name:",
        "js_err_group_name": "Invalid name",
        "js_confirm_settle": "Mark debt as paid with the full amount?",
        "js_loading_groups": "Loading groups...",
        "js_no_groups": "You are not part of any group yet.",
        "js_creator": "Creator",
        "js_member": "Member",
        "js_all_settled_debts": "All settled! No one owes anything. 🎉",
        "js_someone": "Someone",
        "js_btn_pay": "Pay",
        "js_no_group_expenses": "No expenses in this group yet.",
        "js_paid_by": "Paid by",
        "js_confirm_settle_debt": "Do you want to settle this debt of",
        "js_err_settle": "Error settling debt: ",
        "js_select_dates": "Please select start and end dates.",
        "js_no_exp_period": "No expenses in this period.",
        "js_sending_link": "Sending link...",
        "js_error": "Error:",
        "js_check_email_login": "Check your email to log in!",
        "js_new_group_prompt": "New group name:",
        "js_err_create_group": "Error creating group",
        "js_err_user_not_found": "User not registered in the application.",
        "js_err_add_member": "Error adding member or already in group.",
        "js_invalid_expense": "Invalid expense",
        "js_err_save": "Error saving:",
        "btn_leave_group": "Leave Group",
        "js_err_leave_debts": "You must settle your debts (pay or receive) before leaving the group.",
        "js_confirm_leave_group": "Are you sure you want to leave this group?",
        "js_err_invite_limit": "This user has reached the free groups limit. They need Premium to join another group.",
        "js_err_invite_member": "This user is already part of the group.",
        "js_invite_not_found": "User not found.\nDo you want to share an App invite with them via WhatsApp or Email?",
        "js_invite_share_title": "Join me on Expenses!",
        "js_invite_share_text": "I created a shared group and need you to join.",
        "btn_archive_group": "Archive Group",
        "btn_unarchive_group": "Unarchive",
        "group_archived_banner": "ARCHIVED GROUP (Read-Only)",
        "js_confirm_archive_group": "Are you sure you want to archive this group? It will become read-only.",
        "js_confirm_unarchive_group": "Are you sure you want to reactivate this group?",
        "js_err_unarchive_limit": "Free tier limit reached. You already have an Active group. Archive it first or Upgrade to Premium.",
        "modal_create_group_title": "New Group",
        "modal_create_group_desc": "Name your shared group.",
        "modal_create_group_placeholder": "E.g. Home, Holiday, Office...",
        "btn_cancel": "Cancel",
        "btn_create": "Create",
        "js_free_expense_limit": "You have reached the limit of 5 group expenses per month on the free plan.",
        "js_exporting": "Exporting...",
        "chart_daily_trend": "Daily Trend",
        "pro_charts_hint": "Unlock detailed charts with PRO",
        "budget_placeholder": "Budget",
        "pwa_install_title": "Install the App!",
        "pwa_install_desc": "Quick access and works offline.",
        "pwa_install_btn": "Install",
        "search_placeholder": "Search expenses...",
        "search_no_results": "No results",
        "vs_last_month": "vs last month",
        "no_prev_data": "No data from last month",
        "onboarding_1_title": "Calendar",
        "onboarding_1_desc": "See your expenses organized by day. Tap a day to see details or add new expenses with the + button.",
        "onboarding_2_title": "Categories",
        "onboarding_2_desc": "Organize your expenses with custom categories. Set monthly budgets to control your spending.",
        "onboarding_3_title": "Groups",
        "onboarding_3_desc": "Share expenses with friends and family. Split bills automatically and see who owes what.",
        "btn_next": "Next",
        "btn_skip": "Skip tutorial",
        "btn_start": "Let's go! 🚀",
        // Recurring display
        "js_daily": "Daily",
        "js_weekly": "Weekly",
        "js_monthly": "Monthly",
        "js_yearly": "Yearly",
        "no_recurring": "No active recurring expenses.",
        "active_recurring": "Active Recurring",
        // Sign out
        "confirm_signout_title": "Sign Out",
        "confirm_signout_text": "Are you sure you want to sign out?",
        // Profile
        "js_saving_profile": "Saving...",
        "js_profile_saved": "Profile saved!",
        "js_no_changes": "No changes",
        // Category editing
        "edit_category_title": "Edit Category",
        "js_edit_cat": "Edit",
        // Subscription
        "subscription_title": "Subscription",
        "plan_free": "Free Plan",
        "plan_pro": "Premium Plan",
        "plan_monthly": "Monthly Plan",
        "plan_yearly": "Yearly Plan",
        "subscription_active_until": "Active until",
        "subscription_cancels_on": "Cancels on",
        "btn_manage_subscription": "Manage Subscription",
        "btn_cancel_subscription": "Cancel Renewal",
        "btn_upgrade_pro": "Upgrade to PRO",
        "confirm_cancel_sub_title": "Cancel Renewal",
        "confirm_cancel_sub_text": "Your subscription will stay active until the end of the current period, but will not renew. Are you sure?",
        "plan_toggle_monthly": "Monthly",
        "plan_toggle_yearly": "Yearly",
        "plan_save_badge": "SAVE 37%",
        "manage_sub_title": "Manage Subscription",
        "manage_sub_desc": "Access the secure Stripe portal to manage your PRO subscription.",
        "manage_sub_payment": "Change payment method",
        "manage_sub_plan": "Switch plan (Monthly ↔ Yearly)",
        "manage_sub_invoices": "View invoices and history",
        "manage_sub_cancel": "Cancel subscription",
        "manage_sub_open_portal": "Open Management Portal",
        "btn_close": "Close"
    }
};

let currentLang = localStorage.getItem('appLang') || (navigator.language.startsWith('pt') ? 'pt' : 'en');

function t(key) {
    if (translations[currentLang] && translations[currentLang][key]) {
        return translations[currentLang][key];
    }
    // Fallback to PT if key is missing in chosen lang
    if (translations['pt'] && translations['pt'][key]) {
        return translations['pt'][key];
    }
    return key;
}

function updateLanguage(lang, executeRenders = true) {
    if (lang) {
        currentLang = lang;
        localStorage.setItem('appLang', lang);

        // Persist to Supabase profile if logged in
        if (typeof supabaseClient !== 'undefined' && typeof currentUser !== 'undefined' && currentUser) {
            supabaseClient.from('profiles').update({ language: lang })
                .eq('id', currentUser.id).then(() => { });
        }
    }

    // Process HTML elements
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');

        // Handling placeholders for inputs
        if (el.tagName === 'INPUT' && el.hasAttribute('placeholder')) {
            el.placeholder = t(key);
        } else if (el.tagName === 'TITLE') {
            // Will update title inside the app later if it has data-i18n
        } else {
            // Because some elements mix text with child elements (like icons), 
            // we have to carefully set textContent, EXCEPT when the HTML contains children. 
            // To be totally safe with icons like <i class="..."></i><text>,
            // we should be careful. Usually, the data-i18n is put inside a span.
            // But if it's direct, let's just do textContent or check if it's text-only.
            el.textContent = t(key);
        }
    });

    // Process title attributes (e.g., tooltips on FABs)
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        el.title = t(key);
    });

    // Re-render JS views that rely on translated names (like calendar and summaries)
    if (executeRenders && window.db && window.db.db) {
        if (typeof renderCalendar === 'function' && document.getElementById('screen-calendar') && document.getElementById('screen-calendar').classList.contains('active')) {
            renderCalendar();
        }
        if (typeof renderGroupsScreen === 'function' && document.getElementById('screen-groups') && document.getElementById('screen-groups').classList.contains('active')) {
            renderGroupsScreen();
        }
        if (typeof renderSummary === 'function' && document.getElementById('screen-summary') && document.getElementById('screen-summary').classList.contains('active')) {
            renderSummary();
        }
    }
}

// Inicializar na carga da página
document.addEventListener('DOMContentLoaded', () => {
    updateLanguage(null, false);
});
