/* ================================================================
   GESTOR DE DESPESAS — Application Logic (v2)
   ================================================================ */

// --- Toast Notification System ---
function showToast(message, type = 'error', duration = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) { alert(message); return; }

    const icons = { error: '<i class="fas fa-times-circle"></i>', success: '<i class="fas fa-check-circle"></i>', warning: '<i class="fas fa-exclamation-triangle"></i>', info: '<i class="fas fa-info-circle"></i>' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.style.setProperty('--toast-duration', `${duration}ms`);
    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <div class="toast-body"><div class="toast-msg">${message}</div></div>
        <button class="toast-close" onclick="this.closest('.toast').remove()">✕</button>
        <div class="toast-progress"></div>
    `;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('removing');
        toast.addEventListener('animationend', () => toast.remove());
    }, duration);
}

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
    setupGroupTabsSwipe();
    setupExpenseForm();
    setupDeleteModal();
    setupCategoryForm();
    setupSummaryNav();
    setupExport();
    setupSearch();
    setupServiceWorker();

    renderCalendar();
    renderCategories();
    updateExportDates();
});

// --- UI Utils ---
window.setButtonLoading = function (btn, isLoading, loadingText = '') {
    if (!btn) return;
    if (isLoading) {
        btn.disabled = true;
        btn.dataset.originalHtml = btn.innerHTML;
        btn.innerHTML = `<span class="btn-loading-content"><i class="fas fa-spinner spin-anim"></i> ${loadingText || ''}</span>`;
        btn.classList.add('btn-loading');
    } else {
        btn.disabled = false;
        if (btn.dataset.originalHtml) {
            btn.innerHTML = btn.dataset.originalHtml;
        }
        btn.classList.remove('btn-loading');
    }
};

// ============================================
// NAVIGATION
// ============================================

let navigationStack = ['calendar']; // Track screen history
let isNavigatingBack = false; // Prevent double-push during popstate

function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => navigateTo(btn.dataset.screen));
    });
    document.querySelectorAll('.back-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // Use browser back for back-btn clicks (triggers popstate)
            if (navigationStack.length > 1) {
                history.back();
            } else {
                navigateTo(btn.dataset.screen);
            }
        });
    });
    document.getElementById('fab-add').addEventListener('click', () => openAddExpense(selectedDayDate));

    // Set initial state
    history.replaceState({ screen: 'calendar' }, '', '');

    // Handle Android/iOS back button
    window.addEventListener('popstate', (e) => {
        isNavigatingBack = true;
        if (e.state && e.state.screen) {
            showScreen(e.state.screen);
            // Remove current from stack
            if (navigationStack.length > 1) navigationStack.pop();
        } else {
            // At root — push state again to prevent app close
            showScreen('calendar');
            navigationStack = ['calendar'];
            history.pushState({ screen: 'calendar' }, '', '');
        }
        isNavigatingBack = false;
    });
}

// Internal: just show the screen without touching history
function showScreen(screenId) {
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

function navigateTo(screenId) {
    showScreen(screenId);

    // Push to browser history (unless we're handling popstate)
    if (!isNavigatingBack) {
        // For main tabs, reset stack to just have the tab
        const mainTabs = ['calendar', 'categories', 'summary', 'groups', 'account'];
        if (mainTabs.includes(screenId)) {
            navigationStack = [screenId];
        } else {
            navigationStack.push(screenId);
        }
        history.pushState({ screen: screenId }, '', '');
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

// Refresh the day detail modal if it's currently open
async function refreshDayDetail() {
    if (!selectedDayDate) return;
    const detail = document.getElementById('day-detail');
    if (detail.classList.contains('hidden')) return;
    const expenses = await db.getExpensesWithRecurring(parseInt(selectedDayDate.split('-')[0]), parseInt(selectedDayDate.split('-')[1]) - 1);
    const dayExpenses = expenses.filter(e => e.date === selectedDayDate);
    if (dayExpenses.length === 0) {
        closeDayDetail();
    } else {
        showDayDetail(selectedDayDate, dayExpenses);
    }
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

// --- Swipe para trocar separadores de grupo ---
function setupGroupTabsSwipe() {
    const screen = document.getElementById('screen-group-detail');
    if (!screen) return;

    screen.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }, { passive: true });

    screen.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;

        // Only trigger if horizontal swipe is dominant and big enough
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            const tabs = document.querySelectorAll('.group-tab');
            if (tabs.length !== 2) return;

            // Check which tab is currently active
            const isExpensesActive = tabs[0].classList.contains('active');

            if (dx < 0 && isExpensesActive) {
                // swipe left (while on expenses) → go to balances
                tabs[1].click();
            } else if (dx > 0 && !isExpensesActive) {
                // swipe right (while on balances) → go to expenses
                tabs[0].click();
            }
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
            ${recurringLabel ? `<div class="expense-item-recurring"><i class="fas fa-sync-alt" style="font-size:11px; color:#32b3ff; margin-right:3px;"></i> ${recurringLabel}${isProjected ? ' (auto)' : ''}</div>` : ''}
        </div>
      </div>
      <div class="expense-item-amount">${formatCurrency(expense.amount)}</div>
    `;

        if (!expense.isGroupExpense) {
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
    document.getElementById('expense-recurring').checked = false;
    document.getElementById('delete-btn').classList.add('hidden');
    document.getElementById('recurring-options').classList.add('hidden');
    hideAllRecurringConfigs();

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
        chip.innerHTML = `<span>${cat.icon}</span> ${tc(cat.name)}`;
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
            showToast('Seleciona pelo menos um dia da semana para a repetição semanal.', 'warning');
            return;
        }
    }

    const btn = document.getElementById('expense-form').querySelector('button[type="submit"]');
    setButtonLoading(btn, true, t('js_btn_save') || 'Guardar');

    try {
        if (id && id !== 'undefined' && id !== 'null') {
            expense.id = parseInt(id);
            // Preserve essential cloud and recurring metadata
            if (editingExpense) {
                if (editingExpense.cloud_id) expense.cloud_id = editingExpense.cloud_id;
                if (editingExpense.cloud_parent_id) expense.cloud_parent_id = editingExpense.cloud_parent_id;
                if (editingExpense.parentId) expense.parentId = editingExpense.parentId;
                if (editingExpense.created_at) expense.created_at = editingExpense.created_at;
                if (editingExpense.is_deleted !== undefined) expense.is_deleted = editingExpense.is_deleted;
                if (editingExpense.nextOccurrence) expense.nextOccurrence = editingExpense.nextOccurrence;
                if (editingExpense.recurringUntil) expense.recurringUntil = editingExpense.recurringUntil;
            }
            await db.updateExpense(expense);
        } else {
            if (editingExpense) {
                // We are materializing a projected recurring occurrence
                expense.parentId = editingExpense.parentId || editingExpense.id;
                expense.cloud_parent_id = editingExpense.cloud_parent_id || editingExpense.cloud_id;
            }
            await db.addExpense(expense);
        }

        if (isRecurring) await db.processRecurring();
    } catch (err) {
        console.error("Error saving expense:", err);
        showToast("Erro ao guardar despesa.", "error");
        setButtonLoading(btn, false);
        return;
    }

    setButtonLoading(btn, false);
    syncExpenses();

    // Refresh UI list if on calendar
    if (selectedDayDate) {
        const expenses = await db.getExpensesWithRecurring(currentYear, currentMonth);
        const dayExpenses = expenses.filter(e => e.date === selectedDayDate);
        showDayDetail(selectedDayDate, dayExpenses);
    }

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
    document.getElementById('confirm-cancel-btn').addEventListener('click', () => {
        document.getElementById('confirm-modal').classList.add('hidden');
    });

    document.getElementById('delete-one-btn').addEventListener('click', async () => {
        if (editingExpense) {
            const isRecurringRelated = editingExpense.isRecurring || editingExpense.parentId || editingExpense.cloud_parent_id;

            if (isRecurringRelated) {
                const parentId = editingExpense.parentId || editingExpense.id;
                await db.deleteRecurringAndChildren(parentId, editingExpense.date, true);
                await db.processRecurring();
            } else {
                await db.deleteExpense(editingExpense.id);
            }

            syncExpenses();
            closeDayDetail();
            renderCalendar();
            if (document.getElementById('screen-categories').classList.contains('active')) {
                renderCategories();
            }
            navigateTo('calendar');
        }
        document.getElementById('delete-modal').classList.add('hidden');
    });
    document.getElementById('delete-from-btn').addEventListener('click', async () => {
        if (editingExpense) {
            const parentId = editingExpense.parentId || editingExpense.id;
            console.log('Deleting from date:', editingExpense.date, 'parentId:', parentId);
            await db.deleteRecurringAndChildren(parentId, editingExpense.date);
            await db.processRecurring();
            syncExpenses();
            closeDayDetail();
            renderCalendar();
            if (document.getElementById('screen-categories').classList.contains('active')) {
                renderCategories();
            }
            navigateTo('calendar');
        }
        document.getElementById('delete-modal').classList.add('hidden');
    });
    document.getElementById('delete-all-btn').addEventListener('click', async () => {
        if (editingExpense) {
            const parentId = editingExpense.parentId || editingExpense.id;
            console.log('Deleting all for parentId:', parentId);
            await db.deleteRecurringAndChildren(parentId);
            await db.processRecurring();
            syncExpenses();
            closeDayDetail();
            renderCalendar();
            if (document.getElementById('screen-categories').classList.contains('active')) {
                renderCategories();
            }
            navigateTo('calendar');
        }
        document.getElementById('delete-modal').classList.add('hidden');
    });
}

