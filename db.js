/* ================================================================
   GESTOR DE DESPESAS — IndexedDB Database Layer (v2)
   Suporta: diário, semanal, mensal, anual + projeção no calendário
   ================================================================ */

const DB_NAME = 'expense-tracker';
const DB_VERSION = 1;

const DEFAULT_CATEGORIES = [
    { name: 'Casa', icon: '🏠', color: '#e74c3c' },
    { name: 'Alimentação', icon: '🍔', color: '#f39c12' },
    { name: 'Transporte', icon: '🚗', color: '#3498db' },
    { name: 'Saúde', icon: '💊', color: '#2ecc71' },
    { name: 'Lazer', icon: '🎮', color: '#9b59b6' },
    { name: 'Tecnologia', icon: '📱', color: '#1abc9c' },
    { name: 'Educação', icon: '📚', color: '#e67e22' },
    { name: 'Outros', icon: '💰', color: '#7f8c8d' },
];

const RECURRING_LABELS = {
    daily: 'Diário',
    weekly: 'Semanal',
    monthly: 'Mensal',
    yearly: 'Anual',
    none: 'Não',
};

class ExpenseDB {
    constructor() { this.db = null; }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('expenses')) {
                    const s = db.createObjectStore('expenses', { keyPath: 'id', autoIncrement: true });
                    s.createIndex('date', 'date', { unique: false });
                    s.createIndex('categoryId', 'categoryId', { unique: false });
                }
                if (!db.objectStoreNames.contains('categories')) {
                    const c = db.createObjectStore('categories', { keyPath: 'id', autoIncrement: true });
                    c.createIndex('name', 'name', { unique: true });
                }
            };
            request.onsuccess = async (event) => {
                this.db = event.target.result;
                await this._seedCategories();
                resolve(this.db);
            };
            request.onerror = (event) => reject(event.target.error);
        });
    }

    async _seedCategories() {
        const cats = await this.getAllCategories();
        if (cats.length === 0) {
            for (const cat of DEFAULT_CATEGORIES) await this.addCategory(cat);
        }
    }

    // --- Categorias ---
    async addCategory(c) { return this._tx('categories', 'readwrite', s => s.add(c)); }
    async updateCategory(c) { return this._tx('categories', 'readwrite', s => s.put(c)); }
    async deleteCategory(id) { return this._tx('categories', 'readwrite', s => s.delete(id)); }
    async getAllCategories() { return this._tx('categories', 'readonly', s => s.getAll()); }
    async getCategory(id) { return this._tx('categories', 'readonly', s => s.get(id)); }

    // --- Despesas ---
    async addExpense(e) {
        e.updated_at = e.updated_at || new Date().toISOString();
        return this._tx('expenses', 'readwrite', s => s.add(e));
    }
    async updateExpense(e) {
        e.updated_at = e.updated_at || new Date().toISOString();
        return this._tx('expenses', 'readwrite', s => s.put(e));
    }
    async deleteExpense(id) {
        const e = await this._tx('expenses', 'readonly', s => s.get(id));
        if (e) {
            e.is_deleted = true;
            e.updated_at = new Date().toISOString(); // always force new timestamp on delete
            return this.updateExpense(e);
        }
    }
    async getRawExpenses() {
        return this._tx('expenses', 'readonly', s => s.getAll());
    }
    async getAllExpenses() {
        const all = await this.getRawExpenses();
        return all.filter(e => !e.is_deleted);
    }

    async getExpensesByDateRange(from, to) {
        const all = await this.getAllExpenses();
        return all.filter(e => e.date >= from && e.date <= to);
    }

    async getExpensesByMonth(year, month) {
        const from = `${year}-${String(month + 1).padStart(2, '0')}-01`;
        const lastDay = new Date(year, month + 1, 0).getDate();
        const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        return this.getExpensesByDateRange(from, to);
    }

    /**
     * Retorna todas as despesas de um mês INCLUINDO projeções de recorrentes.
     * As projeções têm isProjected=true e parentId apontando para a despesa original.
     */
    async getExpensesWithRecurring(year, month) {
        const all = await this.getAllExpenses(); // Active ones
        const tombstones = await this.getRawExpenses(); // Includes deleted
        const from = `${year}-${String(month + 1).padStart(2, '0')}-01`;
        const lastDay = new Date(year, month + 1, 0).getDate();
        const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

        // Start with real active expenses in this month
        let result = all.filter(e => e.date >= from && e.date <= to);

        // Filter out master expenses if their specific date was marked as deleted
        result = result.filter(e => {
            if (e.isRecurring && e.recurringParams?.deletedDates?.includes(e.date)) return false;
            return true;
        });

        // Add projections from recurring expenses
        const recurring = all.filter(e => e.isRecurring && e.recurringType && e.recurringType !== 'none');
        for (const expense of recurring) {
            const startDate = new Date(expense.date + 'T00:00:00');
            let current = new Date(startDate);

            // Generate occurrences up to end of target month
            const endDate = new Date(year, month + 1, 0);
            let safetyLimit = 400; // prevent infinite loops

            const getLocalDateString = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

            while (current <= endDate && safetyLimit-- > 0) {
                const dateStr = getLocalDateString(current);

                // Stop if we hit recurringUntil
                if (expense.recurringUntil && dateStr > expense.recurringUntil) break;

                // Stop if this specific occurrence was deleted
                if (expense.recurringParams?.deletedDates?.includes(dateStr)) {
                    // Advance and continue loop
                    current = this._advanceDateWithParams(new Date(current), expense.recurringType, expense.recurringParams);
                    if (current <= startDate) break;
                    continue;
                }

                if (dateStr >= from && dateStr <= to && dateStr !== expense.date) {
                    // Check if a real entry (active OR deleted) already exists for this date
                    const exists = tombstones.some(e =>
                        e.date === dateStr &&
                        (e.parentId == expense.id || e.id == expense.id || (e.cloud_parent_id && expense.cloud_id && e.cloud_parent_id == expense.cloud_id))
                    );

                    if (!exists) {
                        result.push({
                            ...expense,
                            id: undefined, // no real ID — it's projected
                            date: dateStr,
                            isProjected: true,
                            parentId: expense.id,
                            cloud_parent_id: expense.cloud_id || null,
                            isRecurring: false, // projected copies aren't recurring themselves
                            _recurringType: expense.recurringType, // keep for display
                        });
                    }
                }

                // Advance to next occurrence
                current = this._advanceDateWithParams(new Date(current), expense.recurringType, expense.recurringParams);
                if (current <= startDate) break; // safety
            }
        }

        return result;
    }

    /**
     * Elimina uma despesa recorrente e todas as suas ocorrências geradas.
     * @param {number} parentId - ID da despesa recorrente mãe ou qualquer filha
     * @param {string} fromDate - Data (YYYY-MM-DD) para apagar apenas a partir dessa data. Se null, apaga tudo.
     */
    async deleteRecurringAndChildren(id, fromDate = null, isSingle = false) {
        const all = await this.getRawExpenses();
        let target = all.find(e => e.id == id);
        if (!target) return;

        // Resolve the ACTUAL parent (master)
        let master = target;
        if (target.parentId || target.cloud_parent_id) {
            master = all.find(e =>
                (target.parentId && e.id == target.parentId) ||
                (target.cloud_parent_id && e.cloud_id == target.cloud_parent_id)
            ) || target;
        }

        // 1. If Delete All (fromDate is null)
        if (!fromDate) {
            let toDelete = all.filter(e =>
                e.id == master.id ||
                e.parentId == master.id ||
                (master.cloud_id && (e.cloud_id == master.cloud_id || e.cloud_parent_id == master.cloud_id))
            );
            for (const e of toDelete) {
                await this.deleteExpense(e.id);
            }
            return;
        }

        // 2. If Delete ONLY this occurrence
        if (isSingle) {
            // Record it in master for persistence
            if (!master.recurringParams) master.recurringParams = {};
            if (!master.recurringParams.deletedDates) master.recurringParams.deletedDates = [];
            if (!master.recurringParams.deletedDates.includes(fromDate)) {
                master.recurringParams.deletedDates.push(fromDate);
                master.updated_at = new Date().toISOString();
                await this.updateExpense(master);
            }

            // Also delete real physical children at THIS date (if any were materialized)
            let physicalOnDate = all.filter(e =>
                (e.parentId == master.id || (master.cloud_id && e.cloud_parent_id == master.cloud_id)) &&
                e.date === fromDate
            );
            for (const e of physicalOnDate) {
                await this.deleteExpense(e.id);
            }

            // Handle the master itself if it's the target date
            if (master.date === fromDate) {
                // If the series starts exactly on the deleted date, we materialize the "next" occurrence as the new master?
                // For simplicity, we just mark it as deleted in itself if needed, or simply let the projection engine skip it.
                // Our projection engine already skips master.date if it's in deletedDates? No.
                // Let's ensure projection engine also checks the master itself.
            }
            return;
        }

        // 3. If Delete FROM HERE onwards
        // Delete all real physical children >= fromDate
        let physicalToDelete = all.filter(e =>
            (e.parentId == master.id || (master.cloud_id && e.cloud_parent_id == master.cloud_id)) &&
            e.date >= fromDate
        );
        for (const e of physicalToDelete) {
            await this.deleteExpense(e.id);
        }

        // Handle the master itself
        if (master.date >= fromDate) {
            // If the series starts at or after the deletion point, delete the whole master
            await this.deleteExpense(master.id);
        } else {
            // Truncate the series by setting recurringUntil to day-1
            const d = new Date(fromDate + 'T00:00:00');
            d.setDate(d.getDate() - 1);
            master.recurringUntil = d.toISOString().slice(0, 10);
            master.updated_at = new Date().toISOString();
            await this.updateExpense(master);
        }
    }

    /**
     * Gera despesas reais a partir de recorrentes até hoje.
     */
    async processRecurring() {
        if (this._isProcessingRecurring) return;
        this._isProcessingRecurring = true;

        try {
            const all = await this.getAllExpenses();
            const todayObj = new Date();
            const today = `${todayObj.getFullYear()}-${String(todayObj.getMonth() + 1).padStart(2, '0')}-${String(todayObj.getDate()).padStart(2, '0')}`;
            const recurring = all.filter(e => e.isRecurring && e.recurringType && e.recurringType !== 'none');

            const getLocalDateString = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

            for (const expense of recurring) {
                let nextDate = expense.nextOccurrence || expense.date;
                let safety = 500;
                let updated = false;

                while (nextDate <= today && safety-- > 0) {
                    // Stop if we hit recurringUntil
                    if (expense.recurringUntil && nextDate > expense.recurringUntil) break;

                    // Stop if this specific occurrence was deleted
                    if (expense.recurringParams?.deletedDates?.includes(nextDate)) {
                        let [y, m, d_num] = nextDate.split('-').map(Number);
                        const d = this._advanceDateWithParams(new Date(y, m - 1, d_num), expense.recurringType, expense.recurringParams);
                        nextDate = getLocalDateString(d);
                        updated = true;
                        continue;
                    }

                    const exists = all.some(e =>
                        e.date === nextDate &&
                        (e.description === expense.description ||
                            e.parentId === expense.id ||
                            (e.cloud_parent_id && expense.cloud_id && e.cloud_parent_id === expense.cloud_id)
                        ) &&
                        e.id !== expense.id
                    );

                    if (!exists && nextDate !== expense.date) {
                        const newId = await this.addExpense({
                            amount: expense.amount,
                            description: expense.description,
                            categoryId: expense.categoryId,
                            date: nextDate,
                            isRecurring: false,
                            recurringType: 'none',
                            nextOccurrence: null,
                            parentId: expense.id,
                            cloud_parent_id: expense.cloud_id || null
                        });
                        all.push({ ...expense, id: newId, date: nextDate, isRecurring: false, parentId: expense.id, cloud_parent_id: expense.cloud_id || null });
                    }

                    let [y, m, d_num] = nextDate.split('-').map(Number);
                    const d = this._advanceDateWithParams(new Date(y, m - 1, d_num), expense.recurringType, expense.recurringParams);
                    nextDate = getLocalDateString(d);
                    updated = true;
                }

                if (updated) {
                    expense.nextOccurrence = nextDate;
                    await this.updateExpense(expense);
                }
            }
        } finally {
            this._isProcessingRecurring = false;
        }
    }

    /**
     * Avança uma data pelo tipo de recorrência.
     */
    _advanceDate(d, type) {
        switch (type) {
            case 'daily': d.setDate(d.getDate() + 1); break;
            case 'weekly':
                // Bug fix: ensure we advance exactly 7 days
                d.setDate(d.getDate() + 7);
                break;
            case 'monthly': d.setMonth(d.getMonth() + 1); break;
            case 'yearly': d.setFullYear(d.getFullYear() + 1); break;
        }
        return d;
    }

    /**
     * Avança uma data considerando os parâmetros de recorrência.
     */
    _advanceDateWithParams(d, recurringType, params) {
        const newDate = new Date(d);

        if (recurringType === 'weekly' && params?.weeklyDays && params.weeklyDays.length > 0) {
            // Coerce to numbers to prevent type mismatch (string vs number)
            const selectedDays = params.weeklyDays.map(Number);
            let daysToAdd = 1;

            while (daysToAdd <= 7) {
                const testDate = new Date(d);
                testDate.setDate(d.getDate() + daysToAdd);
                const dow = testDate.getDay();

                if (selectedDays.includes(dow)) {
                    return testDate;
                }
                daysToAdd++;
            }
            // If no day found in next 7 days, advance to next week and continue search
            return this._advanceDateWithParams(new Date(d.getTime() + 7 * 24 * 60 * 60 * 1000), recurringType, params);
        }
        else if (recurringType === 'monthly' && params?.monthlyType === 'dayOfMonth') {
            // Always on the same day of the month
            newDate.setMonth(newDate.getMonth() + 1);
            newDate.setDate(params.monthlyDay || 1);
            return newDate;
        }
        else if (recurringType === 'monthly' && params?.monthlyType === 'dayOfWeek') {
            // e.g., second Tuesday of the month
            newDate.setMonth(newDate.getMonth() + 1);
            return this._getNthWeekdayOfMonth(newDate.getFullYear(), newDate.getMonth(),
                params.monthlyDayOfWeek || 1, params.monthlyWeekOfMonth || 1);
        }
        else if (recurringType === 'yearly' && params?.yearlyType === 'date') {
            // Same day every year
            newDate.setFullYear(newDate.getFullYear() + 1);
            newDate.setMonth(params.yearlyMonth || 0);
            newDate.setDate(params.yearlyDay || 1);
            return newDate;
        }
        else if (recurringType === 'yearly' && params?.yearlyType === 'dayOfWeek') {
            // e.g., second Monday of March
            newDate.setFullYear(newDate.getFullYear() + 1);
            return this._getNthWeekdayOfMonth(newDate.getFullYear(), params.yearlyDowMonth || 0,
                params.yearlyDayOfWeek || 1, params.yearlyWeekOfMonth || 1);
        }
        else {
            // Default behavior for daily or no special params
            return this._advanceDate(newDate, recurringType);
        }
    }

    /**
     * Retorna a data do enésimo dia da semana num mês específico.
     * @param {number} year - Ano
     * @param {number} month - Mês (0-11)
     * @param {number} dayOfWeek - Dia da semana (0=domingo, 1=segunda, ..., 6=sábado)
     * @param {number} weekNumber - Qual semana (1=primeira, 2=segunda, etc.)
     */
    _getNthWeekdayOfMonth(year, month, dayOfWeek, weekNumber) {
        let date = new Date(year, month, 1);
        let count = 0;

        while (count < weekNumber) {
            if (date.getDay() === dayOfWeek) count++;
            if (count < weekNumber) date.setDate(date.getDate() + 1);
        }

        return date;
    }

    _tx(storeName, mode, callback) {
        return new Promise((resolve, reject) => {
            const executeTx = () => {
                const tx = this.db.transaction(storeName, mode);
                const store = tx.objectStore(storeName);
                const request = callback(store);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            };

            // Safety mechanism for cold-starts: if db is omitted, wait until ready.
            if (!this.db) {
                const checkDb = setInterval(() => {
                    if (this.db) {
                        clearInterval(checkDb);
                        executeTx();
                    }
                }, 50);
            } else {
                executeTx();
            }
        });
    }
}

const db = new ExpenseDB();
