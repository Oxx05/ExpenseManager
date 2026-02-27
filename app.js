/* ================================================================
   GESTOR DE DESPESAS — Application Logic (v2)
   ================================================================ */

// --- Estado global ---
let currentYear, currentMonth;
let summaryYear, summaryMonth;
let categoriesCache = [];
let selectedCategoryId = null;
let selectedDayDate = null;       // data do dia selecionado no calendário
let editingExpense = null;        // despesa a ser editada
let touchStartX = 0;             // para swipe
let touchStartY = 0;

// --- Inicialização ---
document.addEventListener('DOMContentLoaded', async () => {
    await db.init();
    await db.processRecurring();

    const now = new Date();
    currentYear = now.getFullYear();
    currentMonth = now.getMonth();
    summaryYear = currentYear;
    summaryMonth = currentMonth;

    categoriesCache = await db.getAllCategories();

    setupNavigation();
    setupCalendarNav();
    setupCalendarSwipe();
    setupExpenseForm();
    setupDeleteModal();
    setupCategoryForm();
    setupSummaryNav();
    setupExport();
    setupServiceWorker();

    renderCalendar();
    renderCategories();
    updateExportDates();
});

// ============================================
// NAVIGATION
// ============================================

function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => navigateTo(btn.dataset.screen));
    });
    document.querySelectorAll('.back-btn').forEach(btn => {
        btn.addEventListener('click', () => navigateTo(btn.dataset.screen));
    });
    document.getElementById('fab-add').addEventListener('click', () => openAddExpense(selectedDayDate));
}

function navigateTo(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`screen-${screenId}`).classList.add('active');

    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const navBtn = document.querySelector(`.nav-item[data-screen="${screenId}"]`);
    if (navBtn) navBtn.classList.add('active');

    if (screenId === 'calendar') renderCalendar();
    if (screenId === 'categories') renderCategories();
    if (screenId === 'summary') renderSummary();
    if (screenId === 'groups') {
        if (typeof renderGroupsScreen === 'function') renderGroupsScreen();
    }
}

// ============================================
// CALENDAR
// ============================================

function getMonthNames() {
    return [t('jan'), t('feb'), t('mar'), t('apr'), t('may'), t('jun'), t('jul'), t('aug'), t('sep'), t('oct'), t('nov'), t('dec')];
}

function setupCalendarNav() {
    document.getElementById('prev-month').addEventListener('click', () => {
        currentMonth--;
        if (currentMonth < 0) { currentMonth = 11; currentYear--; }
        closeDayDetail();
        renderCalendar();
    });
    document.getElementById('next-month').addEventListener('click', () => {
        currentMonth++;
        if (currentMonth > 11) { currentMonth = 0; currentYear++; }
        closeDayDetail();
        renderCalendar();
    });
    document.getElementById('day-detail-close').addEventListener('click', closeDayDetail);
    document.getElementById('day-add-btn').addEventListener('click', () => {
        if (selectedDayDate) openAddExpense(selectedDayDate);
    });
}

function closeDayDetail() {
    document.getElementById('day-detail').classList.add('hidden');
    // remove visual selection from calendar when closing detail
    document.querySelectorAll('.cal-day.current').forEach(c => c.classList.remove('current'));
    selectedDayDate = null;
}

// --- Swipe para trocar mês ---
function setupCalendarSwipe() {
    const screen = document.getElementById('screen-calendar');
    screen.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }, { passive: true });

    screen.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;
        // Only trigger if horizontal swipe is dominant and big enough
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            if (dx < 0) { // swipe left → next month
                currentMonth++;
                if (currentMonth > 11) { currentMonth = 0; currentYear++; }
            } else { // swipe right → previous month
                currentMonth--;
                if (currentMonth < 0) { currentMonth = 11; currentYear--; }
            }
            closeDayDetail();
            renderCalendar();
        }
    }, { passive: true });
}

async function renderCalendar() {
    document.getElementById('month-label').textContent = `${getMonthNames()[currentMonth]} ${currentYear}`;

    // Use the projection method to include recurring entries
    const localExpenses = await db.getExpensesWithRecurring(currentYear, currentMonth);
    const groupExpenses = await fetchGroupExpensesForMonth(currentYear, currentMonth);
    const expenses = [...localExpenses, ...groupExpenses];

    categoriesCache = await db.getAllCategories();
    // Injetar uma categoria falsa para as despesas de grupo serem renderizadas com estilo
    categoriesCache.push({ id: 'group_expense', name: t('js_group_badge'), icon: '👥', color: '#7f5af0' });

    // Group by date
    const byDate = {};
    expenses.forEach(e => {
        if (!byDate[e.date]) byDate[e.date] = [];
        byDate[e.date].push(e);
    });

    // Month total (count all including projected)
    const monthTotal = expenses.reduce((sum, e) => sum + e.amount, 0);
    document.getElementById('month-total').textContent = formatCurrency(monthTotal);

    // Build calendar
    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = '';

    const firstDay = new Date(currentYear, currentMonth, 1);
    const lastDay = new Date(currentYear, currentMonth + 1, 0);
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);

    let startDow = firstDay.getDay() - 1;
    if (startDow < 0) startDow = 6;

    // Previous month fill
    const prevLastDay = new Date(currentYear, currentMonth, 0).getDate();
    for (let i = startDow - 1; i >= 0; i--) {
        grid.appendChild(createDayCell(prevLastDay - i, true));
    }

    // Current month days
    for (let day = 1; day <= lastDay.getDate(); day++) {
        const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayExpenses = byDate[dateStr] || [];
        const isToday = dateStr === todayStr;
        grid.appendChild(createDayCell(day, false, isToday, dayExpenses, dateStr));
    }

    // Fill to complete grid rows
    const totalCells = grid.children.length;
    const remaining = (Math.ceil(totalCells / 7) * 7) - totalCells;
    for (let i = 1; i <= remaining; i++) {
        grid.appendChild(createDayCell(i, true));
    }
}