function handleDelete() {
    if (!editingExpense) return;

    // Check if this expense is recurring or a child of a recurring expense (local or cloud)
    const isRecurringRelated = editingExpense.isRecurring || editingExpense.parentId || editingExpense.cloud_parent_id;

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
        showConfirm(t('delete_expense_title'), t('js_confirm_delete'), async () => {
            await db.deleteExpense(editingExpense.id);
            syncExpenses();
            closeDayDetail();
            renderCalendar();
            if (document.getElementById('screen-categories').classList.contains('active')) {
                renderCategories();
            }
            navigateTo('calendar');
        });
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
    // Fetch this month's expenses (including projected recurring ones) to compare against monthly budgets
    const allExpenses = await db.getExpensesWithRecurring(currentYear, currentMonth);
    const list = document.getElementById('categories-list');
    list.innerHTML = '';

    const isPro = currentUser?.is_pro;

    categoriesCache.forEach(cat => {
        const catExpenses = allExpenses.filter(e => String(e.categoryId) === String(cat.id));
        const count = catExpenses.length;
        const total = catExpenses.reduce((sum, e) => sum + e.amount, 0);

        const item = document.createElement('div');
        item.className = 'category-item';

        let budgetHtml = '';
        if (isPro) {
            budgetHtml = `
            <div style="display:flex; align-items:center; gap:6px; margin-top:4px;">
                <span style="font-size:14px; color:var(--accent);"><i class="fas fa-piggy-bank"></i></span>
                <input type="number" step="1" min="0" placeholder="${t('budget_placeholder') || 'Orçamento'}"
                    class="budget-input" data-cat-id="${cat.id}"
                    value="${cat.budget || ''}"
                    style="width:80px; padding:3px 6px; border-radius:6px; border:1px solid var(--border); background:var(--bg-input); color:var(--text); font-size:11px; text-align:right;">
                <span style="font-size:11px; color:var(--text-muted);">${t('js_budget_per_month')}</span>
            </div>`;
        }

        item.innerHTML = `
      <div class="category-item-left">
        <div class="category-item-icon" style="background:${cat.color}22">${cat.icon}</div>
        <div>
          <div class="category-item-name">${tc(cat.name)}</div>
          <div class="category-item-count">${count} ${t('js_expenses_count')} · ${formatCurrency(total)}</div>
          ${budgetHtml}
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:6px;">
        <button class="category-edit-btn" data-id="${cat.id}" title="${t('js_edit_cat')}" style="background:none; border:none; cursor:pointer; font-size:16px; padding:4px; color:var(--text-dim);"><i class="fas fa-pen"></i></button>
        <button class="category-delete-btn" data-id="${cat.id}" title="Eliminar" style="background:none; border:none; cursor:pointer; font-size:16px; padding:4px;"><i class="fas fa-trash-alt" style="color:var(--danger);"></i></button>
      </div>
    `;
        list.appendChild(item);
    });

    // Delete handlers
    list.querySelectorAll('.category-delete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = parseInt(btn.dataset.id);
            showConfirm(t('btn_delete'), t('js_confirm_delete_cat'), async () => {
                await db.deleteCategory(id);
                renderCategories();
                renderCalendar();
            });
        });
    });

    // Edit handlers
    list.querySelectorAll('.category-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = parseInt(btn.dataset.id);
            const cat = categoriesCache.find(c => c.id === id);
            if (!cat) return;

            const item = btn.closest('.category-item');
            const originalHtml = item.innerHTML;

            item.innerHTML = `
              <div style="display:flex; flex-direction:column; gap:8px; width:100%; padding:4px 0;">
                <div style="display:flex; gap:8px; align-items:center;">
                  <input type="text" class="edit-cat-icon" value="${cat.icon}" style="width:44px; text-align:center; font-size:20px; padding:6px; border-radius:8px; border:1px solid var(--border); background:var(--bg-input); color:var(--text);" maxlength="4">
                  <input type="text" class="edit-cat-name" value="${cat.name}" style="flex:1; padding:8px 12px; border-radius:8px; border:1px solid var(--border); background:var(--bg-input); color:var(--text); font-size:14px;">
                  <input type="color" class="edit-cat-color" value="${cat.color}" style="width:36px; height:36px; border:none; border-radius:8px; cursor:pointer; padding:0;">
                </div>
                <div style="display:flex; gap:8px; justify-content:flex-end;">
                  <button class="edit-cat-cancel btn-small" style="padding:6px 14px; border-radius:8px; background:transparent; border:1px solid var(--border); color:var(--text-dim); font-size:12px; cursor:pointer;">${t('btn_cancel')}</button>
                  <button class="edit-cat-save btn-small" style="padding:6px 14px; border-radius:8px; background:var(--accent); border:none; color:white; font-size:12px; font-weight:600; cursor:pointer;">${t('btn_save')}</button>
                </div>
              </div>
            `;

            item.querySelector('.edit-cat-cancel').addEventListener('click', () => {
                item.innerHTML = originalHtml;
                // Re-attach handlers
                renderCategories();
            });

            item.querySelector('.edit-cat-save').addEventListener('click', async () => {
                const newName = item.querySelector('.edit-cat-name').value.trim();
                const newIcon = item.querySelector('.edit-cat-icon').value.trim() || '🏷️';
                const newColor = item.querySelector('.edit-cat-color').value;

                if (!newName) return;
                const oldName = cat.name;

                cat.name = newName;
                cat.icon = newIcon;
                cat.color = newColor;
                await db.updateCategory(cat);

                if (currentUser) {
                    supabaseClient.from('user_categories').update({
                        name: newName, icon: newIcon, color: newColor
                    }).eq('user_id', currentUser.id).eq('name', oldName).then(() => { });
                }

                categoriesCache = await db.getAllCategories();
                renderCategories();
                renderCalendar();
            });
        });
    });

    // Budget input handlers (debounced save)
    list.querySelectorAll('.budget-input').forEach(input => {
        let saveTimeout;
        input.addEventListener('input', () => {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(async () => {
                const catId = parseInt(input.dataset.catId);
                const cat = categoriesCache.find(c => c.id === catId);
                if (cat) {
                    const val = parseFloat(input.value);
                    cat.budget = isNaN(val) ? null : val;
                    await db.updateCategory(cat);

                    if (currentUser) {
                        supabaseClient.from('user_categories').update({ budget: cat.budget })
                            .eq('user_id', currentUser.id)
                            .eq('name', cat.name)
                            .then(() => { });
                    }
                }
            }, 500);
        });
    });

    // Render Recurring Expenses List
    const recurringList = document.getElementById('recurring-expenses-list');
    if (recurringList) {
        recurringList.innerHTML = '';
        const allDbExpenses = await db.getAllExpenses();
        const activeRecurring = allDbExpenses.filter(e => e.isRecurring && e.recurringType && e.recurringType !== 'none');

        if (activeRecurring.length === 0) {
            recurringList.innerHTML = `<div style="text-align:center; padding: 20px; color: var(--text-dim); font-size: 13px;" data-i18n="no_recurring">Não existem despesas recorrentes ativas.</div>`;
        } else {
            activeRecurring.forEach(expense => {
                const cat = categoriesCache.find(c => String(c.id) === String(expense.categoryId)) || { icon: '💰', name: t('js_others') || 'Outros', color: '#666' };
                const item = document.createElement('div');
                item.className = 'category-item';

                let freqText = '';
                if (expense.recurringType === 'daily') freqText = t('js_daily') || 'Diário';
                else if (expense.recurringType === 'weekly') freqText = t('js_weekly') || 'Semanal';
                else if (expense.recurringType === 'monthly') freqText = t('js_monthly') || 'Mensal';
                else if (expense.recurringType === 'yearly') freqText = t('js_yearly') || 'Anual';

                item.innerHTML = `
                  <div class="category-item-left" style="cursor: pointer; flex: 1;">
                    <div class="category-item-icon" style="background:${cat.color}22; font-size:18px;">${cat.icon}</div>
                    <div style="flex:1;">
                      <div class="category-item-name" style="font-size:14px;">${expense.description || tc(cat.name)}</div>
                      <div class="category-item-count" style="color: var(--accent-light); font-weight: 600; font-size: 11px;">
                        <i class="fas fa-sync-alt" style="font-size:9px; color:#32b3ff; margin-right:3px;"></i> ${freqText} · ${formatCurrency(expense.amount)}
                      </div>
                      <div style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">Início: ${expense.date.split('-').reverse().join('/')}</div>
                    </div>
                  </div>
                  <button class="category-delete-btn recurring-delete-btn" data-id="${expense.id}" title="Eliminar Recorrência"><i class="fas fa-trash-alt" style="color:var(--danger);"></i></button>
                `;
                recurringList.appendChild(item);

                // Click to edit
                item.querySelector('.category-item-left').addEventListener('click', () => {
                    openAddExpense(expense.date, expense.id);
                });

                // Click to delete
                item.querySelector('.recurring-delete-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    editingExpense = expense;
                    handleDelete();
                });
            });
        }
    }
}

async function addCategory() {
    const extraCats = parseInt(currentUser?.ad_rewards?.categories_extra || 0);
    if (!currentUser?.is_pro && categoriesCache.length >= (8 + extraCats)) {
        showConfirm(
            t('cat_limit_title') || 'Limite de Categorias',
            t('cat_limit_desc') || 'Vê um anúncio para criar mais uma categoria, ou faz upgrade para Premium.',
            () => showRewardedAd('category', () => addCategory())
        );
        return;
    }
    const name = document.getElementById('new-cat-name').value.trim();
    const icon = document.getElementById('new-cat-icon').value.trim() || '🏷️';
    const color = document.getElementById('new-cat-color').value;
    if (!name) return;
    try {
        if (categoriesCache.find(c => c.name.toLowerCase() === name.toLowerCase())) {
            showToast(t('js_cat_exists'), 'warning');
            return;
        }
        await db.addCategory({ name, icon, color });
        document.getElementById('new-cat-name').value = '';
        document.getElementById('new-cat-icon').value = '';

        if (currentUser) {
            supabaseClient.from('user_categories').insert({
                user_id: currentUser.id,
                name, icon, color
            }).then(() => { });
        }

        categoriesCache = await db.getAllCategories();
        renderCategories();
    } catch { showToast('Erro ao adicionar categoria.'); }
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

    // Swipe on summary screen
    const summaryScreen = document.getElementById('screen-summary');
    let sTouchStartX = 0, sTouchStartY = 0;
    summaryScreen.addEventListener('touchstart', (e) => {
        sTouchStartX = e.touches[0].clientX;
        sTouchStartY = e.touches[0].clientY;
    }, { passive: true });
    summaryScreen.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].clientX - sTouchStartX;
        const dy = e.changedTouches[0].clientY - sTouchStartY;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            if (dx > 0) {
                summaryMonth--;
                if (summaryMonth < 0) { summaryMonth = 11; summaryYear--; }
            } else {
                summaryMonth++;
                if (summaryMonth > 11) { summaryMonth = 0; summaryYear++; }
            }
            renderSummary();
        }
    }, { passive: true });
}

