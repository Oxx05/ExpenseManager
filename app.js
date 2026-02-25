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
    document.getElementById('fab-add').addEventListener('click', () => openAddExpense());
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
}

// ============================================
// CALENDAR
// ============================================

const MONTH_NAMES = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

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
    document.getElementById('month-label').textContent = `${MONTH_NAMES[currentMonth]} ${currentYear}`;

    // Use the projection method to include recurring entries
    const expenses = await db.getExpensesWithRecurring(currentYear, currentMonth);
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
        el.addEventListener('click', () => {
            selectedDayDate = dateStr;
            if (expenses.length > 0) {
                showDayDetail(dateStr, expenses);
            } else {
                openAddExpense(dateStr);
            }
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
        const cat = categoriesCache.find(c => c.id === expense.categoryId) || { icon: '💰', color: '#666', name: 'Outros' };
        total += expense.amount;

        const recurringLabel = expense.isRecurring
            ? (RECURRING_LABELS[expense.recurringType] || expense.recurringType)
            : (expense._recurringType ? RECURRING_LABELS[expense._recurringType] : null);

        const isProjected = expense.isProjected;

        const item = document.createElement('div');
        item.className = 'expense-item';
        if (isProjected) item.classList.add('projected');
        item.innerHTML = `
      <div class="expense-item-left">
        <div class="expense-item-cat" style="background:${cat.color}22">${cat.icon}</div>
        <div>
          <div class="expense-item-desc">${expense.description}</div>
          ${recurringLabel ? `<div class="expense-item-recurring">🔄 ${recurringLabel}${isProjected ? ' (auto)' : ''}</div>` : ''}
        </div>
      </div>
      <div class="expense-item-amount">${formatCurrency(expense.amount)}</div>
    `;

        if (!isProjected) {
            item.addEventListener('click', () => openEditExpense(expense));
        }

        list.appendChild(item);
    }

    document.getElementById('day-detail-total').textContent = `Total: ${formatCurrency(total)}`;
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
    });
    document.getElementById('delete-btn').addEventListener('click', handleDelete);
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
    } else {
        document.getElementById('recurring-options').classList.add('hidden');
    }

    renderCategoryPicker();
    selectedCategoryId = expense.categoryId;
    updateCategoryPickerUI();

    navigateTo('add');
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
    document.getElementById('delete-all-btn').addEventListener('click', async () => {
        if (editingExpense) {
            const parentId = editingExpense.parentId || editingExpense.id;
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
            if (confirm('Eliminar esta categoria?')) {
                await db.deleteCategory(id);
                renderCategories();
            }
        });
    });
}

async function addCategory() {
    const name = document.getElementById('new-cat-name').value.trim();
    const icon = document.getElementById('new-cat-icon').value.trim() || '🏷️';
    const color = document.getElementById('new-cat-color').value;
    if (!name) return;
    try {
        await db.addCategory({ name, icon, color });
        document.getElementById('new-cat-name').value = '';
        document.getElementById('new-cat-icon').value = '';
        categoriesCache = await db.getAllCategories();
        renderCategories();
    } catch { alert('Já existe uma categoria com esse nome.'); }
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
    document.getElementById('summary-month-label').textContent = `${MONTH_NAMES[summaryMonth]} ${summaryYear}`;

    // Include projected recurring for full picture
    const expenses = await db.getExpensesWithRecurring(summaryYear, summaryMonth);
    categoriesCache = await db.getAllCategories();

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
        const cat = categoriesCache.find(c => c.id === parseInt(catId)) || { icon: '💰', name: 'Outros', color: '#666' };
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
    const from = document.getElementById('export-from').value;
    const to = document.getElementById('export-to').value;

    if (!from || !to) { alert('Seleciona as datas de início e fim.'); return; }

    const expenses = await db.getExpensesByDateRange(from, to);
    categoriesCache = await db.getAllCategories();

    if (expenses.length === 0) { alert('Sem despesas neste período.'); return; }

    expenses.sort((a, b) => a.date.localeCompare(b.date));

    const data = expenses.map(e => {
        const cat = categoriesCache.find(c => c.id === e.categoryId) || { name: 'Outros' };
        return {
            'Data': e.date,
            'Descrição': e.description,
            'Categoria': cat.name,
            'Valor (€)': e.amount,
            'Recorrente': e.isRecurring ? (RECURRING_LABELS[e.recurringType] || 'Sim') : 'Não',
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