function createDayCell(day, isOtherMonth, isToday = false, expenses = [], dateStr = '') {
    const el = document.createElement('div');
    el.className = 'cal-day';
    if (isOtherMonth) el.classList.add('other-month');
    if (isToday) el.classList.add('today');

    let html = `<span class="cal-day-num">${day}</span>`;

    if (expenses.length > 0) {
        el.classList.add('has-expense');
        const total = expenses.reduce((sum, e) => sum + e.amount, 0);
        html += `<span class="cal-amount">${total.toFixed(0)}€</span>`;

        // Category dots
        html += '<div class="expense-dots">';
        const uniqueCats = [...new Set(expenses.map(e => e.categoryId))].slice(0, 3);
        uniqueCats.forEach(catId => {
            const cat = categoriesCache.find(c => c.id === catId);
            const color = cat ? cat.color : '#666';
            html += `<span class="expense-dot" style="background:${color}"></span>`;
        });
        html += '</div>';
    }

    el.innerHTML = html;

    // ALL days are clickable (even without expenses — to add directly)
    if (!isOtherMonth && dateStr) {
        // persist selection if this date is already selected
        if (dateStr === selectedDayDate) el.classList.add('current');

        el.addEventListener('click', () => {
            // ensure only one day has the `.current` class
            document.querySelectorAll('.cal-day.current').forEach(c => c.classList.remove('current'));
            selectedDayDate = dateStr;
            el.classList.add('current');
            showDayDetail(dateStr, expenses);
        });
    }

    return el;
}

