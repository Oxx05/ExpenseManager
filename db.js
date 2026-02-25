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
    async addExpense(e) { return this._tx('expenses', 'readwrite', s => s.add(e)); }
    async updateExpense(e) { return this._tx('expenses', 'readwrite', s => s.put(e)); }
    async deleteExpense(id) { return this._tx('expenses', 'readwrite', s => s.delete(id)); }
    async getAllExpenses() { return this._tx('expenses', 'readonly', s => s.getAll()); }

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
        const all = await this.getAllExpenses();
        const from = `${year}-${String(month + 1).padStart(2, '0')}-01`;
        const lastDay = new Date(year, month + 1, 0).getDate();
        const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

        // Start with real expenses in this month
        const result = all.filter(e => e.date >= from && e.date <= to);

        // Add projections from recurring expenses
        const recurring = all.filter(e => e.isRecurring && e.recurringType && e.recurringType !== 'none');
        for (const expense of recurring) {
            const startDate = new Date(expense.date + 'T00:00:00');
            let current = new Date(startDate);

            // Generate occurrences up to end of target month
            const endDate = new Date(year, month + 1, 0);
            let safetyLimit = 400; // prevent infinite loops

            while (current <= endDate && safetyLimit-- > 0) {
                const dateStr = current.toISOString().slice(0, 10);

                if (dateStr >= from && dateStr <= to && dateStr !== expense.date) {
                    // Check if a real entry already exists for this date
                    const exists = result.some(e =>
                        e.date === dateStr &&
                        (e.parentId === expense.id || e.id === expense.id)
                    );

                    if (!exists) {
                        result.push({
                            ...expense,
                            id: undefined, // no real ID — it's projected
                            date: dateStr,
                            isProjected: true,
                            parentId: expense.id,
                            isRecurring: false, // projected copies aren't recurring themselves
                            _recurringType: expense.recurringType, // keep for display
                        });
                    }
                }

                // Advance to next occurrence
                current = this._advanceDate(new Date(current), expense.recurringType);
                if (current <= startDate) break; // safety
            }
        }

        return result;
    }

    /**
     * Elimina uma despesa recorrente e todas as suas ocorrências geradas.
     */
    async deleteRecurringAndChildren(parentId) {
        const all = await this.getAllExpenses();
        const toDelete = all.filter(e => e.id === parentId || e.parentId === parentId);
        for (const e of toDelete) {
            await this.deleteExpense(e.id);
        }
    }

    /**
     * Gera despesas reais a partir de recorrentes até hoje.
     */
    async processRecurring() {
        const all = await this.getAllExpenses();
        const today = new Date().toISOString().slice(0, 10);
        const recurring = all.filter(e => e.isRecurring && e.recurringType && e.recurringType !== 'none');

        for (const expense of recurring) {
            let nextDate = expense.nextOccurrence || expense.date;
            let safety = 500;

            while (nextDate <= today && safety-- > 0) {
                const exists = all.some(e =>
                    e.date === nextDate &&
                    (e.description === expense.description || e.parentId === expense.id) &&
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
                        parentId: expense.id
                    });
                    all.push({ ...expense, id: newId, date: nextDate, isRecurring: false, parentId: expense.id });
                }

                const d = this._advanceDate(new Date(nextDate + 'T00:00:00'), expense.recurringType);
                nextDate = d.toISOString().slice(0, 10);
            }

            expense.nextOccurrence = nextDate;
            await this.updateExpense(expense);
        }
    }

    /**
     * Avança uma data pelo tipo de recorrência.
     */
    _advanceDate(d, type) {
        switch (type) {
            case 'daily': d.setDate(d.getDate() + 1); break;
            case 'weekly': d.setDate(d.getDate() + 7); break;
            case 'monthly': d.setMonth(d.getMonth() + 1); break;
            case 'yearly': d.setFullYear(d.getFullYear() + 1); break;
        }
        return d;
    }

    _tx(storeName, mode, callback) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, mode);
            const store = tx.objectStore(storeName);
            const request = callback(store);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
}

const db = new ExpenseDB();