async function renderSummary() {
    document.getElementById('summary-month-label').textContent = `${getMonthNames()[summaryMonth]} ${summaryYear}`;

    // Parallel fetch: current + previous month data
    let prevMonth = summaryMonth - 1;
    let prevYear = summaryYear;
    if (prevMonth < 0) { prevMonth = 11; prevYear--; }

    const [localExpenses, groupExpenses, prevLocalExpenses, prevGroupExpenses, categories] = await Promise.all([
        db.getExpensesWithRecurring(summaryYear, summaryMonth),
        fetchGroupExpensesForMonth(summaryYear, summaryMonth),
        db.getExpensesWithRecurring(prevYear, prevMonth),
        fetchGroupExpensesForMonth(prevYear, prevMonth),
        db.getAllCategories()
    ]);

    const allExpenses = [...localExpenses, ...groupExpenses];
    categoriesCache = categories;

    // Only count expenses up to today — future projected ones should not count
    // Use local date to avoid UTC mismatch near midnight
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const isFutureMonth = (summaryYear > now.getFullYear()) || (summaryYear === now.getFullYear() && summaryMonth > now.getMonth());
    const isCurrentMonth = (summaryYear === now.getFullYear() && summaryMonth === now.getMonth());
    // Past months: show everything. Current/future months: only up to today.
    const expenses = (isCurrentMonth || isFutureMonth) ? allExpenses.filter(e => e.date <= today) : allExpenses;

    const total = expenses.reduce((sum, e) => sum + e.amount, 0);
    document.getElementById('summary-total').textContent = formatCurrency(total);

    // --- Month-over-Month Comparison ---
    const prevExpenses = [...prevLocalExpenses, ...prevGroupExpenses];
    const prevTotal = prevExpenses.reduce((sum, e) => sum + e.amount, 0);

    const prevByCat = {};
    prevExpenses.forEach(e => {
        let cid = String(e.categoryId);
        if (!cid.startsWith('group_expense_') && !categoriesCache.some(c => String(c.id) === cid)) {
            const fallbackCat = categoriesCache.find(c => c.name.toLowerCase() === 'outros' || c.name.toLowerCase() === 'others');
            cid = fallbackCat ? String(fallbackCat.id) : 'fallback';
        }
        if (!prevByCat[cid]) prevByCat[cid] = 0;
        prevByCat[cid] += e.amount;
    });

    const comparisonEl = document.getElementById('summary-comparison');
    if (comparisonEl) {
        if (prevTotal > 0 && total > 0) {
            const deltaPercent = Number(((total - prevTotal) / prevTotal * 100).toFixed(0));
            const deltaSign = deltaPercent > 0 ? '+' : '';
            const deltaColor = deltaPercent > 0 ? 'var(--danger)' : deltaPercent < 0 ? 'var(--success)' : 'var(--text-muted)';
            const arrow = deltaPercent > 0 ? '↑' : deltaPercent < 0 ? '↓' : '≈';
            comparisonEl.innerHTML = `<span style="color:${deltaColor}; font-weight:700; font-size:13px;">${arrow} ${deltaSign}${deltaPercent}% <span style="font-weight:400; color:var(--text-muted);">${t('vs_last_month') || 'vs mês anterior'}</span></span>`;
            comparisonEl.classList.remove('hidden');
        } else if (total > 0 && prevTotal === 0) {
            comparisonEl.innerHTML = `<span style="color:var(--text-muted); font-size:12px;">${t('no_prev_data') || 'Sem dados do mês anterior'}</span>`;
            comparisonEl.classList.remove('hidden');
        } else {
            comparisonEl.classList.add('hidden');
        }
    }

    const byCat = {};
    expenses.forEach(e => {
        let cid = String(e.categoryId);
        if (!cid.startsWith('group_expense_') && !categoriesCache.some(c => String(c.id) === cid)) {
            const fallbackCat = categoriesCache.find(c => c.name.toLowerCase() === 'outros' || c.name.toLowerCase() === 'others');
            cid = fallbackCat ? String(fallbackCat.id) : 'fallback';
        }
        if (!byCat[cid]) byCat[cid] = 0;
        byCat[cid] += e.amount;
    });

    const sorted = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    const maxAmount = sorted.length > 0 ? sorted[0][1] : 1;

    // --- Build chart HTML as a single string (batch, no reflows) ---
    const chart = document.getElementById('summary-chart');
    let chartHtml = '';

    sorted.forEach(([catId, amount], index) => {
        let cat;
        if (String(catId).startsWith('group_expense_')) {
            const groupNameText = catId.substring('group_expense_'.length);
            // Basic color palette for distinct groups
            const groupColors = ['#7f5af0', '#2cb67d', '#ef476f', '#ffd166', '#118ab2', '#073b4c'];
            const color = groupColors[index % groupColors.length];
            cat = { icon: '👥', name: groupNameText, color: color };
        } else {
            cat = categoriesCache.find(c => String(c.id) === String(catId)) || { icon: '💰', name: t('js_others'), color: '#666' };
        }

        const pct = (amount / maxAmount) * 100;
        const percentOfTotal = ((amount / total) * 100).toFixed(1);

        // Budget indicator
        let budgetBadge = '';
        if (currentUser?.is_pro && cat.budget && cat.budget > 0) {
            const budgetPct = (amount / cat.budget) * 100;
            let badgeColor = 'var(--success)';
            let badgeLabel = `${budgetPct.toFixed(0)}%`;
            if (budgetPct >= 90) {
                badgeColor = 'var(--danger)';
                badgeLabel = budgetPct >= 100 ? `<i class="fas fa-exclamation-triangle"></i> ${budgetPct.toFixed(0)}%` : badgeLabel;
            } else if (budgetPct >= 70) {
                badgeColor = '#f0a500';
            }
            budgetBadge = `<div style="font-size:10px; color:${badgeColor}; font-weight:700; white-space:nowrap;">${badgeLabel} de ${cat.budget}€</div>`;
        }

        // Month-over-month per-category delta
        let catDelta = '';
        const prevAmt = prevByCat[catId] || 0;
        if (prevAmt > 0) {
            const catDeltaPct = ((amount - prevAmt) / prevAmt * 100).toFixed(0);
            if (Math.abs(catDeltaPct) >= 10) {
                const dColor = catDeltaPct > 0 ? 'var(--danger)' : 'var(--success)';
                const dArrow = catDeltaPct > 0 ? '↑' : '↓';
                const dSign = catDeltaPct > 0 ? '+' : '';
                catDelta = `<small style="color:${dColor}; font-size:10px;">${dArrow}${dSign}${catDeltaPct}%</small>`;
            }
        }

        chartHtml += `
      <div class="chart-bar-row">
        <div class="chart-label" style="flex-direction: column; align-items: flex-start; justify-content: center; gap: 2px;">
            <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 90px;">${cat.icon} ${tc(cat.name)}</div>
            ${budgetBadge}
        </div>
        <div class="chart-bar-bg">
          <div class="chart-bar-fill" style="width:${pct}%;background:${cat.color}"></div>
        </div>
        <div class="chart-bar-value">${formatCurrency(amount)}<br><small>${percentOfTotal}%</small> ${catDelta}</div>
      </div>
    `;
    });

    // Single DOM write (no reflows during loop)
    chart.innerHTML = chartHtml || '<p style="color:var(--text-muted);text-align:center;padding:20px;">Sem despesas neste mês.</p>';

    // --- PRO Charts: Deferred to next frame for better INP ---
    const donutSection = document.getElementById('summary-donut-section');
    const dailyTrend = document.getElementById('summary-daily-trend');
    const proHint = document.getElementById('summary-pro-hint');

    if (currentUser?.is_pro && sorted.length > 0) {
        if (donutSection) donutSection.classList.remove('hidden');
        if (dailyTrend) dailyTrend.classList.remove('hidden');
        if (proHint) proHint.classList.add('hidden');

        // Defer heavy SVG rendering to next animation frame
        requestAnimationFrame(() => {
            // --- Donut Chart (SVG) ---
            const donutContainer = document.getElementById('summary-donut-chart');
            const legendContainer = document.getElementById('summary-donut-legend');
            if (donutContainer && legendContainer) {
                const radius = 50;
                const circumference = 2 * Math.PI * radius;
                let offset = 0;
                let arcs = '';
                let legendHtml = '';

                sorted.forEach(([catId, amount], index) => {
                    let cat;
                    if (String(catId).startsWith('group_expense_')) {
                        const groupNameText = catId.substring('group_expense_'.length);
                        const groupColors = ['#7f5af0', '#2cb67d', '#ef476f', '#ffd166', '#118ab2', '#073b4c'];
                        const color = groupColors[index % groupColors.length];
                        cat = { icon: '👥', name: groupNameText, color: color };
                    } else {
                        cat = categoriesCache.find(c => String(c.id) === String(catId)) || { icon: '💰', name: t('js_others'), color: '#666' };
                    }
                    const pct = amount / total;
                    const dashLen = pct * circumference;
                    const dashGap = circumference - dashLen;

                    arcs += `<circle cx="70" cy="70" r="${radius}" fill="none" stroke="${cat.color}" stroke-width="20"
                        stroke-dasharray="${dashLen} ${dashGap}" stroke-dashoffset="${-offset}"
                        transform="rotate(-90 70 70)" style="transition: all 0.5s ease;" />`;
                    offset += dashLen;

                    legendHtml += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;">
                        <span style="width:10px;height:10px;border-radius:50%;background:${cat.color};flex-shrink:0;"></span>
                        <span style="color:var(--text-dim);">${cat.icon} ${tc(cat.name)}</span>
                        <span style="color:var(--text);font-weight:600;margin-left:auto;">${((amount / total) * 100).toFixed(0)}%</span>
                    </div>`;
                });

                donutContainer.innerHTML = `<svg viewBox="0 0 140 140" style="width:100%;height:100%;">
                    <circle cx="70" cy="70" r="${radius}" fill="none" stroke="var(--border)" stroke-width="20"/>
                    ${arcs}
                    <text x="70" y="70" text-anchor="middle" dominant-baseline="central" fill="var(--text)" font-size="14" font-weight="800">${formatCurrency(total)}</text>
                </svg>`;
                legendContainer.innerHTML = legendHtml;
            }

            // --- Daily Trend (Mini Bar Chart) ---
            const trendContainer = document.getElementById('daily-trend-bars');
            if (trendContainer) {
                const lastDay = new Date(summaryYear, summaryMonth + 1, 0).getDate();
                const byDay = {};
                expenses.forEach(e => {
                    const day = parseInt(e.date.split('-')[2]);
                    if (!byDay[day]) byDay[day] = 0;
                    byDay[day] += e.amount;
                });

                const maxDay = Math.max(...Object.values(byDay), 1);
                let barsHtml = '';
                for (let d = 1; d <= lastDay; d++) {
                    const val = byDay[d] || 0;
                    const pct = (val / maxDay) * 100;
                    const barColor = val > 0 ? 'var(--accent)' : 'var(--border)';
                    const minH = val > 0 ? Math.max(pct, 5) : 3;
                    barsHtml += `<div title="Dia ${d}: ${val.toFixed(2)} €" style="flex:1;height:${minH}%;background:${barColor};border-radius:3px 3px 0 0;min-width:3px;transition:height 0.3s ease;cursor:pointer;"></div>`;
                }
                trendContainer.innerHTML = barsHtml;
            }
        });
    } else {
        if (donutSection) donutSection.classList.add('hidden');
        if (dailyTrend) dailyTrend.classList.add('hidden');
        if (proHint && sorted.length > 0) proHint.classList.remove('hidden');
        else if (proHint) proHint.classList.add('hidden');
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
        // Allow 1 free export per month via ad
        const exportsUsed = parseInt(currentUser?.ad_rewards?.exports_this_month || 0);
        if (exportsUsed <= 0) {
            showConfirm(
                t('export_locked_title') || 'Exportação PRO',
                t('export_locked_desc') || 'Vê um anúncio para exportar este mês, ou faz upgrade para Premium.',
                () => showRewardedAd('export', () => exportExcel())
            );
            return;
        }
    }
    const from = document.getElementById('export-from').value;
    const to = document.getElementById('export-to').value;

    if (!from || !to) { showToast(t('js_select_dates'), 'warning'); return; }

    const btn = document.getElementById('export-btn');
    setButtonLoading(btn, true, t('js_exporting') || 'A exportar...');

    const localExpenses = await db.getExpensesByDateRange(from, to);
    const groupExpenses = currentUser ? await fetchGroupExpensesForRange(from, to) : [];
    const expenses = [...localExpenses, ...groupExpenses];
    categoriesCache = await db.getAllCategories();
    categoriesCache.push({ id: 'group_expense', name: t('js_group_badge') || 'Grupo', icon: '👥', color: '#7f5af0' });

    if (expenses.length === 0) { setButtonLoading(btn, false); showToast(t('js_no_exp_period'), 'info'); return; }

    // --- Build Matrix 1: Daily (Selected Range) ---
    const dowNamesShort = ['Dom', '2F', '3F', '4F', '5F', '6F', 'Sáb'];
    const monthEnShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const daysInRange = [];
    const fromDateIter = new Date(from + 'T00:00:00');
    const toDateIter = new Date(to + 'T00:00:00');
    for (let d = new Date(fromDateIter); d <= toDateIter; d.setDate(d.getDate() + 1)) {
        daysInRange.push(new Date(d));
    }

    // Helper to standardize category names and prevent duplicates
    const getExportCatName = (e) => {
        if (e.isGroupExpense && e.groupName) return e.groupName;
        let cid = String(e.categoryId);
        let cat = categoriesCache.find(c => String(c.id) === cid);
        if (!cat) {
            cat = categoriesCache.find(c => c.name.toLowerCase() === 'outros' || c.name.toLowerCase() === 'others') || { name: t('js_others') || 'Outros' };
        }
        return tc(cat.name);
    };

    // Collect categories
    const catNames = new Set();
    expenses.forEach(e => {
        catNames.add(getExportCatName(e));
    });
    const categoryList = [...catNames].sort();

    // Matrix Daily
    const matrixDaily = {};
    categoryList.forEach(cn => matrixDaily[cn] = {});
    expenses.forEach(e => {
        const catName = getExportCatName(e);
        if (!matrixDaily[catName][e.date]) matrixDaily[catName][e.date] = 0;
        matrixDaily[catName][e.date] += e.amount;
    });

    const sheet1Data = [];
    const firstDay = daysInRange[0];
    const monthLabelCell = `${monthEnShort[firstDay.getMonth()]}/${String(firstDay.getFullYear()).slice(-2)}`;

    // Row 1: DOW
    const s1Row1 = ['', ''];
    daysInRange.forEach(d => s1Row1.push(dowNamesShort[d.getDay()]));
    s1Row1.push(''); // Total col empty header
    sheet1Data.push(s1Row1);

    // Row 2: MonthLabel + Dates + 'Total'
    const s1Row2 = ['', monthLabelCell];
    daysInRange.forEach(d => {
        const formattedDate = `${String(d.getDate()).padStart(2, '0')}-${monthEnShort[d.getMonth()]}`;
        s1Row2.push(formattedDate);
    });
    s1Row2.push('Total');
    sheet1Data.push(s1Row2);

    let s1GrandTotal = 0;
    const s1ColTotals = new Array(daysInRange.length).fill(0);

    categoryList.forEach(catName => {
        const row = ['', catName];
        let rowTotal = 0;
        daysInRange.forEach((d, i) => {
            const dateStr = d.toISOString().slice(0, 10);
            const val = matrixDaily[catName][dateStr] || 0;
            row.push(val > 0 ? parseFloat(val.toFixed(2)) : '');
            rowTotal += val;
            s1ColTotals[i] += val;
        });
        row.push(rowTotal > 0 ? parseFloat(rowTotal.toFixed(2)) : '');
        s1GrandTotal += rowTotal;
        sheet1Data.push(row);
    });

    // Padding rows to match template approx 20 rows
    const padding1 = Math.max(0, 20 - categoryList.length);
    for (let i = 0; i < padding1; i++) {
        const emptyRow = ['', ''];
        daysInRange.forEach(() => emptyRow.push(''));
        emptyRow.push('');
        sheet1Data.push(emptyRow);
    }

    // Total Row
    const s1RowTotalActual = ['', 'TOTAL'];
    s1ColTotals.forEach(ct => s1RowTotalActual.push(ct > 0 ? parseFloat(ct.toFixed(2)) : ''));
    s1RowTotalActual.push(parseFloat(s1GrandTotal.toFixed(2)));
    sheet1Data.push(s1RowTotalActual);


    // --- Build Matrix 2: Academic Year Summary ---
    const fromDateObj = new Date(from);
    let acadYearStart = fromDateObj.getFullYear();
    if (fromDateObj.getMonth() < 8) { acadYearStart--; }
    const acadYearEnd = acadYearStart + 1;

    const acadMonths = [
        { d: '09', short: 'Sep', year: acadYearStart, label: `Sep-${String(acadYearStart).slice(-2)}` },
        { d: '10', short: 'Oct', year: acadYearStart, label: `Oct-${String(acadYearStart).slice(-2)}` },
        { d: '11', short: 'Nov', year: acadYearStart, label: `Nov-${String(acadYearStart).slice(-2)}` },
        { d: '12', short: 'Dec', year: acadYearStart, label: `Dec-${String(acadYearStart).slice(-2)}` },
        { d: '01', short: 'Jan', year: acadYearEnd, label: `Jan-${String(acadYearEnd).slice(-2)}` },
        { d: '02', short: 'Feb', year: acadYearEnd, label: `Feb-${String(acadYearEnd).slice(-2)}` },
        { d: '03', short: 'Mar', year: acadYearEnd, label: `Mar-${String(acadYearEnd).slice(-2)}` },
        { d: '04', short: 'Apr', year: acadYearEnd, label: `Apr-${String(acadYearEnd).slice(-2)}` },
        { d: '05', short: 'May', year: acadYearEnd, label: `May-${String(acadYearEnd).slice(-2)}` },
        { d: '06', short: 'Jun', year: acadYearEnd, label: `Jun-${String(acadYearEnd).slice(-2)}` },
        { d: '07', short: 'Jul', year: acadYearEnd, label: `Jul-${String(acadYearEnd).slice(-2)}` },
        { d: '08', short: 'Aug', year: acadYearEnd, label: `Aug-${String(acadYearEnd).slice(-2)}` }
    ];

    const matrixMonthly = {};
    categoryList.forEach(cn => matrixMonthly[cn] = {});
    expenses.forEach(e => {
        const catName = getExportCatName(e);
        const dateObj = new Date(e.date + 'T00:00:00');
        const monthKey = e.date.substring(0, 7);
        if (!matrixMonthly[catName][monthKey]) matrixMonthly[catName][monthKey] = 0;
        matrixMonthly[catName][monthKey] += e.amount;
    });

    const sheet2Data = [];
    sheet2Data.push(['', '', '', 'Resumo Ano', '', '', '', '', '', '', '', '', '', '', 'Total']);

    const s2Row2 = ['', ''];
    acadMonths.forEach(m => s2Row2.push(m.label));
    s2Row2.push('Total');
    sheet2Data.push(s2Row2);

    let s2GrandTotal = 0;
    const s2ColTotals = new Array(12).fill(0);

    categoryList.forEach(catName => {
        const row = ['', catName];
        let rowTotal = 0;
        acadMonths.forEach((m, i) => {
            const key = `${m.year}-${m.d}`;
            const val = matrixMonthly[catName][key] || 0;
            // The template uses 0.00 for empty
            row.push(val > 0 ? parseFloat(val.toFixed(2)) : '0.00');
            rowTotal += val;
            s2ColTotals[i] += val;
        });
        row.push(parseFloat(rowTotal.toFixed(2)));
        s2GrandTotal += rowTotal;
        sheet2Data.push(row);
    });

    const padding2 = Math.max(0, 25 - categoryList.length);
    for (let i = 0; i < padding2; i++) {
        const emptyRow = ['', ''];
        acadMonths.forEach(() => emptyRow.push('0.00'));
        emptyRow.push('0.00');
        sheet2Data.push(emptyRow);
    }

    const s2RowTotal = ['', 'Totais'];
    s2ColTotals.forEach(ct => s2RowTotal.push(parseFloat(ct.toFixed(2))));
    s2RowTotal.push(parseFloat(s2GrandTotal.toFixed(2)));
    sheet2Data.push(s2RowTotal);

    // --- Create workbook ---
    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.aoa_to_sheet(sheet1Data);
    const ws2 = XLSX.utils.aoa_to_sheet(sheet2Data);

    // Set column widths matching template approximation
    const colWidths1 = [{ wch: 2 }, { wch: 22 }];
    daysInRange.forEach(() => colWidths1.push({ wch: 8 }));
    colWidths1.push({ wch: 10 });
    ws1['!cols'] = colWidths1;

    const colWidths2 = [{ wch: 10 }, { wch: 22 }];
    acadMonths.forEach(() => colWidths2.push({ wch: 10 }));
    colWidths2.push({ wch: 12 });
    ws2['!cols'] = colWidths2;

    const sheetName1 = `Despesas ${monthLabelCell.replace('/', ' ')}`;
    XLSX.utils.book_append_sheet(wb, ws1, sheetName1);
    XLSX.utils.book_append_sheet(wb, ws2, 'Resumo Ano');

    setButtonLoading(btn, false);

    // Mobile-compatible download using multiple strategies
    const filename = `despesas_${from}_${to}.xlsx`;
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    // Detect iOS
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    // Method 1: Web Share API (best for mobile — opens native share sheet)
    try {
        const file = new File([blob], filename, { type: blob.type });
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: 'Despesas' });
            return;
        }
    } catch (e) {
        // Share was cancelled or failed — fall through
        if (e.name === 'AbortError') return; // User cancelled share, don't try other methods
    }

    // Method 2: iOS Safari — open in new tab (programmatic <a>.click() is blocked)
    if (isIOS) {
        try {
            const url = URL.createObjectURL(blob);
            const newWindow = window.open(url, '_blank');
            if (!newWindow) {
                // Popup blocked — try direct location
                window.location.href = url;
            }
            setTimeout(() => URL.revokeObjectURL(url), 30000);
            return;
        } catch (e) {
            // Fall through to next method
        }
    }

    // Method 3: Standard Blob download (Android Chrome, desktop)
    try {
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
        }, 500);
    } catch (e) {
        // Method 4: XLSX writeFile fallback
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

/**
 * Custom styled confirmation modal
 */
function showConfirm(title, text, onConfirm) {
    document.getElementById('confirm-modal-title').textContent = title || t('confirm_title');
    document.getElementById('confirm-modal-text').textContent = text;

    // Clone button to clear previous listeners
    const okBtn = document.getElementById('confirm-ok-btn');
    const newOkBtn = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOkBtn, okBtn);

    newOkBtn.addEventListener('click', () => {
        document.getElementById('confirm-modal').classList.add('hidden');
        if (onConfirm) onConfirm();
    });

    document.getElementById('confirm-modal').classList.remove('hidden');
}

function formatCurrency(amount) {
    return amount.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

// ============================================
// STRIPE PAYWALL
// ============================================

function showPaywall() {
    const modal = document.getElementById('paywall-modal');
    if (modal) modal.classList.remove('hidden');
    // Reset to monthly by default when opening
    selectPlan('monthly');
}

// Plan toggle state
let selectedPlanPrice = 'price_1T6FvwCnM4wZXaMWsz4HUgGj'; // monthly default

function selectPlan(plan) {
    const monthlyBtn = document.getElementById('plan-monthly-btn');
    const yearlyBtn = document.getElementById('plan-yearly-btn');
    const upgradeBtn = document.getElementById('upgrade-btn');
    if (!monthlyBtn || !yearlyBtn) return;

    if (plan === 'yearly') {
        selectedPlanPrice = 'price_1T6KIRCnM4wZXaMWJoce5rd4';
        yearlyBtn.style.background = 'var(--accent)';
        yearlyBtn.style.color = 'white';
        monthlyBtn.style.background = 'transparent';
        monthlyBtn.style.color = 'var(--text-dim)';
        if (upgradeBtn) upgradeBtn.querySelector('span').textContent = t('btn_upgrade_yearly');
    } else {
        selectedPlanPrice = 'price_1T6FvwCnM4wZXaMWsz4HUgGj';
        monthlyBtn.style.background = 'var(--accent)';
        monthlyBtn.style.color = 'white';
        yearlyBtn.style.background = 'transparent';
        yearlyBtn.style.color = 'var(--text-dim)';
        if (upgradeBtn) upgradeBtn.querySelector('span').textContent = t('btn_upgrade_monthly');
    }
}

async function createCheckoutSession(couponCode = null) {
    if (!currentUser) return;
    const btn = document.getElementById('upgrade-btn');
    const oldText = btn.textContent;
    btn.textContent = "A redirecionar...";
    btn.disabled = true;

    try {
        const body = {
            userId: currentUser.id,
            email: currentUser.email,
            priceId: selectedPlanPrice
        };
        if (couponCode) body.coupon = couponCode;

        const response = await fetch('/api/create-checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const data = await response.json();
        if (data.url) {
            window.location.href = data.url;
        } else {
            showToast('Não foi possível iniciar o pagamento. Tenta novamente mais tarde.');
            btn.textContent = oldText;
            btn.disabled = false;
        }
    } catch (err) {
        console.error(err);
        showToast('Erro ao ligar ao servidor de pagamentos.');
        btn.textContent = oldText;
        btn.disabled = false;
    }
}

// ============================================
// POST-TRIAL FLASH SALE (48h discount)
// ============================================
function showPostTrialOffer() {
    // Only show once per session
    if (window._postTrialShown) return;
    window._postTrialShown = true;

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'post-trial-modal';
    modal.innerHTML = `
        <div class="modal" style="max-width:380px; text-align:center; padding:30px 24px;">
            <div style="font-size:36px; margin-bottom:12px;"><i class="fas fa-crown" style="color:#ffd700;"></i></div>
            <h2 style="margin-bottom:8px; font-size:20px;">${t('trial_ended_title') || 'O teu Trial acabou!'}</h2>
            <p style="color:var(--text-dim); font-size:13px; margin-bottom:20px;">
                ${t('trial_ended_desc') || 'Gostaste? Faz upgrade agora e ganha 20% de desconto! Oferta válida por 48 horas.'}
            </p>
            <div style="background:rgba(255,215,0,0.1); border:1px dashed #ffd700; border-radius:8px; padding:12px; margin-bottom:16px;">
                <div style="font-size:24px; font-weight:800; color:#ffd700;">-20%</div>
                <div style="font-size:11px; color:var(--text-dim); margin-top:4px;">${t('trial_ended_coupon_hint') || 'Aplica automaticamente no checkout'}</div>
            </div>
            <button id="post-trial-upgrade-btn" class="btn-primary" style="width:100%; padding:14px; font-size:15px; font-weight:700; background:linear-gradient(135deg, #ffd700, #ff8c00); color:#1a1a2e; border:none; border-radius:10px; cursor:pointer; margin-bottom:10px;">
                <i class="fas fa-crown" style="margin-right:6px;"></i> ${t('trial_ended_btn') || 'Fazer Upgrade com 20% OFF'}
            </button>
            <button onclick="this.closest('.modal-overlay').remove()" style="background:none; border:none; color:var(--text-dim); cursor:pointer; font-size:13px; padding:8px;">
                ${t('btn_later') || 'Talvez mais tarde'}
            </button>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('post-trial-upgrade-btn').addEventListener('click', () => {
        modal.remove();
        showPaywall();
        // The paywall will use the coupon — store it for checkout
        window._flashSaleCoupon = 'TRIAL20'; // Create this coupon in Stripe dashboard
    });
}

// ============================================
// REWARDED ADS SYSTEM
// ============================================
async function showRewardedAd(rewardType, callback) {
    // Show a "watching ad" simulation UI
    // In production, integrate Google AdSense Rewarded Ads here
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal" style="max-width:340px; text-align:center; padding:30px 24px;">
            <div style="font-size:32px; margin-bottom:12px;"><i class="fas fa-ad" style="color:var(--accent);"></i></div>
            <h3 style="margin-bottom:8px;">${t('ad_watching_title') || 'Ver Anúncio'}</h3>
            <p style="color:var(--text-dim); font-size:12px; margin-bottom:20px;">${t('ad_watching_desc') || 'Vê um anúncio curto para desbloquear esta funcionalidade.'}</p>
            <div id="ad-timer" style="font-size:28px; font-weight:800; color:var(--accent); margin-bottom:16px;">5</div>
            <div style="font-size:11px; color:var(--text-muted);">${t('ad_waiting') || 'A aguardar...'}</div>
        </div>
    `;
    document.body.appendChild(overlay);

    // Simulated 5-second countdown (replace with real ad SDK)
    let countdown = 5;
    const timerEl = document.getElementById('ad-timer');
    const interval = setInterval(() => {
        countdown--;
        if (timerEl) timerEl.textContent = countdown;
        if (countdown <= 0) {
            clearInterval(interval);
            overlay.remove();
            // Grant reward via server-side RPC
            grantAdReward(rewardType, callback);
        }
    }, 1000);
}

async function grantAdReward(rewardType, callback) {
    try {
        const { data, error } = await supabaseClient.rpc('grant_ad_reward', { p_reward_type: rewardType });
        if (error) throw error;
        if (data?.success) {
            currentUser.ad_rewards = data.rewards;
            showToast(t('ad_reward_granted') || 'Recompensa desbloqueada!', 'success');
            if (callback) callback();
        } else {
            showToast(t('js_error') + ' ' + (data?.error || ''), 'error');
        }
    } catch (e) {
        showToast(t('js_error') + ' ' + e.message, 'error');
    }
}

// ============================================
// REFERRAL CODE PROCESSING (on login/signup)
// ============================================
async function processReferralCode() {
    const params = new URLSearchParams(window.location.search);
    const refCode = params.get('ref');
    if (!refCode || !currentUser) return;

    // Clean URL
    window.history.replaceState({}, '', window.location.pathname);

    try {
        const { data, error } = await supabaseClient.rpc('process_referral', { p_referral_code: refCode });
        if (error) throw error;
        if (data?.success) {
            showToast(t('referral_success') || 'Código aplicado! Ambos ganharam 3 dias de Premium.', 'success');
            updateAuthUI();
        }
    } catch (e) {
        // Silently fail — code might be invalid or already used
        console.log('Referral processing:', e.message);
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

    // Logout with confirmation
    document.getElementById('logout-btn').addEventListener('click', () => {
        showConfirm(t('confirm_signout_title'), t('confirm_signout_text'), async () => {
            await supabaseClient.auth.signOut();
            currentUser = null;
            updateAuthUI();
            navigateTo('account');
        });
    });

    // Create Group (Custom Modal)
    document.getElementById('add-group-btn').addEventListener('click', async () => {
        if (!currentUser?.is_pro) {
            const { count } = await supabaseClient.from('group_members').select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id);
            if (count >= 1) {
                showPaywall();
                return;
            }
        }

        // Show custom modal instead of prompt()
        const modal = document.getElementById('create-group-modal');
        const input = document.getElementById('create-group-name-input');
        input.value = '';
        modal.classList.remove('hidden');
        setTimeout(() => input.focus(), 100);
    });

    // Create Group Confirm
    document.getElementById('create-group-confirm-btn').addEventListener('click', async () => {
        const name = document.getElementById('create-group-name-input').value.trim();
        if (!name || !currentUser) return;

        const btn = document.getElementById('create-group-confirm-btn');
        setButtonLoading(btn, true, t('btn_create'));

        const { data: group, error } = await supabaseClient
            .from('groups')
            .insert({ name: name, created_by: currentUser.id })
            .select()
            .single();

        setButtonLoading(btn, false);

        if (!error && group) {
            await supabaseClient.from('group_members').insert({ group_id: group.id, user_id: currentUser.id });
            document.getElementById('create-group-modal').classList.add('hidden');
            renderGroupsScreen();
        } else {
            showToast(t('js_err_create_group'));
        }
    });

    // Enter key on modal input
    document.getElementById('create-group-name-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('create-group-confirm-btn').click();
        }
    });

    // Invite Member (Using the new RPC to enforce limits)
    document.getElementById('invite-btn').addEventListener('click', async () => {
        const email = document.getElementById('invite-email').value;
        if (!email || !currentGroup) return;

        const btn = document.getElementById('invite-btn');
        setButtonLoading(btn, true, t('js_sending_link'));

        const { data, error } = await supabaseClient.rpc('invite_user_to_group', {
            p_group_id: currentGroup.id,
            p_email: email
        });

        setButtonLoading(btn, false);

        if (error) {
            showToast(t('js_error') + ' ' + error.message);
            return;
        }

        if (data.success) {
            document.getElementById('invite-email').value = '';
            loadGroupDetail(currentGroup.id);
        } else {
            // Handle specific errors natively
            if (data.error_code === 'USER_NOT_FOUND') {
                showConfirm(t('confirm_title'), t('js_invite_not_found'), () => {
                    // Try to trigger Native Share API or Mailto Fallback
                    const shareText = t('js_invite_share_text');
                    const shareUrl = window.location.origin;
                    if (navigator.share) {
                        navigator.share({
                            title: t('js_invite_share_title'),
                            text: shareText,
                            url: shareUrl
                        }).catch(console.error);
                    } else {
                        window.location.href = `mailto:${email}?subject=${encodeURIComponent(t('js_invite_share_title'))}&body=${encodeURIComponent(shareText + "\n" + shareUrl)}`;
                    }
                });
            } else if (data.error_code === 'ALREADY_MEMBER') {
                showToast(t('js_err_invite_member'), 'warning');
            } else if (data.error_code === 'LIMIT_REACHED') {
                showToast(t('js_err_invite_limit'), 'warning');
            }
        }
    });

    // Archive Group
    document.getElementById('archive-group-btn').addEventListener('click', async () => {
        if (!currentGroup) return;
        showConfirm(t('btn_archive_group'), t('js_confirm_archive_group'), async () => {
            const btn = document.getElementById('archive-group-btn');
            setButtonLoading(btn, true, t('btn_archive_group'));

            const { error } = await supabaseClient.rpc('archive_group', {
                p_group_id: currentGroup.id
            });

            setButtonLoading(btn, false);

            if (error) {
                showToast(t('js_error') + ' ' + error.message);
                return;
            }

            currentGroup.isArchived = true;
            loadGroupDetail(currentGroup.id);
            renderGroupsScreen(); // Update the list in the background
        });
    });

    // Unarchive Group
    document.getElementById('unarchive-group-btn').addEventListener('click', async () => {
        if (!currentGroup) return;
        showConfirm(t('btn_unarchive_group'), t('js_confirm_unarchive_group'), async () => {
            const btn = document.getElementById('unarchive-group-btn');
            setButtonLoading(btn, true, t('btn_unarchive_group'));

            const { data, error } = await supabaseClient.rpc('unarchive_group', {
                p_group_id: currentGroup.id
            });

            setButtonLoading(btn, false);

            if (error) {
                showToast(t('js_error') + ' ' + error.message);
                return;
            }

            if (data.success) {
                currentGroup.isArchived = false;
                loadGroupDetail(currentGroup.id);
                renderGroupsScreen(); // Update the list in the background
            } else if (data.error_code === 'LIMIT_REACHED') {
                showToast(t('js_err_unarchive_limit'), 'warning');
                showPaywall();
            }
        });
    });

    // Leave Group
    document.getElementById('leave-group-btn').addEventListener('click', async () => {
        if (!currentGroup) return;
        showConfirm(t('btn_leave_group'), t('js_confirm_leave_group'), async () => {
            const btn = document.getElementById('leave-group-btn');
            setButtonLoading(btn, true, t('btn_leave_group'));

            const { data, error } = await supabaseClient.rpc('leave_group', {
                p_group_id: currentGroup.id
            });

            setButtonLoading(btn, false);

            if (error) {
                showToast(t('js_error') + ' ' + error.message);
                return;
            }

            if (data.success) {
                navigateGroupBack();
                renderGroupsScreen();
            } else if (data.error_code === 'HAS_DEBTS') {
                showToast(t('js_err_leave_debts'), 'warning');
            }
        });
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
            tab.style.borderBottomColor = 'var(--accent)';
            tab.style.color = 'var(--text)';

            document.querySelectorAll('.group-tab-content').forEach(c => c.classList.add('hidden'));
            document.getElementById(`group-${tab.dataset.tab}-tab`).classList.remove('hidden');
        });
    });

    // Open Add Group Expense (with Free-tier limit check)
    document.getElementById('group-fab-add').addEventListener('click', async () => {
        if (!currentGroup) return;

        // Free-tier: max 3 group expenses per month (+ ad rewards)
        if (!currentUser?.is_pro) {
            const now = new Date();
            const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
            const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
            const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${lastDay}`;

            const { count } = await supabaseClient
                .from('group_expenses')
                .select('*', { count: 'exact', head: true })
                .eq('paid_by', currentUser.id)
                .gte('date', monthStart)
                .lte('date', monthEnd);

            const extraFromAds = parseInt(currentUser.ad_rewards?.group_expenses_extra || 0);
            const effectiveLimit = 3 + extraFromAds;

            if (count >= effectiveLimit) {
                // Show option: watch ad to unlock +1
                showConfirm(
                    t('limit_reached_title') || 'Limite Atingido',
                    (t('limit_reached_desc') || 'Atingiste o limite de despesas de grupo. Vê um anúncio para adicionar mais uma, ou faz upgrade para Premium ilimitado.'),
                    () => showRewardedAd('group_expense', () => addGroupExpenseUI())
                );
                return;
            }
        }

        document.getElementById('group-expense-form').reset();
        document.getElementById('group-expense-date').value = new Date().toISOString().slice(0, 10);

        // Populate payers dropdown from ACTIVE members only
        const activeMembers = currentGroupMembers.filter(m => m.profiles.is_active);

        const payerSelect = document.getElementById('group-expense-payer');
        payerSelect.innerHTML = '';
        activeMembers.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.profiles.id;
            opt.textContent = m.profiles.name || m.profiles.email;
            if (m.profiles.id === currentUser.id) opt.selected = true;
            payerSelect.appendChild(opt);
        });

        // Populate splits (MBWay style custom inputs) for ACTIVE members
        const splitsContainer = document.getElementById('group-expense-splits');
        splitsContainer.innerHTML = '';
        activeMembers.forEach(m => {
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
        if (checkedBoxes.length === 0 || total <= 0) { showToast(t('js_invalid_expense'), 'warning'); return; }

        let sumSplits = 0;
        const splits = [];
        document.querySelectorAll('.split-checkbox:checked').forEach(cb => {
            const id = cb.value;
            const amt = parseFloat(document.querySelector(`.split-amount-input[data-id="${id}"]`).value) || 0;
            splits.push({ user_id: id, amount: amt });
            sumSplits += amt;
        });

        if (Math.abs(sumSplits - total) > 0.05) {
            showToast(`A soma das divisões (${sumSplits.toFixed(2)} €) não corresponde ao total (${total.toFixed(2)} €). Ajusta os valores.`, 'warning'); return;
        }

        const btn = document.getElementById('group-expense-form').querySelector('button[type="submit"]');
        setButtonLoading(btn, true, t('js_btn_save') || 'Guardar');

        const { error } = await supabaseClient.rpc('add_group_expense', {
            p_group_id: currentGroup.id,
            p_paid_by: paidBy,
            p_amount: total,
            p_description: desc,
            p_date: date,
            p_splits: splits
        });

        setButtonLoading(btn, false);
        if (error) {
            console.error(error);
            showToast(`${t('js_err_save')} ` + error.message);
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
            processReferralCode();
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

// ============================================
// SYNC CATEGORIES WITH SUPABASE
// ============================================

async function syncCategories() {
    if (!currentUser) return;
    try {
        const { data: supaCats, error } = await supabaseClient.from('user_categories').select('*').eq('user_id', currentUser.id);
        if (error) {
            console.warn("Categories sync unavailable or table missing:", error.message);
            return;
        }

        const localCats = await db.getAllCategories();

        // 1. Download missing/updated categories from Supabase
        for (const sc of supaCats) {
            const existing = localCats.find(lc => lc.name.toLowerCase() === sc.name.toLowerCase());
            if (!existing) {
                await db.addCategory({ name: sc.name, icon: sc.icon, color: sc.color, budget: sc.budget });
            } else if (existing.budget !== sc.budget || existing.icon !== sc.icon || existing.color !== sc.color) {
                existing.budget = sc.budget;
                existing.icon = sc.icon;
                existing.color = sc.color;
                await db.updateCategory(existing);
            }
        }

        // 2. Upload missing local categories to Supabase
        for (const lc of localCats) {
            const existing = supaCats.find(sc => sc.name.toLowerCase() === lc.name.toLowerCase());
            if (!existing) {
                await supabaseClient.from('user_categories').insert({
                    user_id: currentUser.id,
                    name: lc.name,
                    icon: lc.icon,
                    color: lc.color,
                    budget: lc.budget || null
                });
            }
        }

        categoriesCache = await db.getAllCategories();
        if (document.getElementById('screen-categories') && document.getElementById('screen-categories').classList.contains('active')) {
            renderCategories();
        }
    } catch (e) {
        console.error('Error syncing categories:', e);
    }
}

// ============================================
// SYNC EXPENSES WITH SUPABASE
// ============================================

async function syncExpenses() {
    if (!currentUser) return;
    try {
        await cleanUpSyncDuplicates();
        const { data: supaExpenses, error } = await supabaseClient.from('user_expenses').select('*').eq('user_id', currentUser.id);
        if (error) {
            console.warn("Expenses sync unavailable or table missing:", error.message);
            return;
        }

        const localExpenses = await db.getRawExpenses();

        // 1. Process cloud -> local
        for (const se of supaExpenses) {
            // Match by cloud_id OR (description, amount, date) if cloud_id is missing locally
            const localMatch = localExpenses.find(le =>
                le.cloud_id === se.id ||
                (le.description === se.description && le.amount === se.amount && le.date === se.date && !le.cloud_id)
            );

            if (!localMatch) {
                // Download new cloud expense
                await db.addExpense({
                    amount: se.amount,
                    description: se.description,
                    categoryId: se.category_id,
                    date: se.date,
                    isRecurring: se.is_recurring,
                    recurringType: se.recurring_type,
                    recurringParams: se.recurring_params,
                    cloud_id: se.id,
                    cloud_parent_id: se.parent_id,
                    updated_at: se.updated_at
                });
            } else {
                // Determine which is newer
                const cloudTime = new Date(se.updated_at).getTime();
                const localTime = new Date(localMatch.updated_at).getTime();

                if (cloudTime > localTime) {
                    // Cloud is newer — update local (even if local was deleted, cloud wins)
                    await db.updateExpense({
                        ...localMatch,
                        amount: se.amount,
                        description: se.description,
                        categoryId: se.category_id,
                        date: se.date,
                        isRecurring: se.is_recurring,
                        recurringType: se.recurring_type,
                        recurringParams: se.recurring_params,
                        cloud_id: se.id,
                        cloud_parent_id: se.parent_id,
                        is_deleted: false,
                        updated_at: se.updated_at
                    });
                } else if (!localMatch.cloud_id) {
                    // Link local to cloud if cloud_id is missing
                    localMatch.cloud_id = se.id;
                    await db.updateExpense(localMatch);
                }
            }
        }

        // 1b. Detect cloud deletions: local expenses with cloud_id that no longer exist in Supabase
        for (const le of localExpenses) {
            if (le.cloud_id && !le.is_deleted) {
                const stillInCloud = supaExpenses.some(se => se.id === le.cloud_id);
                if (!stillInCloud) {
                    // Deleted on another device — delete locally too
                    const tx = db.db.transaction('expenses', 'readwrite');
                    tx.objectStore('expenses').delete(le.id);
                }
            }
        }

        // 2. Process local -> cloud
        // Re-fetch local expenses to ensure we have updated cloud_ids and resolve parents
        let upToDateLocal = await db.getRawExpenses();
        for (let le of upToDateLocal) {
            // If it's a child but cloud_parent_id is missing, try to resolve from current local state
            if (le.parentId && !le.cloud_parent_id) {
                const parent = upToDateLocal.find(p => p.id === le.parentId);
                if (parent && parent.cloud_id) {
                    le.cloud_parent_id = parent.cloud_id;
                    await db.updateExpense(le);
                }
            }

            const cloudMatch = supaExpenses.find(se => se.id === le.cloud_id);

            if (!le.cloud_id && !le.is_deleted) {
                // Final check: did someone else upload this identical expense while we were offline?
                const duplicateInCloud = supaExpenses.find(se =>
                    se.description === le.description &&
                    se.amount === le.amount &&
                    se.date === le.date
                );

                if (duplicateInCloud) {
                    le.cloud_id = duplicateInCloud.id;
                    await db.updateExpense(le);
                    continue;
                }

                // Upload new local expense
                const { data, error: insertErr } = await supabaseClient.from('user_expenses').insert({
                    user_id: currentUser.id,
                    local_id: le.id,
                    amount: le.amount,
                    description: le.description,
                    category_id: String(le.categoryId),
                    date: le.date,
                    is_recurring: le.isRecurring || false,
                    recurring_type: le.recurringType || 'none',
                    recurring_params: le.recurringParams || null,
                    parent_id: le.cloud_parent_id || null,
                    updated_at: le.updated_at
                }).select().single();

                if (!insertErr && data) {
                    le.cloud_id = data.id;
                    await db.updateExpense(le); // save the new cloud_id locally
                }
            } else if (le.cloud_id) {
                // It exists in cloud, check if local is newer or deleted
                const cloudTime = cloudMatch ? new Date(cloudMatch.updated_at).getTime() : 0;
                const localTime = new Date(le.updated_at).getTime();

                if (le.is_deleted) {
                    // Delete from cloud
                    const { error: delErr } = await supabaseClient.from('user_expenses').delete().eq('id', le.cloud_id);
                    if (!delErr) {
                        // Purge local tombstone
                        const tx = db.db.transaction('expenses', 'readwrite');
                        tx.objectStore('expenses').delete(le.id);
                    }
                } else if (localTime > cloudTime && cloudMatch) {
                    // Update cloud
                    await supabaseClient.from('user_expenses').update({
                        amount: le.amount,
                        description: le.description,
                        category_id: String(le.categoryId),
                        date: le.date,
                        is_recurring: le.isRecurring || false,
                        recurring_type: le.recurringType || 'none',
                        recurring_params: le.recurringParams || null,
                        parent_id: le.cloud_parent_id || null,
                        updated_at: le.updated_at
                    }).eq('id', le.cloud_id);
                }
            }
        }

        // Re-render if necessary
        if (document.getElementById('screen-calendar') && document.getElementById('screen-calendar').classList.contains('active')) {
            renderCalendar();
        }
    } catch (e) {
        console.error('Error syncing expenses:', e);
    }
}

/**
 * Utility to merge local duplicates (same date, amount, description) 
 * that might have occurred during initial sync rollout.
 */
async function cleanUpSyncDuplicates() {
    const raw = await db.getRawExpenses();
    const seen = new Map();
    const toDelete = [];

    raw.forEach(e => {
        if (e.is_deleted) return;
        // Normalize for comparison
        const normDesc = (e.description || '').toLowerCase().trim();
        const normAmount = parseFloat(e.amount || 0).toFixed(2);
        const key = `${e.date}|${normAmount}|${normDesc}`;

        if (seen.has(key)) {
            const existing = seen.get(key);
            // If one has group info or cloud_id, favor that one
            if (!existing.cloud_id && e.cloud_id) {
                toDelete.push(existing.id);
                seen.set(key, e);
            } else {
                toDelete.push(e.id);
            }
        } else {
            seen.set(key, e);
        }
    });

    const tx = db.db.transaction('expenses', 'readwrite');
    const store = tx.objectStore('expenses');
    for (const id of toDelete) {
        store.delete(id);
    }

    return new Promise((resolve) => {
        tx.oncomplete = () => {
            if (toDelete.length > 0) {
                console.log(`Cleaned up ${toDelete.length} duplicates.`);
            }
            resolve();
        };
    });
}

function updateAuthUI() {
    // Prevent errors if UI is not mounted yet
    if (!document.getElementById('auth-section')) return;

    if (currentUser) {
        syncCategories();
        syncExpenses();
        // Account Tab updates
        document.getElementById('auth-section').classList.add('hidden');
        document.getElementById('account-logged-in').classList.remove('hidden');

        // Obter infos para exibir e preencher formulário (limite robusto e leitura de avatar)
        supabaseClient.from('profiles').select('name, email, phone, avatar_url, language').eq('id', currentUser.id).limit(1)
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

                // Language persistence: apply stored language from account
                if (profile?.language && profile.language !== currentLang) {
                    updateLanguage(profile.language);
                }
                // Sync language selector dropdown
                const langSelector = document.getElementById('lang-selector');
                if (langSelector) langSelector.value = currentLang;

                // Preencher formulário de perfil
                const nameInput = document.getElementById('profile-name');
                const phoneInput = document.getElementById('profile-phone');
                if (nameInput) nameInput.value = profile?.name || '';
                if (phoneInput) phoneInput.value = displayPhone;
            });

        // Obter status PRO + subscription details + monetization data
        supabaseClient.from('subscriptions').select('*').eq('user_id', currentUser.id).maybeSingle()
            .then(async ({ data }) => {
                currentUser.is_pro = data?.is_pro || false;
                currentUser.ad_rewards = data?.ad_rewards || {};
                currentUser.streak_count = data?.streak_count || 0;
                currentUser.referral_code = data?.referral_code || '';
                currentUser.trial_used = data?.trial_used || false;
                currentUser.trial_end = data?.trial_end ? new Date(data.trial_end) : null;

                const badge = document.getElementById('pro-badge');
                if (badge) {
                    if (currentUser.is_pro) badge.classList.remove('hidden');
                    else badge.classList.add('hidden');
                }

                // Check trial expiry (server-side via RPC)
                try {
                    const { data: trialData } = await supabaseClient.rpc('check_trial_status');
                    if (trialData) {
                        currentUser.is_pro = trialData.is_pro;
                        if (trialData.trial_expired && !data.stripe_subscription_id) {
                            // Trial just expired — show flash sale modal
                            showPostTrialOffer();
                        }
                    }
                } catch (e) { /* RPC may not exist yet, gracefully fail */ }

                // Render subscription section
                const subSection = document.getElementById('subscription-section');
                if (subSection) {
                    if (currentUser.is_pro) {
                        // Check if it's a trial
                        const isTrial = currentUser.trial_end && currentUser.trial_end > new Date() && !data.stripe_subscription_id;
                        const endDate = data?.current_period_end ? new Date(data.current_period_end).toLocaleDateString() : null;
                        const isCancelling = data?.cancel_at_period_end;

                        let statusHtml = '';
                        if (isTrial) {
                            const daysLeft = Math.ceil((currentUser.trial_end - new Date()) / (1000 * 60 * 60 * 24));
                            statusHtml = `<span style="font-size:12px; color:#ffd700; font-weight:600;">
                                <i class="fas fa-clock" style="margin-right:3px;"></i> Trial: ${daysLeft} ${t('days_left') || 'dias restantes'}
                            </span>`;
                        } else if (endDate) {
                            statusHtml = `<span style="font-size:12px; color:${isCancelling ? 'var(--danger)' : 'var(--success)'}; font-weight:600;">
                                ${isCancelling ? t('subscription_cancels_on') + ' ' + endDate : t('subscription_active_until') + ' ' + endDate}
                            </span>`;
                        } else {
                            statusHtml = `<span style="font-size:12px; color:var(--success); font-weight:600;">✓</span>`;
                        }

                        let planLabel = isTrial ? (t('plan_trial') || 'Trial Premium') : t('plan_pro');
                        if (data.plan_interval === 'month') planLabel = t('plan_monthly');
                        if (data.plan_interval === 'year') planLabel = t('plan_yearly');

                        subSection.innerHTML = `
                            <div style="background:var(--bg-input); border-radius:12px; padding:16px; margin-bottom:12px;">
                                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                                    <span style="font-weight:700; color:var(--text);"><i class="fas fa-crown" style="color:#ffd700; margin-right:4px;"></i> ${planLabel}</span>
                                    ${statusHtml}
                                </div>
                                <div style="display:flex; gap:8px; margin-top:8px;">
                                    ${data.stripe_customer_id ? `<button id="manage-subscription-btn" class="btn-small" style="flex:1; background:var(--accent); border:none; color:white; padding:10px; border-radius:8px; font-size:13px; cursor:pointer; font-weight:600;">${t('btn_manage_subscription')}</button>` : ''}
                                    ${(!isCancelling && endDate) ? `<button id="cancel-subscription-row-btn" class="btn-small" style="padding:10px 12px; background:rgba(229,49,112,0.1); color:var(--danger); border:1px solid var(--danger); border-radius:8px; font-size:13px; cursor:pointer;">${t('btn_cancel_subscription')}</button>` : ''}
                                    ${isTrial ? `<button id="upgrade-from-trial-btn" class="btn-small" style="flex:1; background:var(--accent); border:none; color:white; padding:10px; border-radius:8px; font-size:13px; cursor:pointer; font-weight:600;"><i class="fas fa-crown" style="margin-right:4px;"></i> ${t('btn_upgrade_pro')}</button>` : ''}
                                </div>
                            </div>
                        `;

                        // Upgrade from trial button
                        const trialUpgradeBtn = document.getElementById('upgrade-from-trial-btn');
                        if (trialUpgradeBtn) {
                            trialUpgradeBtn.addEventListener('click', () => showPaywall());
                        }

                        // Manage subscription — show modal first
                        const manageBtn = document.getElementById('manage-subscription-btn');
                        if (manageBtn) {
                            manageBtn.addEventListener('click', () => {
                                const modal = document.getElementById('manage-sub-modal');
                                if (modal) modal.classList.remove('hidden');

                                // Wire up the portal button inside the modal
                                const portalBtn = document.getElementById('open-portal-btn');
                                if (portalBtn) {
                                    const newBtn = portalBtn.cloneNode(true);
                                    portalBtn.parentNode.replaceChild(newBtn, portalBtn);

                                    newBtn.addEventListener('click', async () => {
                                        if (!data.stripe_customer_id) {
                                            showToast(t('js_error') + ' Stripe customer ID em falta.', 'warning');
                                            return;
                                        }
                                        setButtonLoading(newBtn, true);
                                        try {
                                            const response = await fetch('/api/create-portal', {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ customerId: data.stripe_customer_id })
                                            });
                                            const resData = await response.json();
                                            if (resData.url) window.location.href = resData.url;
                                            else showToast(t('js_error') + ' ' + (resData.error || 'Unknown error'));
                                        } catch (e) {
                                            showToast(t('js_error') + ' ' + e.message);
                                        } finally {
                                            setButtonLoading(newBtn, false);
                                        }
                                    });
                                }
                            });
                        }

                        // Cancel subscription handler
                        const cancelBtn = document.getElementById('cancel-subscription-row-btn');
                        if (cancelBtn) {
                            cancelBtn.addEventListener('click', () => {
                                showConfirm(t('confirm_cancel_sub_title'), t('confirm_cancel_sub_text'), async () => {
                                    const { error } = await supabaseClient.from('subscriptions').update({
                                        cancel_at_period_end: true
                                    }).eq('user_id', currentUser.id);
                                    if (error) showToast(t('js_error') + ' ' + error.message);
                                    else updateAuthUI();
                                });
                            });
                        }
                    } else {
                        // FREE PLAN — show trial offer or upgrade button
                        let trialHtml = '';
                        if (!currentUser.trial_used) {
                            trialHtml = `
                                <div style="background: linear-gradient(135deg, rgba(255,215,0,0.15), rgba(127,90,240,0.1)); border:1px solid rgba(255,215,0,0.3); border-radius:12px; padding:16px; margin-bottom:12px; text-align:center;">
                                    <div style="font-size:24px; margin-bottom:8px;"><i class="fas fa-gift" style="color:#ffd700;"></i></div>
                                    <div style="font-weight:700; color:var(--text); font-size:15px; margin-bottom:4px;">${t('trial_title') || 'Experimenta o Premium!'}</div>
                                    <div style="font-size:12px; color:var(--text-dim); margin-bottom:12px;">${t('trial_desc') || '7 dias grátis. Sem cartão. Sem compromisso.'}</div>
                                    <button id="activate-trial-btn" class="btn-small" style="width:100%; background:linear-gradient(135deg, #ffd700, #ff8c00); border:none; color:#1a1a2e; padding:12px; border-radius:8px; font-size:14px; cursor:pointer; font-weight:700;">
                                        <i class="fas fa-rocket" style="margin-right:4px;"></i> ${t('trial_btn') || 'Ativar Trial Grátis'}
                                    </button>
                                </div>
                            `;
                        }

                        subSection.innerHTML = `
                            ${trialHtml}
                            <div style="background:var(--bg-input); border-radius:12px; padding:16px; margin-bottom:12px; text-align:center;">
                                <div style="font-weight:600; color:var(--text-dim); margin-bottom:12px;">${t('plan_free')}</div>
                                <button id="upgrade-pro-btn" class="btn-small" style="width:100%; background:var(--accent); border:none; color:white; padding:10px; border-radius:8px; font-size:13px; cursor:pointer; font-weight:700;"><i class="fas fa-crown" style="margin-right:4px;"></i> ${t('btn_upgrade_pro')}</button>
                            </div>
                        `;

                        // Trial activation
                        const trialBtn = document.getElementById('activate-trial-btn');
                        if (trialBtn) {
                            trialBtn.addEventListener('click', async () => {
                                setButtonLoading(trialBtn, true);
                                try {
                                    const { data: result, error } = await supabaseClient.rpc('activate_trial');
                                    if (error) throw error;
                                    if (result?.success) {
                                        showToast(t('trial_activated') || 'Trial Premium ativado! Aproveita 7 dias grátis.', 'success');
                                        updateAuthUI();
                                    } else {
                                        showToast(result?.error === 'TRIAL_ALREADY_USED' ? (t('trial_already_used') || 'Já usaste o teu trial gratuito.') : (t('js_error')), 'warning');
                                    }
                                } catch (e) {
                                    showToast(t('js_error') + ' ' + e.message, 'error');
                                } finally {
                                    setButtonLoading(trialBtn, false);
                                }
                            });
                        }

                        const upgradeBtn = document.getElementById('upgrade-pro-btn');
                        if (upgradeBtn) {
                            upgradeBtn.addEventListener('click', () => showPaywall());
                        }
                    }
                    subSection.classList.remove('hidden');
                }

                // ——— STREAK COUNTER ———
                const streakSection = document.getElementById('streak-section');
                if (streakSection) {
                    const streak = currentUser.streak_count || 0;
                    const daysUntilReward = 7 - (streak % 7);
                    const rewardText = daysUntilReward === 1 
                        ? (t('streak_reward_tomorrow') || 'Abre a app amanhã para uma surpresa!')
                        : `${t('streak_reward_countdown_1') || 'Faltam'} ${daysUntilReward} ${t('streak_reward_countdown_2') || 'dias para a próxima recompensa surpresa!'}`;

                    streakSection.innerHTML = streak > 0 ? `
                        <div style="background: linear-gradient(135deg, var(--bg-card), var(--bg-input)); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; margin-bottom: 12px; display: flex; align-items: center; gap: 14px; position: relative; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
                            <div style="position: absolute; right: -20px; top: -20px; font-size: 80px; opacity: 0.05; color: #ff6b35;"><i class="fas fa-fire"></i></div>
                            <div style="font-size: 28px; text-align: center; color: #ff6b35; text-shadow: 0 2px 10px rgba(255,107,53,0.3);"><i class="fas fa-fire"></i></div>
                            <div style="flex: 1; z-index: 1;">
                                <div style="font-weight: 800; color: var(--text); font-size: 15px; margin-bottom: 2px;">${streak} ${t('streak_login_days') || 'Dias de Login!'}</div>
                                <div style="font-size: 11px; color: var(--text-dim); font-weight: 500;">${t('streak_keep_opening') || 'Continua a abrir a app todos os dias.'}</div>
                                <div style="font-size: 11px; color: var(--warning); font-weight: 700; margin-top: 4px; background: rgba(255, 152, 0, 0.1); display: inline-block; padding: 2px 8px; border-radius: 6px;"><i class="fas fa-gift" style="margin-right:4px;"></i>${rewardText}</div>
                            </div>
                        </div>
                    ` : '';
                }

                // ——— REFERRAL SECTION ———
                const referralSection = document.getElementById('referral-section');
                if (referralSection && currentUser.referral_code) {
                    referralSection.innerHTML = `
                        <div style="background:var(--bg-input); border-radius:12px; padding:16px; margin-bottom:12px;">
                            <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
                                <i class="fas fa-user-plus" style="font-size:18px; color:var(--accent);"></i>
                                <div style="font-weight:700; color:var(--text); font-size:14px;">${t('referral_title') || 'Convida Amigos'}</div>
                            </div>
                            <div style="font-size:12px; color:var(--text-dim); margin-bottom:12px;">${t('referral_desc') || 'Ambos ganham 3 dias de Premium grátis!'}</div>
                            <div style="display:flex; gap:8px; align-items:center;">
                                <input type="text" readonly value="${currentUser.referral_code}" style="flex:1; background:var(--bg-card); border:1px solid var(--border); border-radius:8px; padding:10px; color:var(--text); font-weight:700; font-size:13px; text-align:center; letter-spacing:1px;">
                                <button id="share-referral-btn" class="btn-small" style="background:var(--accent); border:none; color:white; padding:10px 16px; border-radius:8px; font-size:13px; cursor:pointer; font-weight:600;">
                                    <i class="fas fa-share-alt"></i>
                                </button>
                            </div>
                        </div>
                    `;

                    const shareBtn = document.getElementById('share-referral-btn');
                    if (shareBtn) {
                        shareBtn.addEventListener('click', async () => {
                            const shareUrl = `${window.location.origin}?ref=${currentUser.referral_code}`;
                            const shareText = t('referral_share_text') || `Experimenta esta app de despesas! Usa o meu código ${currentUser.referral_code} e ambos ganhamos Premium grátis!`;
                            if (navigator.share) {
                                try {
                                    await navigator.share({ title: 'ExpenseManager', text: shareText, url: shareUrl });
                                } catch (e) { /* cancelled */ }
                            } else {
                                await navigator.clipboard.writeText(shareUrl);
                                showToast(t('referral_copied') || 'Link copiado!', 'success');
                            }
                        });
                    }
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
            // Remove previous listeners by replacing element
            const newForm = profileForm.cloneNode(true);
            profileForm.parentNode.replaceChild(newForm, profileForm);

            // Track initial values for change detection
            let initialName = '';
            let initialPhone = '';

            // Set initial values once profile is loaded
            setTimeout(() => {
                initialName = document.getElementById('profile-name')?.value || '';
                initialPhone = document.getElementById('profile-phone')?.value || '';
                const btn = document.getElementById('profile-save-btn');
                if (btn) {
                    btn.disabled = true;
                    btn.style.opacity = '0.5';
                }
            }, 500);

            // Enable/disable save button on input change
            const nameInput = newForm.querySelector('#profile-name');
            const phoneInput = newForm.querySelector('#profile-phone');

            const checkChanges = () => {
                const btn = document.getElementById('profile-save-btn');
                if (!btn) return;
                const hasChanges = (nameInput?.value || '') !== initialName || (phoneInput?.value || '') !== initialPhone;
                btn.disabled = !hasChanges;
                btn.style.opacity = hasChanges ? '1' : '0.5';
            };

            if (nameInput) nameInput.addEventListener('input', checkChanges);
            if (phoneInput) phoneInput.addEventListener('input', checkChanges);

            newForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const btn = document.getElementById('profile-save-btn');
                setButtonLoading(btn, true, t('js_saving_profile'));

                const nameVal = document.getElementById('profile-name').value;
                const phoneVal = document.getElementById('profile-phone').value;

                const { error } = await supabaseClient.from('profiles').update({
                    name: nameVal,
                    phone: phoneVal
                }).eq('id', currentUser.id);

                setButtonLoading(btn, false);

                if (error) {
                    showToast(`${t('js_err_save')} ${error.message}`);
                } else {
                    document.getElementById('account-name-header').textContent = nameVal || currentUser.email;

                    // Only update the initial character if there is no image set
                    const avatarDiv = document.getElementById('account-avatar');
                    if (!avatarDiv.style.backgroundImage || avatarDiv.style.backgroundImage === 'none') {
                        avatarDiv.textContent = (nameVal || currentUser.email).charAt(0).toUpperCase();
                    }

                    // Update initial values so button disables again
                    initialName = nameVal;
                    initialPhone = phoneVal;
                    btn.disabled = true;
                    btn.style.opacity = '0.5';
                }
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
                    showToast(`${t('js_err_save')} Imagem de Capa (${err.message})`);
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
            groups ( id, name, created_by, is_archived )
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
        const isArchived = g.is_archived === true;

        // Graceful downgrade: Lock extra groups if user loses PRO status
        const isLocked = !currentUser.is_pro && index > 0;

        const lockBadge = isLocked ? `<div style="font-size:11px; font-weight:700; background:rgba(229,49,112,0.15); color:var(--danger); padding:4px 8px; border-radius:12px; letter-spacing:0.5px;"><i class="fas fa-lock" style="margin-right:4px;"></i>${t('pro_locked_badge')}</div>` : '';
        const archivedBadge = isArchived ? `<div style="font-size:11px; font-weight:700; background:rgba(0,0,0,0.2); padding:2px 6px; border-radius:12px; margin-left:8px; color:var(--text); letter-spacing:0.5px;"><i class="fas fa-archive"></i> Arquivado</div>` : '';
        const opacity = (isLocked || isArchived) ? 'opacity: 0.5; filter: grayscale(50%);' : '';
        const clickAction = isLocked ? `showLockedGroupAlert()` : `openGroupDetail('${g.id}', '${g.name.replace(/'/g, "\\'")}', '${g.created_by}', ${isArchived})`;

        list.innerHTML += `
            <div class="group-item" style="${opacity}" onclick="${clickAction}">
                <div style="display:flex; align-items:center;">
                    <div>
                        <div class="group-name" style="margin-bottom:2px;">${g.name}</div>
                        <div class="group-role">${role}</div>
                    </div>
                    ${isArchived ? archivedBadge : ''}
                </div>
                ${isLocked ? lockBadge : '<i class="fas fa-chevron-right" style="color:var(--text-muted);"></i>'}
            </div>
        `;
    });
}

window.showLockedGroupAlert = function () {
    showToast(t('pro_locked_group_alert'), 'warning');
    showPaywall();
}

function openGroupDetail(id, name, createdBy, isArchived) {
    currentGroup = { id, name, createdBy, isArchived };
    document.getElementById('group-detail-title').textContent = name;
    navigateTo('group-detail');
    loadGroupDetail(id);
}

function navigateGroupBack() {
    navigateTo('group-detail');
}

async function loadGroupDetail(groupId) {
    // 1. Load Members via RPC for graceful restrictions limit checking
    const { data: rpcMembers } = await supabaseClient.rpc('get_group_members_status', { p_group_id: groupId });

    // Map to preserve existing UI compatibility
    currentGroupMembers = (rpcMembers || []).map(rm => ({
        profiles: {
            id: rm.user_id,
            name: rm.name,
            email: rm.email,
            avatar_url: rm.avatar_url,
            is_active: rm.is_active
        }
    }));

    const membersList = document.getElementById('group-members-list');
    membersList.innerHTML = '';

    const profileMap = {};
    currentGroupMembers.forEach(m => {
        profileMap[m.profiles.id] = m.profiles;

        // Handle avatar UI (image vs text initial)
        const hasAvatar = m.profiles.avatar_url;
        const bgStyle = hasAvatar ? `background-image:url('${m.profiles.avatar_url}'); background-size:cover; background-position:center;` : '';
        const initialStr = hasAvatar ? '' : (m.profiles.name || m.profiles.email).charAt(0).toUpperCase();

        const lockedBadge = !m.profiles.is_active ? `<span style="margin-left:8px; font-size:10px; background:var(--danger); color:white; padding:2px 6px; border-radius:8px;">${t('pro_locked_badge')}</span>` : '';
        const opacityStyle = !m.profiles.is_active ? 'opacity:0.5;' : '';

        membersList.innerHTML += `
            <div class="member-item" style="${opacityStyle}">
                <div class="member-avatar" style="${bgStyle}">${initialStr}</div>
                <div>
                    <div style="font-size:14px; font-weight:600;">${m.profiles.name || m.profiles.email} ${lockedBadge}</div>
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
        debtsList.innerHTML = `<div style="text-align:center; padding:30px 20px; color:var(--text-dim); background:var(--bg-input); border-radius:12px; margin-bottom:30px;">
            <div style="font-size:28px; margin-bottom:10px; color:var(--success);"><i class="fas fa-check-circle"></i></div>
            <div style="font-weight:600; margin-bottom:5px;">${t('js_all_settled_title') || 'Tudo liquidado!'}</div>
            <div style="font-size:12px;">${t('js_all_settled_desc') || 'Não há dívidas pendentes neste grupo.'}</div>
        </div>`;
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
                if (!currentGroup.isArchived) {
                    btnHtml = `<button onclick="settleDebt(this, '${d.debtor_id}','${d.creditor_id}',${d.amount})" class="btn-small" style="background:var(--accent);">${t('js_btn_pay')}</button>`;
                }
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
            expense_splits ( user_id, amount )
        `)
        .eq('group_id', groupId)
        .order('date', { ascending: false })
        .limit(30);

    const expensesList = document.getElementById('group-expenses-list');
    expensesList.innerHTML = '';

    if (!expenses || expenses.length === 0) {
        expensesList.innerHTML = `<div style="text-align:center; padding:40px 20px; color:var(--text-dim); background:var(--bg-input); border-radius:12px; margin-top:20px;">
            <div style="font-size:32px; margin-bottom:10px;">🧾</div>
            <div style="font-weight:600; margin-bottom:5px;">${t('js_no_expenses_title') || 'Nenhuma despesa'}</div>
            <div style="font-size:12px;">${t('js_no_expenses_desc') || 'Clica no botão + para adicionar a primeira despesa do grupo.'}</div>
        </div>`;
    } else {
        expenses.forEach(e => {
            let paidByName = t('js_someone');
            const iPaid = e.paid_by === currentUser.id;

            if (iPaid) paidByName = t('js_you');
            else if (profileMap[e.paid_by]) paidByName = profileMap[e.paid_by].name || profileMap[e.paid_by].email;

            // Calculate my split
            const mySplitObj = e.expense_splits.find(s => s.user_id === currentUser.id);
            const mySplit = mySplitObj ? mySplitObj.amount : 0;

            let splitText = '';
            let splitColor = 'var(--text-dim)';

            if (mySplit > 0) {
                if (iPaid) {
                    const owedToMe = e.amount - mySplit;
                    splitText = `Tu pagaste ${e.amount.toFixed(2)}€ (Tua parte: ${mySplit.toFixed(2)}€)`;
                    splitColor = owedToMe > 0 ? 'var(--success)' : 'var(--text-dim)';
                } else {
                    splitText = `${paidByName} pagou ${e.amount.toFixed(2)}€ (Tu deves: ${mySplit.toFixed(2)}€)`;
                    splitColor = 'var(--danger)';
                }
            } else {
                splitText = `${paidByName} pagou ${e.amount.toFixed(2)}€ (Não entras nesta)`;
                splitColor = 'var(--text-dim)';
            }

            expensesList.innerHTML += `
                <div class="expense-item" style="align-items: flex-start; padding: 16px;">
                    <div class="expense-item-left" style="flex:1;">
                        <div class="expense-item-cat" style="background:#4a4e6922; border-radius:12px;">🤝</div>
                        <div style="flex:1;">
                            <div class="expense-item-desc" style="font-size:15px; margin-bottom:4px;">${e.description}</div>
                            <div style="font-size:11px; color:${splitColor}; font-weight:600; margin-bottom:2px;">${splitText}</div>
                            <div class="expense-item-recurring" style="font-size:11px;">${e.date}</div>
                        </div>
                    </div>
                    <div style="display:flex; flex-direction:column; align-items:flex-end; justify-content:space-between; gap:10px;">
                        <div class="expense-item-amount" style="font-size:16px;">${e.amount.toFixed(2)} €</div>
                        ${(iPaid && !currentGroup.isArchived) ? `<button onclick="deleteGroupExpense(this, '${e.id}')" class="btn-small" style="background:rgba(229,49,112,0.1); color:var(--danger); border:none; padding:4px 8px; border-radius:6px; font-size:12px;">Apagar</button>` : ''}
                    </div>
                </div>
            `;
        });
    }

    // --- APPLY ARCHIVE / ROLE STATE --- //
    const isOwner = currentUser.id === currentGroup.createdBy;
    const isArchived = currentGroup.isArchived === true;

    const banner = document.getElementById('group-archived-banner');
    const fabAdd = document.getElementById('group-fab-add');
    const inviteContainer = document.getElementById('invite-container');
    const archiveBtn = document.getElementById('archive-group-btn');
    const unarchiveBtn = document.getElementById('unarchive-group-btn');
    const leaveBtn = document.getElementById('leave-group-btn');

    if (banner && fabAdd && archiveBtn && unarchiveBtn && leaveBtn) {
        if (isArchived) {
            banner.classList.remove('hidden');
            fabAdd.classList.add('hidden');
            if (inviteContainer) inviteContainer.classList.add('hidden');
            leaveBtn.classList.add('hidden');

            if (isOwner) {
                archiveBtn.classList.add('hidden');
                unarchiveBtn.classList.remove('hidden');
            } else {
                archiveBtn.classList.add('hidden');
                unarchiveBtn.classList.add('hidden');
            }
        } else {
            banner.classList.add('hidden');
            fabAdd.classList.remove('hidden');
            if (inviteContainer) inviteContainer.classList.remove('hidden');
            unarchiveBtn.classList.add('hidden');

            if (isOwner) {
                archiveBtn.classList.remove('hidden');
                leaveBtn.classList.add('hidden');
            } else {
                archiveBtn.classList.add('hidden');
                leaveBtn.classList.remove('hidden');
            }
        }
    }
}

window.deleteGroupExpense = async function (btn, expenseId) {
    showConfirm(t('btn_delete'), t('js_confirm_delete'), async () => {
        setButtonLoading(btn, true);
        const { error } = await supabaseClient.rpc('delete_group_expense', {
            p_group_id: currentGroup.id,
            p_expense_id: expenseId
        });
        setButtonLoading(btn, false);
        if (error) showToast(t('js_error') + ' ' + error.message);
        else {
            loadGroupDetail(currentGroup.id);
            renderCalendar();
            refreshDayDetail();
        }
    });
}

window.settleDebt = async function (btn, debtor_id, creditor_id, amount) {
    if (currentGroup?.isArchived) {
        showToast(t('js_error') + ' Grupo Arquivado (Apenas Leitura).', 'warning');
        return;
    }

    showConfirm(t('js_settle_btn'), `${t('js_confirm_settle_debt')} ${amount.toFixed(2)} €?`, async () => {
        setButtonLoading(btn, true);
        const { error } = await supabaseClient.rpc('settle_debt', {
            p_group_id: currentGroup.id,
            p_debtor_id: debtor_id,
            p_creditor_id: creditor_id,
            p_amount: amount
        });
        setButtonLoading(btn, false);
        if (error) showToast(`${t('js_err_settle')}` + error.message);
        else loadGroupDetail(currentGroup.id);
    });
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
        categoryId: `group_expense_${e.groups.name}`,
        isGroupExpense: true,
        groupName: e.groups.name
    }));
}

async function fetchGroupExpensesForRange(from, to) {
    if (!currentUser) return [];

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
        .gte('date', from)
        .lte('date', to);

    if (error || !expenses) return [];

    return expenses.map(e => ({
        id: e.id,
        description: `${e.groups.name} - ${e.description}`,
        amount: e.expense_splits[0].amount,
        date: e.date,
        categoryId: `group_expense_${e.groups.name}`,
        isGroupExpense: true,
        groupName: e.groups.name
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

// ============================================
// PWA INSTALL PROMPT
// ============================================

let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;

    // Don't show if user dismissed before
    if (localStorage.getItem('pwa-install-dismissed')) return;
    // Don't show if already installed (standalone mode)
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    const banner = document.getElementById('pwa-install-banner');
    if (banner) banner.classList.remove('hidden');
});

document.getElementById('pwa-install-btn')?.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') {
        document.getElementById('pwa-install-banner')?.classList.add('hidden');
    }
    deferredInstallPrompt = null;
});

document.getElementById('pwa-dismiss-btn')?.addEventListener('click', () => {
    document.getElementById('pwa-install-banner')?.classList.add('hidden');
    localStorage.setItem('pwa-install-dismissed', 'true');
});

window.addEventListener('appinstalled', () => {
    document.getElementById('pwa-install-banner')?.classList.add('hidden');
    deferredInstallPrompt = null;
});

// ============================================
// EXPENSE SEARCH
// ============================================

function setupSearch() {
    const toggleBtn = document.getElementById('search-toggle-btn');
    const searchBar = document.getElementById('search-bar');
    const searchInput = document.getElementById('search-input');
    const clearBtn = document.getElementById('search-clear-btn');
    const resultsContainer = document.getElementById('search-results');

    if (!toggleBtn || !searchBar) return;

    // Toggle search bar
    toggleBtn.addEventListener('click', () => {
        searchBar.classList.toggle('hidden');
        if (!searchBar.classList.contains('hidden')) {
            searchInput.focus();
        } else {
            searchInput.value = '';
            resultsContainer.classList.add('hidden');
            clearBtn.classList.add('hidden');
        }
    });

    // Clear button
    clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        resultsContainer.classList.add('hidden');
        clearBtn.classList.add('hidden');
        searchInput.focus();
    });

    // Live search (debounced)
    let searchTimeout;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        const query = searchInput.value.trim().toLowerCase();

        if (query.length === 0) {
            resultsContainer.classList.add('hidden');
            clearBtn.classList.add('hidden');
            return;
        }
        clearBtn.classList.remove('hidden');

        searchTimeout = setTimeout(async () => {
            const allExpenses = await db.getAllExpenses();
            const cats = await db.getAllCategories();

            const results = allExpenses.filter(e => {
                const cat = cats.find(c => c.id === e.categoryId);
                const catName = cat ? tc(cat.name).toLowerCase() : '';
                return e.description.toLowerCase().includes(query) || catName.includes(query);
            }).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15);

            if (results.length === 0) {
                resultsContainer.innerHTML = `<div style="padding:16px; text-align:center; color:var(--text-muted); font-size:13px;">${t('search_no_results') || 'Sem resultados'}</div>`;
            } else {
                resultsContainer.innerHTML = results.map(e => {
                    const cat = cats.find(c => c.id === e.categoryId) || { icon: '💰', name: t('js_others'), color: '#666' };
                    return `<div class="search-result-item" data-date="${e.date}" style="display:flex; align-items:center; gap:10px; padding:12px 16px; cursor:pointer; border-bottom:1px solid var(--border); transition: background 0.15s;" onmouseover="this.style.background='var(--bg-card-hover)'" onmouseout="this.style.background='none'">
                        <div style="width:32px; height:32px; border-radius:50%; background:${cat.color}22; display:flex; align-items:center; justify-content:center; font-size:16px; flex-shrink:0;">${cat.icon}</div>
                        <div style="flex:1; min-width:0;">
                            <div style="font-size:13px; font-weight:600; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${e.description}</div>
                            <div style="font-size:11px; color:var(--text-muted);">${tc(cat.name)} · ${e.date}</div>
                        </div>
                        <div style="font-weight:700; color:var(--accent); font-size:14px; white-space:nowrap;">${formatCurrency(e.amount)}</div>
                    </div>`;
                }).join('');
            }

            resultsContainer.classList.remove('hidden');

            // Click on result → go to that day
            resultsContainer.querySelectorAll('.search-result-item').forEach(item => {
                item.addEventListener('click', () => {
                    const date = item.dataset.date;
                    if (date) {
                        const [y, m] = date.split('-').map(Number);
                        currentYear = y;
                        currentMonth = m - 1;
                        selectedDayDate = date;
                        renderCalendar();
                        // Close search
                        searchBar.classList.add('hidden');
                        searchInput.value = '';
                        resultsContainer.classList.add('hidden');
                        clearBtn.classList.add('hidden');
                    }
                });
            });
        }, 300);
    });

    // Close results when clicking outside
    document.addEventListener('click', (e) => {
        if (!searchBar.contains(e.target) && e.target !== toggleBtn && !toggleBtn.contains(e.target)) {
            resultsContainer.classList.add('hidden');
        }
    });
}