async function showDayDetail(dateStr, expenses) {
    const detail = document.getElementById('day-detail');
    const date = new Date(dateStr + 'T00:00:00');
    const dayName = date.toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' });
    selectedDayDate = dateStr;

    document.getElementById('day-detail-title').textContent = dayName;

    const list = document.getElementById('day-detail-list');
    list.innerHTML = '';

    let total = 0;
    for (const expense of expenses) {
        const cat = categoriesCache.find(c => String(c.id) === String(expense.categoryId)) || { icon: '💰', color: '#666', name: t('js_others') };
        total += expense.amount;

        const recurringType = expense.isProjected ? expense._recurringType : expense.recurringType;
        const recurringLabel = expense.isRecurring || expense.isProjected ? t('rec_' + recurringType) : null;

        const isProjected = expense.isProjected;

        const item = document.createElement('div');
        item.className = 'expense-item';
        if (isProjected) item.classList.add('projected');
        if (expense.isGroupExpense) item.style.borderLeft = '3px solid #7f5af0';

        item.innerHTML = `
      <div class="expense-item-left">
        <div class="expense-item-cat" style="background:${cat.color}22">${cat.icon}</div>
        <div>
            <div style="display:flex; align-items:center; gap:6px;">
                <div class="expense-item-desc">${expense.description}</div>
                ${expense.isGroupExpense ? `<span style="font-size:10px; background:#7f5af033; color:#7f5af0; padding:2px 6px; border-radius:4px;">${t('js_group_badge')}</span>` : ''}
            </div>
            ${recurringLabel ? `<div class="expense-item-recurring">🔄 ${recurringLabel}${isProjected ? ' (auto)' : ''}</div>` : ''}
        </div>
      </div>
      <div class="expense-item-amount">${formatCurrency(expense.amount)}</div>
    `;

        if (!isProjected && !expense.isGroupExpense) {
            item.addEventListener('click', () => openEditExpense(expense));
        } else if (expense.isGroupExpense) {
            item.addEventListener('click', () => navigateTo('groups'));
        }

        list.appendChild(item);
    }

    document.getElementById('day-detail-total').textContent = `${t('js_total')} ${formatCurrency(total)}`;
    detail.classList.remove('hidden');

    // Scroll to detail
    detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ============================================
// ADD / EDIT EXPENSE
// ============================================

function setupExpenseForm() {
    document.getElementById('expense-form').addEventListener('submit', saveExpense);
    document.getElementById('expense-recurring').addEventListener('change', (e) => {
        document.getElementById('recurring-options').classList.toggle('hidden', !e.target.checked);
        hideAllRecurringConfigs();
    });

    // Listen to recurring type changes
    document.querySelectorAll('input[name="recurring-type"]').forEach(radio => {
        radio.addEventListener('change', updateRecurringConfig);
    });

    document.getElementById('delete-btn').addEventListener('click', handleDelete);
}

function updateRecurringConfig() {
    hideAllRecurringConfigs();
    const recurringType = document.querySelector('input[name="recurring-type"]:checked')?.value;

    if (recurringType === 'weekly') {
        document.getElementById('weekly-config').classList.remove('hidden');
    } else if (recurringType === 'monthly') {
        document.getElementById('monthly-config').classList.remove('hidden');
    } else if (recurringType === 'yearly') {
        document.getElementById('yearly-config').classList.remove('hidden');
    }
}

function hideAllRecurringConfigs() {
    document.getElementById('weekly-config').classList.add('hidden');
    document.getElementById('monthly-config').classList.add('hidden');
    document.getElementById('yearly-config').classList.add('hidden');
}

function openAddExpense(dateStr = null) {
    editingExpense = null;
    document.getElementById('add-title').textContent = 'Nova Despesa';
    document.getElementById('expense-form').reset();
    document.getElementById('expense-id').value = '';
    document.getElementById('delete-btn').classList.add('hidden');
    document.getElementById('recurring-options').classList.add('hidden');

    // Pre-fill date from calendar selection or today
    const date = dateStr || new Date().toISOString().slice(0, 10);
    document.getElementById('expense-date').value = date;

    renderCategoryPicker();
    selectedCategoryId = categoriesCache.length > 0 ? categoriesCache[0].id : null;
    updateCategoryPickerUI();

    // For weekly: only check the day of week of the selected date
    const selectedDate = new Date(date + 'T00:00:00');
    const dayOfWeek = selectedDate.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
    document.querySelectorAll('input[name="weekly-day"]').forEach(cb => {
        cb.checked = parseInt(cb.value) === dayOfWeek;
    });

    navigateTo('add');
}

function openEditExpense(expense) {
    editingExpense = expense;
    document.getElementById('add-title').textContent = 'Editar Despesa';
    document.getElementById('expense-id').value = expense.id;
    document.getElementById('expense-amount').value = expense.amount;
    document.getElementById('expense-desc').value = expense.description;
    document.getElementById('expense-date').value = expense.date;
    document.getElementById('expense-recurring').checked = expense.isRecurring || false;
    document.getElementById('delete-btn').classList.remove('hidden');

    if (expense.isRecurring) {
        document.getElementById('recurring-options').classList.remove('hidden');
        const radio = document.querySelector(`input[name="recurring-type"][value="${expense.recurringType}"]`);
        if (radio) radio.checked = true;

        // Restore recurring parameters
        restoreRecurringParams(expense);
        updateRecurringConfig();
    } else {
        document.getElementById('recurring-options').classList.add('hidden');
    }

    renderCategoryPicker();
    selectedCategoryId = expense.categoryId;
    updateCategoryPickerUI();

    navigateTo('add');
}

function restoreRecurringParams(expense) {
    const params = expense.recurringParams || {};

    // Weekly
    if (expense.recurringType === 'weekly' && params.weeklyDays) {
        document.querySelectorAll('input[name="weekly-day"]').forEach(cb => {
            cb.checked = params.weeklyDays.includes(parseInt(cb.value));
        });
    }

    // Monthly
    if (expense.recurringType === 'monthly') {
        document.querySelector(`input[name="monthly-type"][value="${params.monthlyType || 'dayOfMonth'}"]`).checked = true;
        document.getElementById('monthly-day').value = params.monthlyDay || 1;
        document.getElementById('monthly-week').value = params.monthlyWeekOfMonth || 1;
        document.getElementById('monthly-dow').value = params.monthlyDayOfWeek || 1;
    }

    // Yearly
    if (expense.recurringType === 'yearly') {
        document.querySelector(`input[name="yearly-type"][value="${params.yearlyType || 'date'}"]`).checked = true;
        document.getElementById('yearly-day').value = params.yearlyDay || 1;
        document.getElementById('yearly-month').value = params.yearlyMonth || 0;
        document.getElementById('yearly-week').value = params.yearlyWeekOfMonth || 1;
        document.getElementById('yearly-dow').value = params.yearlyDayOfWeek || 1;
        document.getElementById('yearly-dow-month').value = params.yearlyDowMonth || 0;
    }
}

function renderCategoryPicker() {
    const picker = document.getElementById('category-picker');
    picker.innerHTML = '';
    categoriesCache.forEach(cat => {
        const chip = document.createElement('div');
        chip.className = 'cat-chip';
        chip.dataset.id = cat.id;
        chip.innerHTML = `<span>${cat.icon}</span> ${cat.name}`;
        chip.addEventListener('click', () => {
            selectedCategoryId = cat.id;
            updateCategoryPickerUI();
        });
        picker.appendChild(chip);
    });
}

function updateCategoryPickerUI() {
    document.querySelectorAll('.cat-chip').forEach(chip => {
        chip.classList.toggle('selected', parseInt(chip.dataset.id) === selectedCategoryId);
    });
}

async function saveExpense(e) {
    e.preventDefault();

    const id = document.getElementById('expense-id').value;
    const isRecurring = document.getElementById('expense-recurring').checked;
    const recurringType = isRecurring
        ? document.querySelector('input[name="recurring-type"]:checked')?.value || 'monthly'
        : 'none';

    const expense = {
        amount: parseFloat(document.getElementById('expense-amount').value),
        description: document.getElementById('expense-desc').value.trim(),
        categoryId: selectedCategoryId,
        date: document.getElementById('expense-date').value,
        isRecurring,
        recurringType,
        nextOccurrence: null,
    };

    // Capture recurring parameters
    if (isRecurring) {
        expense.recurringParams = captureRecurringParams(recurringType);

        // Validate: weekly must have at least 1 day selected
        if (recurringType === 'weekly' && (!expense.recurringParams.weeklyDays || expense.recurringParams.weeklyDays.length === 0)) {
            alert('Seleciona pelo menos um dia da semana para a repetição semanal.');
            return;
        }
    }

    if (id) {
        expense.id = parseInt(id);
        // Keep parentId if editing a child
        if (editingExpense?.parentId) expense.parentId = editingExpense.parentId;
        await db.updateExpense(expense);
    } else {
        await db.addExpense(expense);
    }

    if (isRecurring) await db.processRecurring();
    navigateTo('calendar');
}

function captureRecurringParams(recurringType) {
    const params = {};

    if (recurringType === 'weekly') {
        params.weeklyDays = Array.from(document.querySelectorAll('input[name="weekly-day"]:checked'))
            .map(cb => parseInt(cb.value));
    } else if (recurringType === 'monthly') {
        const monthlyType = document.querySelector('input[name="monthly-type"]:checked')?.value || 'dayOfMonth';
        params.monthlyType = monthlyType;
        if (monthlyType === 'dayOfMonth') {
            params.monthlyDay = parseInt(document.getElementById('monthly-day').value);
        } else {
            params.monthlyWeekOfMonth = parseInt(document.getElementById('monthly-week').value);
            params.monthlyDayOfWeek = parseInt(document.getElementById('monthly-dow').value);
        }
    } else if (recurringType === 'yearly') {
        const yearlyType = document.querySelector('input[name="yearly-type"]:checked')?.value || 'date';
        params.yearlyType = yearlyType;
        if (yearlyType === 'date') {
            params.yearlyDay = parseInt(document.getElementById('yearly-day').value);
            params.yearlyMonth = parseInt(document.getElementById('yearly-month').value);
        } else {
            params.yearlyWeekOfMonth = parseInt(document.getElementById('yearly-week').value);
            params.yearlyDayOfWeek = parseInt(document.getElementById('yearly-dow').value);
            params.yearlyDowMonth = parseInt(document.getElementById('yearly-dow-month').value);
        }
    }

    return params;
}

// ============================================
// DELETE (with recurring modal)
// ============================================

function setupDeleteModal() {
    document.getElementById('delete-cancel-btn').addEventListener('click', () => {
        document.getElementById('delete-modal').classList.add('hidden');
    });
    document.getElementById('delete-one-btn').addEventListener('click', async () => {
        if (editingExpense?.id) {
            await db.deleteExpense(editingExpense.id);
        }
        document.getElementById('delete-modal').classList.add('hidden');
        navigateTo('calendar');
    });
    document.getElementById('delete-from-btn').addEventListener('click', async () => {
        if (editingExpense) {
            const parentId = editingExpense.parentId || editingExpense.id;
            // Delete from this date onwards
            await db.deleteRecurringAndChildren(parentId, editingExpense.date);
        }
        document.getElementById('delete-modal').classList.add('hidden');
        navigateTo('calendar');
    });
    document.getElementById('delete-all-btn').addEventListener('click', async () => {
        if (editingExpense) {
            const parentId = editingExpense.parentId || editingExpense.id;
            // Delete all (no date limit)
            await db.deleteRecurringAndChildren(parentId);
        }
        document.getElementById('delete-modal').classList.add('hidden');
        navigateTo('calendar');
    });
}

function handleDelete() {
    if (!editingExpense) return;

    // Check if this expense is recurring or a child of a recurring expense
    const isRecurringRelated = editingExpense.isRecurring || editingExpense.parentId;

    if (isRecurringRelated) {
        const modal = document.getElementById('delete-modal');
        if (editingExpense.isRecurring) {
            document.getElementById('delete-modal-text').textContent =
                'Esta é uma despesa recorrente. O que queres fazer?';
        } else {
            document.getElementById('delete-modal-text').textContent =
                'Esta despesa foi gerada por uma recorrência. O que queres fazer?';
        }
        modal.classList.remove('hidden');
    } else {
        if (confirm('Eliminar esta despesa?')) {
            db.deleteExpense(editingExpense.id).then(() => navigateTo('calendar'));
        }
    }
}

// ============================================
// CATEGORIES
// ============================================

function setupCategoryForm() {
    document.getElementById('add-cat-btn').addEventListener('click', addCategory);
}

async function renderCategories() {
    categoriesCache = await db.getAllCategories();
    const allExpenses = await db.getAllExpenses();
    const list = document.getElementById('categories-list');
    list.innerHTML = '';

    categoriesCache.forEach(cat => {
        const catExpenses = allExpenses.filter(e => e.categoryId === cat.id);
        const count = catExpenses.length;
        const total = catExpenses.reduce((sum, e) => sum + e.amount, 0);

        const item = document.createElement('div');
        item.className = 'category-item';
        item.innerHTML = `
      <div class="category-item-left">
        <div class="category-item-icon" style="background:${cat.color}22">${cat.icon}</div>
        <div>
          <div class="category-item-name">${cat.name}</div>
          <div class="category-item-count">${count} despesas · ${formatCurrency(total)}</div>
        </div>
      </div>
      <button class="category-delete-btn" data-id="${cat.id}" title="Eliminar">🗑️</button>
    `;
        list.appendChild(item);
    });

    list.querySelectorAll('.category-delete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = parseInt(btn.dataset.id);
            if (confirm(t('js_confirm_delete_cat'))) {
                await db.deleteCategory(id);
                renderCategories();
                renderCalendar();
            }
        });
    });
}

