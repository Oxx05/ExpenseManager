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

    // Invite Member (Fixing the Single vs Limit Bug)
    document.getElementById('invite-btn').addEventListener('click', async () => {
        const email = document.getElementById('invite-email').value;
        if (!email || !currentGroup) return;

        // 1. Encontrar o perfil do utilizador pelo email (usar .limit(1) evita o erro 406 Not Acceptable se houver contas raras duplicadas na DB)
        const { data: profiles, error: profileErr } = await supabaseClient.from('profiles').select('id').eq('email', email).limit(1);
        if (profileErr || !profiles || profiles.length === 0) {
            alert(t('js_err_user_not_found'));
            return;
        }

        const profileId = profiles[0].id;

        // 2. Adicionar ao grupo
        const { error } = await supabaseClient.from('group_members').insert({ group_id: currentGroup.id, user_id: profileId });
        if (error) {
            alert(t('js_err_add_member') + " " + error.message);
        } else {
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

        // Populate splits (MBWay style custom inputs)
        const splitsContainer = document.getElementById('group-expense-splits');
        splitsContainer.innerHTML = '';
        currentGroupMembers.forEach(m => {
            splitsContainer.innerHTML += `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <label style="display:flex; align-items:center; gap:8px;">
                        <input type="checkbox" class="split-checkbox" value="${m.profiles.id}" checked style="width:16px; height:16px; accent-color:var(--accent);">
                        ${m.profiles.name || m.profiles.email}
                    </label>
                    <div style="display:flex; align-items:center; gap:5px;">
                        <i class="fas fa-lock-open split-lock-icon" data-id="${m.profiles.id}" style="color:var(--text-dim); cursor:pointer; font-size:14px; margin-right:5px; width:16px; text-align:center;"></i>
                        <input type="number" step="0.01" min="0" class="split-amount-input" data-id="${m.profiles.id}" style="width:80px; padding:6px; border-radius:6px; border:1px solid var(--border); background:var(--bg-input); color:var(--text); text-align:right; font-size:14px;">
                        <span style="color:var(--text-dim); font-size:14px;">€</span>
                    </div>
                </div>
            `;
        });

        let manualSplits = {};

        // Recalculate splits on amount change or checkbox flip or manual input edit
        const calcSplits = (e) => {
            const total = parseFloat(document.getElementById('group-expense-amount').value) || 0;
            const checkedBoxes = Array.from(document.querySelectorAll('.split-checkbox:checked'));
            const allInputs = document.querySelectorAll('.split-amount-input');
            const allLocks = document.querySelectorAll('.split-lock-icon');

            // 1. Handle Checkbox uncheck
            if (e && e.target && e.target.classList.contains('split-checkbox')) {
                const id = e.target.value;
                if (!e.target.checked) {
                    delete manualSplits[id];
                    document.querySelector(`.split-amount-input[data-id="${id}"]`).value = '';
                    const lockIcon = document.querySelector(`.split-lock-icon[data-id="${id}"]`);
                    lockIcon.className = 'fas fa-lock-open split-lock-icon';
                    lockIcon.style.color = 'var(--text-dim)';
                }
            }

            // 2. Handle Lock Icon Click
            if (e && e.target && e.target.classList.contains('split-lock-icon')) {
                const id = e.target.dataset.id;
                const checkbox = document.querySelector(`.split-checkbox[value="${id}"]`);
                // Only allow locking/unlocking if the user is included in the split
                if (checkbox && checkbox.checked) {
                    if (manualSplits[id]) {
                        // Unlock
                        delete manualSplits[id];
                        e.target.className = 'fas fa-lock-open split-lock-icon';
                        e.target.style.color = 'var(--text-dim)';
                    } else {
                        // Lock
                        manualSplits[id] = true;
                        e.target.className = 'fas fa-lock split-lock-icon';
                        e.target.style.color = 'var(--accent)';
                    }
                }
            }

            // 3. Handle Manual Input Edit
            if (e && e.target && e.target.classList.contains('split-amount-input')) {
                const id = e.target.dataset.id;
                // If user types something, auto-lock it!
                if (e.target.value !== '') {
                    manualSplits[id] = true;
                    const lockIcon = document.querySelector(`.split-lock-icon[data-id="${id}"]`);
                    lockIcon.className = 'fas fa-lock split-lock-icon';
                    lockIcon.style.color = 'var(--accent)';
                }
            }

            // --- Calculation phase ---
            let lockedSum = 0;
            let unlockedBoxes = [];

            checkedBoxes.forEach(cb => {
                const id = cb.value;
                if (manualSplits[id]) {
                    const inputVal = parseFloat(document.querySelector(`.split-amount-input[data-id="${id}"]`).value) || 0;
                    lockedSum += inputVal;
                } else {
                    unlockedBoxes.push(cb);
                }
            });

            const remainingToDistribute = Math.max(0, total - lockedSum);
            const autoAmount = unlockedBoxes.length > 0 ? remainingToDistribute / unlockedBoxes.length : 0;

            // Apply values and UI states
            allInputs.forEach(input => {
                const id = input.dataset.id;
                const checkbox = document.querySelector(`.split-checkbox[value="${id}"]`);
                const lockIcon = document.querySelector(`.split-lock-icon[data-id="${id}"]`);

                if (!checkbox.checked) {
                    input.value = '';
                    input.readOnly = false;
                    input.disabled = true;
                    input.style.opacity = '0.4';
                    lockIcon.style.opacity = '0.4';
                    lockIcon.style.pointerEvents = 'none';
                } else {
                    input.style.opacity = '1';
                    lockIcon.style.opacity = '1';

                    if (manualSplits[id]) {
                        input.disabled = false;
                        input.readOnly = false;
                        lockIcon.style.pointerEvents = 'auto'; // allow unlocking
                    } else {
                        // Unlocked: fill with math
                        input.value = autoAmount.toFixed(2);

                        // MBWay Logic: If this is the LAST unlocked box, it absorbs the remainder 
                        // and CANNOT be edited (otherwise the math breaks against the Total fixo).
                        if (unlockedBoxes.length === 1) {
                            input.readOnly = true;
                            input.disabled = false;
                            input.style.opacity = '0.7'; // Indicate it's computed and locked
                            lockIcon.style.pointerEvents = 'none'; // Cannot manually lock the last derived value
                        } else {
                            input.readOnly = false;
                            input.disabled = false;
                            lockIcon.style.pointerEvents = 'auto';
                        }
                    }
                }
            });

            // Ensure cents add up perfectly for unlocked boxes (rounding fixes)
            if (unlockedBoxes.length > 0) {
                let distributedSoFar = 0;
                for (let i = 0; i < unlockedBoxes.length - 1; i++) {
                    const id = unlockedBoxes[i].value;
                    const roundedVal = parseFloat(autoAmount.toFixed(2));
                    document.querySelector(`.split-amount-input[data-id="${id}"]`).value = roundedVal.toFixed(2);
                    distributedSoFar += roundedVal;
                }
                // Last box absorbs the absolute difference
                const lastUnlockedId = unlockedBoxes[unlockedBoxes.length - 1].value;
                const exactRemainder = Math.max(0, remainingToDistribute - distributedSoFar);
                document.querySelector(`.split-amount-input[data-id="${lastUnlockedId}"]`).value = exactRemainder.toFixed(2);
            }
        };

        // Listeners for calc updates
        document.getElementById('group-expense-amount').addEventListener('input', (e) => calcSplits(e));
        document.querySelectorAll('.split-checkbox').forEach(cb => cb.addEventListener('change', calcSplits));
        document.querySelectorAll('.split-amount-input').forEach(inp => inp.addEventListener('input', calcSplits));
        // We use querySelectorAll here because it's called exactly once when opening the modal, after dynamic injection.
        document.querySelectorAll('.split-lock-icon').forEach(icon => icon.addEventListener('click', calcSplits));

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

        let sumSplits = 0;
        const splits = [];
        document.querySelectorAll('.split-checkbox:checked').forEach(cb => {
            const id = cb.value;
            const amt = parseFloat(document.querySelector(`.split-amount-input[data-id="${id}"]`).value) || 0;
            splits.push({ user_id: id, amount: amt });
            sumSplits += amt;
        });

        if (Math.abs(sumSplits - total) > 0.05) {
            return alert(`A soma das divisões (${sumSplits.toFixed(2)} €) não corresponde ao total exato da fatura (${total.toFixed(2)} €). Por favor, ajusta os valores.`);
        }

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

        // Obter infos para exibir e preencher formulário (limite robusto e leitura de avatar)
        supabaseClient.from('profiles').select('name, email, phone, avatar_url').eq('id', currentUser.id).limit(1)
            .then(({ data, error }) => {
                const profile = data && data.length > 0 ? data[0] : null;
                const displayEmail = profile?.email || currentUser.email;
                const displayName = profile?.name || displayEmail.split('@')[0];
                const displayPhone = profile?.phone || '';

                document.getElementById('account-name-header').textContent = displayName;
                document.getElementById('account-email').textContent = displayEmail;

                const avatarDiv = document.getElementById('account-avatar');
                if (profile?.avatar_url) {
                    avatarDiv.innerHTML = '';
                    avatarDiv.style.backgroundImage = `url('${profile.avatar_url}')`;
                } else {
                    avatarDiv.innerHTML = displayName.charAt(0).toUpperCase();
                    avatarDiv.style.backgroundImage = 'none';
                }

                // Preencher formulário de perfil
                const nameInput = document.getElementById('profile-name');
                const phoneInput = document.getElementById('profile-phone');
                if (nameInput) nameInput.value = profile?.name || '';
                if (phoneInput) phoneInput.value = displayPhone;
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

        // Configurar o botão de guardar perfil (apenas uma vez para evitar leaks)
        const profileForm = document.getElementById('profile-form');
        if (profileForm) {
            // Remove previous listeners stringing by replacing element
            const newForm = profileForm.cloneNode(true);
            profileForm.parentNode.replaceChild(newForm, profileForm);

            newForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const btn = document.getElementById('profile-save-btn');
                const oldText = btn.textContent;
                btn.textContent = "...";
                btn.disabled = true;

                const nameVal = document.getElementById('profile-name').value;
                const phoneVal = document.getElementById('profile-phone').value;

                const { error } = await supabaseClient.from('profiles').update({
                    name: nameVal,
                    phone: phoneVal
                }).eq('id', currentUser.id);

                if (error) {
                    alert(`${t('js_err_save')} ${error.message}`);
                } else {
                    document.getElementById('account-name-header').textContent = nameVal || currentUser.email;

                    // Only update the initial character if there is no image set
                    const avatarDiv = document.getElementById('account-avatar');
                    if (!avatarDiv.style.backgroundImage || avatarDiv.style.backgroundImage === 'none') {
                        avatarDiv.textContent = (nameVal || currentUser.email).charAt(0).toUpperCase();
                    }
                }

                btn.textContent = oldText;
                btn.disabled = false;
            });
        }

        // Configurar o botão de Upload de Avatar
        const avatarInput = document.getElementById('avatar-upload');
        if (avatarInput) {
            const newAvatarInput = avatarInput.cloneNode(true);
            avatarInput.parentNode.replaceChild(newAvatarInput, avatarInput);

            newAvatarInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                const avatarDiv = document.getElementById('account-avatar');
                const oldContent = avatarDiv.innerHTML;
                const oldBg = avatarDiv.style.backgroundImage;

                // Loading UI state
                avatarDiv.style.backgroundImage = 'none';
                avatarDiv.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size: 20px;"></i>';

                const fileExt = file.name.split('.').pop();
                const fileName = `${currentUser.id}/avatar.${fileExt}`;

                try {
                    // Importante: A DB precisa de ter uma Storage Bucket "avatars" pública ativada
                    const { error: uploadError } = await supabaseClient.storage.from('avatars').upload(fileName, file, { upsert: true });
                    if (uploadError) throw uploadError;

                    const { data: publicUrlData } = supabaseClient.storage.from('avatars').getPublicUrl(fileName);
                    const avatarUrl = publicUrlData.publicUrl + '?t=' + new Date().getTime(); // Forçar refresh da cache do browser

                    const { error: updateError } = await supabaseClient.from('profiles').update({ avatar_url: avatarUrl }).eq('id', currentUser.id);
                    if (updateError) throw updateError;

                    avatarDiv.innerHTML = '';
                    avatarDiv.style.backgroundImage = `url('${avatarUrl}')`;

                } catch (err) {
                    console.error(err);
                    alert(`${t('js_err_save')} Imagem de Capa (${err.message})`);
                    avatarDiv.innerHTML = oldContent;
                    avatarDiv.style.backgroundImage = oldBg;
                }
            });
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

    // Get groups via group_members sorted by join date to determine primary free group
    const { data: members, error } = await supabaseClient
        .from('group_members')
        .select(`
            group_id,
            joined_at,
            groups ( id, name, created_by )
        `)
        .eq('user_id', currentUser.id)
        .order('joined_at', { ascending: true });

    if (error || !members || members.length === 0) {
        list.innerHTML = `<div style="text-align:center; padding:20px; border:1px dashed var(--border); border-radius:12px; color:var(--text-dim);">${t('js_no_groups')}</div>`;
        return;
    }

    list.innerHTML = '';
    members.forEach((m, index) => {
        const g = m.groups;
        const role = g.created_by === currentUser.id ? t('js_creator') : t('js_member');

        // Graceful downgrade: Lock extra groups if user loses PRO status
        const isLocked = !currentUser.is_pro && index > 0;

        const lockBadge = isLocked ? `<div style="font-size:11px; font-weight:700; background:rgba(229,49,112,0.15); color:var(--danger); padding:4px 8px; border-radius:12px; letter-spacing:0.5px;"><i class="fas fa-lock" style="margin-right:4px;"></i>${t('pro_locked_badge')}</div>` : '';
        const opacity = isLocked ? 'opacity: 0.5; filter: grayscale(50%);' : '';
        const clickAction = isLocked ? `showLockedGroupAlert()` : `openGroupDetail('${g.id}', '${g.name}')`;

        list.innerHTML += `
            <div class="group-item" style="${opacity}" onclick="${clickAction}">
                <div>
                    <div class="group-name" style="margin-bottom:2px;">${g.name}</div>
                    <div class="group-role">${role}</div>
                </div>
                ${isLocked ? lockBadge : '<i class="fas fa-chevron-right" style="color:var(--text-muted);"></i>'}
            </div>
        `;
    });
}

window.showLockedGroupAlert = function () {
    alert(t('pro_locked_group_alert'));
    showPaywall();
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
        .select('profiles(id, name, email, avatar_url)')
        .eq('group_id', groupId);

    currentGroupMembers = members || [];
    const membersList = document.getElementById('group-members-list');
    membersList.innerHTML = '';

    const profileMap = {};
    currentGroupMembers.forEach(m => {
        profileMap[m.profiles.id] = m.profiles;

        // Handle avatar UI (image vs text initial)
        const hasAvatar = m.profiles.avatar_url;
        const bgStyle = hasAvatar ? `background-image:url('${m.profiles.avatar_url}'); background-size:cover; background-position:center;` : '';
        const initialStr = hasAvatar ? '' : (m.profiles.name || m.profiles.email).charAt(0).toUpperCase();

        membersList.innerHTML += `
            <div class="member-item">
                <div class="member-avatar" style="${bgStyle}">${initialStr}</div>
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
            paid_by
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
            let paidByName = t('js_someone');
            if (e.paid_by === currentUser.id) paidByName = t('js_you');
            else if (profileMap[e.paid_by]) paidByName = profileMap[e.paid_by].name || profileMap[e.paid_by].email;

            expensesList.innerHTML += `
                <div class="expense-item">
                    <div class="expense-item-left">
                        <div class="expense-item-cat" style="background:#4a4e6922">🤝</div>
                        <div>
                            <div class="expense-item-desc">${e.description}</div>
                            <div class="expense-item-recurring">${t('js_paid_by')} ${paidByName} (${e.date})</div>
                        </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <div class="expense-item-amount">${e.amount.toFixed(2)} €</div>
                        ${e.paid_by === currentUser.id ? `<button onclick="deleteGroupExpense('${e.id}')" class="btn-small" style="background:transparent; border:none; font-size:16px;">🗑️</button>` : ''}
                    </div>
                </div>
            `;
        });
    }
}

window.deleteGroupExpense = async function (expenseId) {
    if (confirm(t('js_confirm_delete'))) {
        const { error } = await supabaseClient.rpc('delete_group_expense', {
            p_group_id: currentGroup.id,
            p_expense_id: expenseId
        });
        if (error) alert("Erro ao apagar despesa de grupo: " + error.message);
        else loadGroupDetail(currentGroup.id);
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