// ============================================
// ONBOARDING TUTORIAL
// ============================================

(function setupOnboarding() {
    if (localStorage.getItem('onboarding-done')) return;

    const slides = [
        {
            emoji: '<i class="fas fa-calendar-alt"></i>',
            title: t('onboarding_1_title') || 'Calendário',
            desc: t('onboarding_1_desc') || 'Vê as tuas despesas organizadas por dia. Toca num dia para ver detalhes ou adiciona novas despesas com o botão +.'
        },
        {
            emoji: '<i class="fas fa-tags"></i>',
            title: t('onboarding_2_title') || 'Categorias',
            desc: t('onboarding_2_desc') || 'Organiza as tuas despesas por categorias personalizadas. Define orçamentos mensais para controlar os gastos.'
        },
        {
            emoji: '<i class="fas fa-users"></i>',
            title: t('onboarding_3_title') || 'Grupos',
            desc: t('onboarding_3_desc') || 'Partilha despesas com amigos e família. Divide contas automaticamente e vê quem deve o quê.'
        }
    ];

    let currentSlide = 0;
    const overlay = document.getElementById('onboarding-overlay');
    if (!overlay) return;

    function showSlide(index) {
        document.getElementById('onboarding-emoji').innerHTML = slides[index].emoji;
        document.getElementById('onboarding-title').textContent = slides[index].title;
        document.getElementById('onboarding-desc').textContent = slides[index].desc;

        // Update dots
        document.querySelectorAll('.onboarding-dot').forEach((dot, i) => {
            dot.style.background = i === index ? 'var(--accent)' : 'rgba(255,255,255,0.3)';
            dot.style.width = i === index ? '20px' : '8px';
            dot.style.borderRadius = i === index ? '4px' : '50%';
        });

        // Update button text
        const nextBtn = document.getElementById('onboarding-next-btn');
        if (index === slides.length - 1) {
            nextBtn.textContent = t('btn_start') || 'Começar!';
        } else {
            nextBtn.textContent = t('btn_next') || 'Seguinte';
        }
    }

    function closeOnboarding() {
        overlay.classList.add('hidden');
        localStorage.setItem('onboarding-done', 'true');
    }

    document.getElementById('onboarding-next-btn')?.addEventListener('click', () => {
        currentSlide++;
        if (currentSlide >= slides.length) {
            closeOnboarding();
        } else {
            showSlide(currentSlide);
        }
    });

    document.getElementById('onboarding-skip-btn')?.addEventListener('click', closeOnboarding);

    // Show onboarding after a short delay
    setTimeout(() => {
        overlay.classList.remove('hidden');
        showSlide(0);
    }, 800);
})();

// --- Theme Toggle ---
function toggleTheme() {
    const isLight = document.documentElement.classList.toggle('light-theme');
    localStorage.setItem('appTheme', isLight ? 'light' : 'dark');
    updateThemeIcon(isLight);
}

function updateThemeIcon(isLight) {
    const btn = document.getElementById('theme-toggle-btn');
    if (!btn) return;
    if (isLight) {
        btn.innerHTML = '<i class="fas fa-sun" style="color:var(--text);"></i>';
    } else {
        btn.innerHTML = '<i class="fas fa-moon" style="color:var(--text);"></i>';
    }
}

// Ensure theme icon is set correctly on load
document.addEventListener('DOMContentLoaded', () => {
    const isLight = document.documentElement.classList.contains('light-theme');
    updateThemeIcon(isLight);
});