async function addCategory() {
    if (!currentUser?.is_pro && categoriesCache.length >= 8) {
        showPaywall();
        return;
    }
    const name = document.getElementById('new-cat-name').value.trim();
    const icon = document.getElementById('new-cat-icon').value.trim() || '🏷️';
    const color = document.getElementById('new-cat-color').value;
    if (!name) return;
    try {
        if (categoriesCache.find(c => c.name.toLowerCase() === name.toLowerCase())) {
            alert(t('js_cat_exists'));
            return;
        }
        await db.addCategory({ name, icon, color });
        document.getElementById('new-cat-name').value = '';
        document.getElementById('new-cat-icon').value = '';
        categoriesCache = await db.getAllCategories();
        renderCategories();
    } catch { alert('Erro ao adicionar categoria.'); } // Changed from original 'Já existe uma categoria com esse nome.' to a generic error, as specific check is now above.
}

// ============================================
// SUMMARY
// ============================================

function setupSummaryNav() {
    document.getElementById('prev-summary').addEventListener('click', () => {
        summaryMonth--;
        if (summaryMonth < 0) { summaryMonth = 11; summaryYear--; }
        renderSummary();
    });
    document.getElementById('next-summary').addEventListener('click', () => {
        summaryMonth++;
        if (summaryMonth > 11) { summaryMonth = 0; summaryYear++; }
        renderSummary();
    });
}

async function renderSummary() {
    document.getElementById('summary-month-label').textContent = `${getMonthNames()[summaryMonth]} ${summaryYear}`;

    // Include projected recurring and group expenses for full picture
    const localExpenses = await db.getExpensesWithRecurring(summaryYear, summaryMonth);
    const groupExpenses = await fetchGroupExpensesForMonth(summaryYear, summaryMonth);
    const expenses = [...localExpenses, ...groupExpenses];

    categoriesCache = await db.getAllCategories();
    categoriesCache.push({ id: 'group_expense', name: t('js_group_badge'), icon: '👥', color: '#7f5af0' });

    const total = expenses.reduce((sum, e) => sum + e.amount, 0);
    document.getElementById('summary-total').textContent = formatCurrency(total);

    const byCat = {};
    expenses.forEach(e => {
        if (!byCat[e.categoryId]) byCat[e.categoryId] = 0;
        byCat[e.categoryId] += e.amount;
    });

    const sorted = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    const maxAmount = sorted.length > 0 ? sorted[0][1] : 1;

    const chart = document.getElementById('summary-chart');
    chart.innerHTML = '';

    sorted.forEach(([catId, amount]) => {
        const cat = categoriesCache.find(c => String(c.id) === String(catId)) || { icon: '💰', name: t('js_others'), color: '#666' };
        const pct = (amount / maxAmount) * 100;
        const percentOfTotal = ((amount / total) * 100).toFixed(1);

        chart.innerHTML += `
      <div class="chart-bar-row">
        <div class="chart-label">${cat.icon} ${cat.name}</div>
        <div class="chart-bar-bg">
          <div class="chart-bar-fill" style="width:${pct}%;background:${cat.color}"></div>
        </div>
        <div class="chart-bar-value">${formatCurrency(amount)}<br><small>${percentOfTotal}%</small></div>
      </div>
    `;
    });

    if (sorted.length === 0) {
        chart.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px;">Sem despesas neste mês.</p>';
    }
}

// ============================================
// EXPORT (mobile compatible)
// ============================================

function setupExport() {
    document.getElementById('export-btn').addEventListener('click', exportExcel);
}

function updateExportDates() {
    const fromDate = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(currentYear, currentMonth + 1, 0).getDate();
    const toDate = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    document.getElementById('export-from').value = fromDate;
    document.getElementById('export-to').value = toDate;
}

async function exportExcel() {
    if (!currentUser?.is_pro) {
        showPaywall();
        return;
    }
    const from = document.getElementById('export-from').value;
    const to = document.getElementById('export-to').value;

    if (!from || !to) { alert(t('js_select_dates')); return; }

    const expenses = await db.getExpensesByDateRange(from, to);
    categoriesCache = await db.getAllCategories();

    if (expenses.length === 0) { alert(t('js_no_exp_period')); return; }

    expenses.sort((a, b) => a.date.localeCompare(b.date));

    const data = expenses.map(e => {
        // Verify category exists or fallback
        const cat = categoriesCache.find(c => String(c.id) === String(e.categoryId)) || { name: t('js_others') };
        return {
            'Data': e.date,
            'Categoria': cat.name,
            'Tipo': e.isGroupExpense ? t('js_group_badge') : 'Pessoal',
            'Recorrente': e.isRecurring ? (t('rec_' + e.recurringType) || 'Sim') : 'Não',
            'Descrição': e.description,
            'Valor': e.amount.toFixed(2)
        };
    });

    const total = expenses.reduce((sum, e) => sum + e.amount, 0);
    data.push({});
    data.push({ 'Data': '', 'Descrição': 'TOTAL', 'Categoria': '', 'Valor (€)': total, 'Recorrente': '' });

    const summary = [];
    const byCat = {};
    expenses.forEach(e => {
        const cat = categoriesCache.find(c => c.id === e.categoryId) || { name: 'Outros' };
        if (!byCat[cat.name]) byCat[cat.name] = 0;
        byCat[cat.name] += e.amount;
    });
    Object.entries(byCat).sort((a, b) => b[1] - a[1]).forEach(([name, amount]) => {
        summary.push({ 'Categoria': name, 'Total (€)': amount, 'Percentagem': `${((amount / total) * 100).toFixed(1)}%` });
    });

    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.json_to_sheet(data);
    const ws2 = XLSX.utils.json_to_sheet(summary);
    ws1['!cols'] = [{ wch: 12 }, { wch: 30 }, { wch: 15 }, { wch: 12 }, { wch: 12 }];
    ws2['!cols'] = [{ wch: 15 }, { wch: 12 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws1, 'Despesas');
    XLSX.utils.book_append_sheet(wb, ws2, 'Resumo');

    // Mobile-compatible download using Blob
    const filename = `despesas_${from}_${to}.xlsx`;

    try {
        // Method 1: Web Share API (works on mobile)
        if (navigator.canShare && navigator.canShare({ files: [new File([], 'test.xlsx')] })) {
            const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const file = new File([blob], filename, { type: blob.type });
            await navigator.share({ files: [file], title: 'Despesas' });
            return;
        }
    } catch (e) {
        // Fall through to standard download
    }

    // Method 2: Standard Blob download (desktop + some mobile)
    try {
        const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 200);
    } catch (e) {
        // Method 3: fallback
        XLSX.writeFile(wb, filename);
    }
}

// ============================================
// SERVICE WORKER
// ============================================

function setupServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(() => { });
    }
}

// ============================================
// UTILS
// ============================================

function formatCurrency(amount) {
    return amount.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

// ============================================
// STRIPE PAYWALL
// ============================================

function showPaywall() {
    const modal = document.getElementById('paywall-modal');
    if (modal) modal.classList.remove('hidden');
}

async function createCheckoutSession() {
    if (!currentUser) return;
    const btn = document.getElementById('upgrade-btn');
    const oldText = btn.textContent;
    btn.textContent = "A redirecionar...";
    btn.disabled = true;

    try {
        const response = await fetch('/api/create-checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: currentUser.id,
                email: currentUser.email
            })
        });

        const data = await response.json();
        if (data.url) {
            window.location.href = data.url;
        } else {
            alert('Não foi possível iniciar o pagamento. Tenta novamente mais tarde.');
            btn.textContent = oldText;
            btn.disabled = false;
        }
    } catch (err) {
        console.error(err);
        alert('Erro ao ligar ao servidor de pagamentos.');
        btn.textContent = oldText;
        btn.disabled = false;
    }
}

// ============================================
// SUPABASE AUTH & GROUPS LOGIC
// ============================================

let currentUser = null;
let currentGroup = null;
let currentGroupMembers = [];

document.addEventListener('DOMContentLoaded', async () => {
    // Check active session
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
        currentUser = session.user;
    }
    updateAuthUI();

    // Auth Form (now in Account tab)
    document.getElementById('auth-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('auth-email').value;
        const msg = document.getElementById('auth-msg');
        msg.textContent = t('js_sending_link');
        msg.style.color = "var(--text-dim)";

        const { error } = await supabaseClient.auth.signInWithOtp({
            email,
            options: { emailRedirectTo: window.location.origin }
        });

        if (error) {
            msg.textContent = `${t('js_error')} ` + error.message;
            msg.style.color = "var(--danger)";
        } else {
            msg.textContent = t('js_check_email_login');
            msg.style.color = "var(--success)";
        }
    });

    // Logout
    document.getElementById('logout-btn').addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
        currentUser = null;
        updateAuthUI();
        navigateTo('account');
    });

    // Create Group
    document.getElementById('add-group-btn').addEventListener('click', async () => {
        if (!currentUser?.is_pro) {
            const { count } = await supabaseClient.from('group_members').select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id);
            if (count >= 1) {
                showPaywall();
                return;
            }
        }

        const name = prompt(t('js_new_group_prompt'));
        if (!name || !currentUser) return;

        const { data: group, error } = await supabaseClient
            .from('groups')
            .insert({ name: name, created_by: currentUser.id })
            .select()
            .single();

        if (!error && group) {
            // Add self to members
            await supabaseClient.from('group_members').insert({ group_id: group.id, user_id: currentUser.id });
            renderGroupsScreen();
        } else {
            alert(t('js_err_create_group'));
        }
    });

    // Invite Member
    document.getElementById('invite-btn').addEventListener('click', async () => {
        const email = document.getElementById('invite-email').value;
        if (!email || !currentGroup) return;

        // 1. Encontrar o perfil do utilizador pelo email
        const { data: profile } = await supabaseClient.from('profiles').select('id').eq('email', email).single();
        if (!profile) {
            alert(t('js_err_user_not_found'));
            return;
        }


        // 2. Adicionar ao grupo
        const { error } = await supabaseClient.from('group_members').insert({ group_id: currentGroup.id, user_id: profile.id });
        if (error) alert(t('js_err_add_member'));
        else {
            document.getElementById('invite-email').value = '';
            loadGroupDetail(currentGroup.id);
        }
    });

    // Tabs inside Group
    document.querySelectorAll('.group-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.group-tab').forEach(t => {
                t.classList.remove('active');
                t.style.borderBottomColor = 'transparent';
                t.style.color = 'var(--text-dim)';
            });
            tab.classList.add('active');
            tab.style.borderBottomColor = 'var(--primary)';
            tab.style.color = 'white';

            document.querySelectorAll('.group-tab-content').forEach(c => c.classList.add('hidden'));
            document.getElementById(`group-${tab.dataset.tab}-tab`).classList.remove('hidden');
        });
    });

    // Open Add Group Expense
    document.getElementById('group-fab-add').addEventListener('click', () => {
        if (!currentGroup) return;
        document.getElementById('group-expense-form').reset();
        document.getElementById('group-expense-date').value = new Date().toISOString().slice(0, 10);

        // Populate payers dropdown
        const payerSelect = document.getElementById('group-expense-payer');
        payerSelect.innerHTML = '';
        currentGroupMembers.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.profiles.id;
            opt.textContent = m.profiles.name || m.profiles.email;
            if (m.profiles.id === currentUser.id) opt.selected = true;
            payerSelect.appendChild(opt);
        });

        // Populate splits (equal split by default)
        const splitsContainer = document.getElementById('group-expense-splits');
        splitsContainer.innerHTML = '';
        currentGroupMembers.forEach(m => {
            splitsContainer.innerHTML += `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <label style="display:flex; align-items:center; gap:8px;">
                        <input type="checkbox" class="split-checkbox" value="${m.profiles.id}" checked style="width:16px; height:16px; accent-color:var(--accent);">
                        ${m.profiles.name || m.profiles.email}
                    </label>
                    <span class="split-amount-preview" data-id="${m.profiles.id}">0.00 €</span>
                </div>
            `;
        });

        // Recalculate splits on amount change or checkbox flip
        const calcSplits = () => {
            const total = parseFloat(document.getElementById('group-expense-amount').value) || 0;
            const checkedBoxes = document.querySelectorAll('.split-checkbox:checked');
            const splitVal = checkedBoxes.length > 0 ? total / checkedBoxes.length : 0;

            document.querySelectorAll('.split-amount-preview').forEach(el => el.textContent = '0.00 €');
            checkedBoxes.forEach(cb => {
                document.querySelector(`.split-amount-preview[data-id="${cb.value}"]`).textContent = splitVal.toFixed(2) + ' €';
            });
        };

        document.getElementById('group-expense-amount').addEventListener('input', calcSplits);
        document.querySelectorAll('.split-checkbox').forEach(cb => cb.addEventListener('change', calcSplits));

        navigateTo('add-group-expense');
    });

    // Submit Group Expense (Nativo com RPC anti-race conditions)
    document.getElementById('group-expense-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const total = parseFloat(document.getElementById('group-expense-amount').value);
        const desc = document.getElementById('group-expense-desc').value;
        const date = document.getElementById('group-expense-date').value;
        const paidBy = document.getElementById('group-expense-payer').value;

        const checkedBoxes = document.querySelectorAll('.split-checkbox:checked');
        if (checkedBoxes.length === 0 || total <= 0) return alert(t('js_invalid_expense'));

        const splitVal = total / checkedBoxes.length;
        const splits = [];
        document.querySelectorAll('.split-checkbox').forEach(cb => {
            if (cb.checked) splits.push({ user_id: cb.value, amount: splitVal });
        });

        const { error } = await supabaseClient.rpc('add_group_expense', {
            p_group_id: currentGroup.id,
            p_paid_by: paidBy,
            p_amount: total,
            p_description: desc,
            p_date: date,
            p_splits: splits
        });

        if (error) {
            console.error(error);
            alert(`${t('js_err_save')} ` + error.message);
        } else {
            loadGroupDetail(currentGroup.id);
            navigateTo('group-detail');
        }
    });

});

let authStateChecked = false;
supabaseClient.auth.onAuthStateChange((event, session) => {
    // Only attempt to mutate DOM if the DOM is ready
    const update = () => {
        if (session) {
            currentUser = session.user;
            updateAuthUI();
            if (document.getElementById('screen-groups') && document.getElementById('screen-groups').classList.contains('active')) renderGroupsScreen();
        } else {
            currentUser = null;
            updateAuthUI();
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', update);
    } else {
        update();
    }
});

function updateAuthUI() {
    // Prevent errors if UI is not mounted yet
    if (!document.getElementById('auth-section')) return;

    if (currentUser) {
        // Account Tab updates
        document.getElementById('auth-section').classList.add('hidden');
        document.getElementById('account-logged-in').classList.remove('hidden');

        // Obter infos para exibir
        supabaseClient.from('profiles').select('name, email').eq('id', currentUser.id).single()
            .then(({ data }) => {
                if (data) {
                    document.getElementById('account-name').textContent = data.name || data.email;
                    document.getElementById('account-email').textContent = data.email;
                    document.getElementById('account-avatar').textContent = (data.name || data.email).charAt(0).toUpperCase();
                }
            });

        // Obter status PRO
        supabaseClient.from('subscriptions').select('is_pro').eq('user_id', currentUser.id).single()
            .then(({ data }) => {
                currentUser.is_pro = data?.is_pro || false;
                const badge = document.getElementById('pro-badge');
                if (badge) {
                    if (currentUser.is_pro) badge.classList.remove('hidden');
                    else badge.classList.add('hidden');
                }
            });

        // Groups Tab updates
        if (document.getElementById('groups-unauth-msg')) {
            document.getElementById('groups-unauth-msg').classList.add('hidden');
            document.getElementById('groups-section').classList.remove('hidden');
        }

    } else {
        // Account Tab updates
        document.getElementById('auth-section').classList.remove('hidden');
        document.getElementById('account-logged-in').classList.add('hidden');

        // Groups Tab updates
        if (document.getElementById('groups-unauth-msg')) {
            document.getElementById('groups-unauth-msg').classList.remove('hidden');
            document.getElementById('groups-section').classList.add('hidden');
        }
    }
}

async function renderGroupsScreen() {
    if (!currentUser) return;
    const list = document.getElementById('groups-list');
    list.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-dim);">${t('js_loading_groups')}</div>`;

    // Get groups via group_members
    const { data: members, error } = await supabaseClient
        .from('group_members')
        .select(`
            group_id,
            groups ( id, name, created_by )
        `)
        .eq('user_id', currentUser.id);

    if (error || !members || members.length === 0) {
        list.innerHTML = `<div style="text-align:center; padding:20px; border:1px dashed var(--border); border-radius:12px; color:var(--text-dim);">${t('js_no_groups')}</div>`;
        return;
    }

    list.innerHTML = '';
    members.forEach(m => {
        const g = m.groups;
        const role = g.created_by === currentUser.id ? t('js_creator') : t('js_member');
        list.innerHTML += `
            <div class="group-item" onclick="openGroupDetail('${g.id}', '${g.name}')">
                <div>
                    <div class="group-name">${g.name}</div>
                    <div class="group-role">${role}</div>
                </div>
                <i class="fas fa-chevron-right" style="color:var(--text-muted);"></i>
            </div>
        `;
    });
}

function openGroupDetail(id, name) {
    currentGroup = { id, name };
    document.getElementById('group-detail-title').textContent = name;
    navigateTo('group-detail');
    loadGroupDetail(id);
}

function navigateGroupBack() {
    navigateTo('group-detail');
}

async function loadGroupDetail(groupId) {
    // 1. Load Members
    const { data: members } = await supabaseClient
        .from('group_members')
        .select('profiles(id, name, email)')
        .eq('group_id', groupId);

    currentGroupMembers = members || [];
    const membersList = document.getElementById('group-members-list');
    membersList.innerHTML = '';

    const profileMap = {};
    currentGroupMembers.forEach(m => {
        profileMap[m.profiles.id] = m.profiles;
        membersList.innerHTML += `
            <div class="member-item">
                <div class="member-avatar">${(m.profiles.name || m.profiles.email).charAt(0).toUpperCase()}</div>
                <div>
                    <div style="font-size:14px; font-weight:600;">${m.profiles.name || m.profiles.email}</div>
                    <div style="font-size:12px; color:var(--text-dim);">${m.profiles.id === currentUser.id ? t('js_you') : ''}</div>
                </div>
            </div>
        `;
    });

    // 2. Load Debts
    const { data: debts } = await supabaseClient
        .from('debts')
        .select('*')
        .eq('group_id', groupId)
        .gt('amount', 0);

    const debtsList = document.getElementById('group-debts-list');
    debtsList.innerHTML = '';

    if (!debts || debts.length === 0) {
        debtsList.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-dim);">${t('js_all_settled_debts')}</div>`;
    } else {
        debts.forEach(d => {
            const isOwedToMe = d.creditor_id === currentUser.id;
            const iOwe = d.debtor_id === currentUser.id;

            const debtorName = profileMap[d.debtor_id]?.name || profileMap[d.debtor_id]?.email || t('js_someone');
            const creditorName = profileMap[d.creditor_id]?.name || profileMap[d.creditor_id]?.email || t('js_someone');

            let htmlClass = '';
            let textHtml = '';
            let btnHtml = '';

            if (isOwedToMe) {
                htmlClass = 'positive';
                textHtml = `<strong>${debtorName}</strong> ${t('js_owes_you')}`;
            } else if (iOwe) {
                htmlClass = 'negative';
                textHtml = `${t('js_you_owe')} <strong>${creditorName}</strong>`;
                btnHtml = `<button onclick="settleDebt('${d.debtor_id}','${d.creditor_id}',${d.amount})" class="btn-small" style="background:var(--accent);">${t('js_btn_pay')}</button>`;
            } else {
                textHtml = `<strong>${debtorName}</strong> ${t('js_owes')} ${creditorName}`;
            }

            debtsList.innerHTML += `
                <div class="debt-item ${htmlClass}">
                    <div class="debt-desc">${textHtml}</div>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <div class="debt-amount">${d.amount.toFixed(2)} €</div>
                        ${btnHtml}
                    </div>
                </div>
            `;
        });
    }

    // 3. Load Expenses
    const { data: expenses } = await supabaseClient
        .from('group_expenses')
        .select(`
            id, amount, description, date,
            paid_by,
            profiles(name, email)
        `)
        .eq('group_id', groupId)
        .order('date', { ascending: false })
        .limit(30);

    const expensesList = document.getElementById('group-expenses-list');
    expensesList.innerHTML = '';

    if (!expenses || expenses.length === 0) {
        expensesList.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-dim);">${t('js_no_group_expenses')}</div>`;
    } else {
        expenses.forEach(e => {
            const paidByName = e.paid_by === currentUser.id ? t('js_you') : (e.profiles?.name || e.profiles?.email || t('js_someone'));
            expensesList.innerHTML += `
                <div class="expense-item">
                    <div class="expense-item-left">
                        <div class="expense-item-cat" style="background:#4a4e6922">🤝</div>
                        <div>
                            <div class="expense-item-desc">${e.description}</div>
                            <div class="expense-item-recurring">${t('js_paid_by')} ${paidByName} (${e.date})</div>
                        </div>
                    </div>
                    <div class="expense-item-amount">${e.amount.toFixed(2)} €</div>
                </div>
            `;
        });
    }
}

window.settleDebt = async function (debtor_id, creditor_id, amount) {
    if (confirm(`${t('js_confirm_settle_debt')} ${amount.toFixed(2)} €?`)) {
        const { error } = await supabaseClient.rpc('settle_debt', {
            p_group_id: currentGroup.id,
            p_debtor_id: debtor_id,
            p_creditor_id: creditor_id,
            p_amount: amount
        });
        if (error) alert(`${t('js_err_settle')}` + error.message);
        else loadGroupDetail(currentGroup.id);
    }
}

async function fetchGroupExpensesForMonth(year, month) {
    if (!currentUser) return [];

    const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${lastDay}`;

    const { data: expenses, error } = await supabaseClient
        .from('group_expenses')
        .select(`
            id,
            description,
            date,
            groups ( name ),
            expense_splits!inner ( user_id, amount )
        `)
        .eq('expense_splits.user_id', currentUser.id)
        .gte('date', startDate)
        .lte('date', endDate);

    if (error || !expenses) return [];

    return expenses.map(e => ({
        id: e.id,
        description: `${e.groups.name} - ${e.description}`,
        amount: e.expense_splits[0].amount,
        date: e.date,
        categoryId: 'group_expense',
        isGroupExpense: true
    }));
}

// ============================================
// PUSH NOTIFICATIONS SETUP
// ============================================

const publicVapidKey = 'BKeh-8hl5uVuhVMsPl8v7vxEh32C4FSSmsMWmgjAHFUj0FjFnr7hc5PI-qZpuAGUvLbMxHiQhYNgoCiVgxsp5NE'; // Substituir pela chave gerada

async function setupPushNotifications() {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
        try {
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') return;

            const registration = await navigator.serviceWorker.ready;

            // Verifica se já tem subscrição
            let subscription = await registration.pushManager.getSubscription();

            if (!subscription) {
                subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(publicVapidKey)
                });
            }

            // Converter chaves
            const subJSON = subscription.toJSON();

            // Guardar no Supabase
            await supabaseClient.from('push_subscriptions').upsert({
                user_id: currentUser.id,
                endpoint: subJSON.endpoint,
                auth_key: subJSON.keys.auth,
                p256dh_key: subJSON.keys.p256dh
            }, { onConflict: 'user_id, endpoint' });

        } catch (error) {
            console.error('Push registration error:', error);
        }
    }
}

// Helper para converter VAPID key
function urlBase64ToUint8Array(base64String) {
    if (!base64String || base64String.startsWith('CHAVE')) return new Uint8Array();
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}
