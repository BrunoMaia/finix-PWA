/**
 * @file Arquivo principal do Finix PWA.
 * @version 11.0 (Polished UI & Installments)
 * @description Refatoração da UI, unificação da entrada de dados e mudança para sistema de parcelas.
 */
document.addEventListener('DOMContentLoaded', () => {
    const app = new FinanceApp();
    app.init();
});

class FinanceApp {
    constructor() {
        this.state = {
            transactions: [],
            recurringExpenses: [],
            calendarDate: new Date(),
            selectedDate: new Date(),
            activeModal: null
        };
        this.dataManager = new DataManager('finixPWAData_v11');
        this.calendarView = new CalendarView('#calendar-container');
        this.dayDetailsView = new DayDetailsView('#day-details-container', (id) => this.deleteTransaction(id));
        this.modalManager = new ModalManager(this, '#modal-container');
        this.navView = new NavView(this);
    }
    init() {
        this.state = this.dataManager.load(this.state);
        // CORREÇÃO: Garante que o app nunca inicie com um modal aberto.
        this.state.activeModal = null;
        this.applyAndSortRecurring();
        this.navView.bindEvents();
        this.calendarView.bindEvents(
            (date) => this.setSelectedDate(date),
            (direction) => this.changeMonth(direction)
        );
        this.ui.render();
        this.registerServiceWorker();
    }
    ui = {
        render: () => {
            this.calendarView.render(this.state);
            this.dayDetailsView.render(this.state);
            this.modalManager.render();
            // Atualiza o título principal dinamicamente
            document.getElementById('main-title').textContent = this.state.activeModal ? '' : 'Finix';
        }
    }
    setSelectedDate(date) {
        this.state.selectedDate = date;
        this.ui.render();
        const detailsEl = document.getElementById('day-details-container');
        if (detailsEl && detailsEl.innerHTML !== '') {
            detailsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }
    changeMonth(direction) {
        this.state.calendarDate.setMonth(this.state.calendarDate.getMonth() + direction);
        // CORREÇÃO: Garante que recorrentes de meses futuros sejam projetados
        this.applyAndSortRecurring();
        this.dataManager.save(this.state);
        this.ui.render();
    }
    addTransaction(txData) {
        if (!txData.description || isNaN(txData.amount)) return;
        this.state.transactions.push({ id: Date.now(), ...txData, recurringId: null });
        this.applyAndSortRecurring();
        this.dataManager.save(this.state);
        this.ui.render();
        this.modalManager.close();
    }
    deleteTransaction(id) {
        const tx = this.state.transactions.find(t => t.id === id);
        if (!tx) return;
        if (tx.recurringId) {
            alert('Transações recorrentes devem ser removidas pela regra em "Configurações".');
            return;
        }
        if (!confirm(`Deseja realmente excluir a transação "${tx.description}"?`)) return;
        this.state.transactions = this.state.transactions.filter(t => t.id !== id);
        this.dataManager.save(this.state);
        this.ui.render();
    }
    addRecurringExpense(recurData) {
        if (recurData.amount > 0) recurData.amount = -recurData.amount;
        if (!recurData.description || isNaN(recurData.amount) || isNaN(recurData.day) || isNaN(recurData.installments)) return;
        this.state.recurringExpenses.push({ id: Date.now(), ...recurData, appliedCount: 0 });
        this.applyAndSortRecurring();
        this.dataManager.save(this.state);
        this.ui.render();
        this.modalManager.close();
    }
    deleteRecurringExpense(id) {
        if (!confirm('Deseja remover esta regra e TODAS as suas transações?')) return;
        this.state.transactions = this.state.transactions.filter(t => t.recurringId !== id);
        this.state.recurringExpenses = this.state.recurringExpenses.filter(exp => exp.id !== id);
        this.dataManager.save(this.state);
        this.ui.render();
        this.modalManager.renderRecurringList();
    }
    importData(jsonString) {
        try {
            const importedData = JSON.parse(jsonString);
            if (!confirm('Tem certeza? Todos os seus dados atuais serão substituídos.')) return;
            const loadedState = this.dataManager.load(importedData);
            this.state.transactions = loadedState.transactions || [];
            this.state.recurringExpenses = loadedState.recurringExpenses || [];
            this.applyAndSortRecurring();
            this.dataManager.save(this.state);
            this.ui.render();
            this.modalManager.close();
            alert('Dados importados com sucesso!');
        } catch (err) { console.error("Erro ao importar:", err); alert('Erro: O arquivo selecionado não é um JSON válido.'); }
    }
    applyAndSortRecurring() {
        // MELHORIA: Lógica de recorrência baseada em parcelas
        this.state.recurringExpenses.forEach(expense => {
            if (expense.appliedCount >= expense.installments) return;

            let firstCheckDate;
            if (expense.lastApplied) {
                firstCheckDate = new Date(expense.lastApplied);
                firstCheckDate.setMonth(firstCheckDate.getMonth() + 1);
            } else {
                 firstCheckDate = this.state.transactions.length > 0
                    ? new Date(Math.min(new Date(), [...this.state.transactions].sort((a,b) => a.date - b.date)[0].date))
                    : new Date();
            }
            firstCheckDate.setDate(1);

            while (expense.appliedCount < expense.installments && firstCheckDate <= new Date(new Date().setFullYear(new Date().getFullYear() + 5))) { // Limite de 5 anos para evitar loops infinitos
                const transactionDate = new Date(firstCheckDate.getFullYear(), firstCheckDate.getMonth(), expense.day, 12, 0, 0);
                const alreadyExists = this.state.transactions.some(t => t.recurringId === expense.id && t.date.getTime() === transactionDate.getTime());

                if (!alreadyExists && expense.appliedCount < expense.installments) {
                    this.state.transactions.push({ id: Date.now() + Math.random(), date: transactionDate, description: expense.description, amount: expense.amount, recurringId: expense.id });
                    expense.lastApplied = transactionDate.toISOString();
                    expense.appliedCount++;
                }
                firstCheckDate.setMonth(firstCheckDate.getMonth() + 1);
            }
        });
        this.state.transactions.sort((a, b) => new Date(a.date) - new Date(b.date));
    }
    registerServiceWorker() {
        if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').then(reg => console.log('SW Registrado.')).catch(err => console.error('SW Falhou:', err));
    }
}

class DataManager {
    constructor(storageKey) { this.storageKey = storageKey; }
    save(state) { localStorage.setItem(this.storageKey, JSON.stringify(state)); }
    load(defaultState) {
        const data = localStorage.getItem(this.storageKey);
        const stateSource = data ? JSON.parse(data) : defaultState;

        if (stateSource.transactions) stateSource.transactions.forEach(t => t.date = new Date(t.date));
        if (stateSource.recurringExpenses) stateSource.recurringExpenses.forEach(r => {
            if(r.lastApplied) r.lastApplied = new Date(r.lastApplied);
            // MELHORIA: Migração de dados de `endDate` para `installments`
            if (r.endDate && !r.installments) {
                r.installments = 12; // Define um padrão
                delete r.endDate;
            }
            if(!r.appliedCount) r.appliedCount = 0;
        });
        if (stateSource.calendarDate) stateSource.calendarDate = new Date(stateSource.calendarDate);
        if (stateSource.selectedDate) stateSource.selectedDate = new Date(stateSource.selectedDate);

        return { ...defaultState, ...stateSource };
    }
}

class CalendarView {
    constructor(selector) { this.container = document.querySelector(selector); this.template = document.getElementById('calendar-day-template'); }
    bindEvents(onDayClick, onMonthChange) { this.container.addEventListener('click', e => { const dayElement = e.target.closest('.calendar-day'); if (dayElement && dayElement.dataset.date) onDayClick(new Date(dayElement.dataset.date)); if (e.target.id === 'prev-month') onMonthChange(-1); if (e.target.id === 'next-month') onMonthChange(1); }); }
    render(state) {
        const { calendarDate, selectedDate, transactions } = state;
        const year = calendarDate.getFullYear(); const month = calendarDate.getMonth();
        const firstDay = new Date(year, month, 1);

        // CORREÇÃO: Renderiza cabeçalhos dos dias da semana
        let html = `<div class="calendar-controls"><button id="prev-month" title="Mês anterior">&lt;</button><h2>${firstDay.toLocaleString('pt-BR',{month:'long',year:'numeric'})}</h2><button id="next-month" title="Próximo mês">&gt;</button></div>`;
        html += `<div class="calendar-grid">`;
        html += ['D','S','T','Q','Q','S','S'].map(d => `<div class="calendar-header">${d}</div>`).join('');
        this.container.innerHTML = html; // Insere o cabeçalho

        const grid = document.createElement('div'); grid.className = 'calendar-grid';
        // Reposiciona os cabeçalhos dentro do grid para manter a estrutura
        this.container.querySelectorAll('.calendar-header').forEach(h => grid.appendChild(h));

        const fragment = document.createDocumentFragment();
        for (let i = 0; i < firstDay.getDay(); i++) { const dayClone = this.template.content.cloneNode(true); dayClone.querySelector('.calendar-day').classList.add('other-month'); fragment.appendChild(dayClone); }
        for (let day = 1; day <= new Date(year, month + 1, 0).getDate(); day++) {
            const currentDate = new Date(year, month, day, 12, 0, 0);
            const dayClone = this.template.content.cloneNode(true);
            const dayElement = dayClone.querySelector('.calendar-day');
            dayElement.dataset.date = currentDate.toISOString();
            dayElement.querySelector('.day-number').textContent = day;
            if (currentDate.toDateString() === new Date().toDateString()) dayElement.classList.add('today');
            if (currentDate.toDateString() === selectedDate.toDateString()) dayElement.classList.add('selected');
            const dailyTx = transactions.filter(t => new Date(t.date).toDateString() === currentDate.toDateString());
            if (dailyTx.length > 0) {
                const summary = dayElement.querySelector('.day-summary');
                if (dailyTx.some(t => t.amount > 0)) summary.innerHTML += '<div class="day-dot income"></div>';
                if (dailyTx.some(t => t.amount < 0)) summary.innerHTML += '<div class="day-dot expense"></div>';
            }
            fragment.appendChild(dayClone);
        }
        grid.appendChild(fragment);
        this.container.appendChild(grid);
    }
}

class DayDetailsView {
    constructor(selector, onDeleteCallback) { this.container = document.querySelector(selector); this.template = document.getElementById('day-details-template'); this.itemTemplate = document.getElementById('transaction-item-template'); this.container.addEventListener('click', e => { const deleteButton = e.target.closest('.delete-transaction-btn'); if (deleteButton) { const itemElement = deleteButton.closest('.transaction-item'); onDeleteCallback(parseInt(itemElement.dataset.id, 10)); } }); }
    render(state) {
        const { selectedDate, transactions } = state;
        const dailyTx = transactions.filter(t => new Date(t.date).toDateString() === selectedDate.toDateString());
        if (dailyTx.length === 0) { this.container.innerHTML = ''; return; }
        const detailsClone = this.template.content.cloneNode(true);
        const titleEl = detailsClone.querySelector('.day-details-title');
        const summaryEl = detailsClone.querySelector('.day-details-summary');
        const listEl = detailsClone.querySelector('.transaction-list');
        const dailyTotal = dailyTx.reduce((sum, t) => sum + t.amount, 0);
        titleEl.textContent = selectedDate.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
        summaryEl.textContent = `Balanço do Dia: ${formatCurrency(dailyTotal)}`;
        // Ordena transações do dia para consistência
        dailyTx.sort((a,b) => a.id - b.id).forEach(tx => {
            const itemClone = this.itemTemplate.content.cloneNode(true);
            const itemElement = itemClone.querySelector('.transaction-item');
            itemElement.dataset.id = tx.id;
            itemClone.querySelector('.transaction-description').textContent = tx.description;
            const amountEl = itemClone.querySelector('.transaction-amount');
            amountEl.textContent = formatCurrency(tx.amount);
            // CORREÇÃO: Garante que as cores apareçam
            amountEl.classList.add(tx.amount > 0 ? 'income' : 'expense');
            if(tx.recurringId) itemClone.querySelector('.delete-transaction-btn').style.display = 'none';
            listEl.appendChild(itemClone);
        });
        this.container.innerHTML = '';
        this.container.appendChild(detailsClone);
    }
}

class ModalManager {
    constructor(appInstance, selector) { this.app = appInstance; this.container = document.querySelector(selector); this.template = document.getElementById('modal-template'); this.recurringItemTemplate = document.getElementById('recurring-item-template'); }
    open(modalId) { this.app.state.activeModal = modalId; this.render(); }
    close() { this.app.state.activeModal = null; this.render(); }
    render() {
        this.container.innerHTML = '';
        const { activeModal } = this.app.state;
        if (!activeModal) return;

        const modalClone = this.template.content.cloneNode(true);
        const modalEl = modalClone.querySelector('.modal');
        const titleEl = modalClone.querySelector('.modal-title');
        const bodyEl = modalClone.querySelector('.modal-body');

        modalEl.id = `modal-${activeModal}`;
        modalEl.querySelector('.close-button').onclick = () => this.close();

        let contentHTML = '';
        if (activeModal === 'add-tx') {
            titleEl.textContent = 'Nova Transação';
            contentHTML = `<form id="transaction-form" class="card"><div class="form-group"><label for="date">Data</label><input type="date" id="date" required></div><div class="form-group"><label for="description">Descrição</label><input type="text" id="description" placeholder="Ex: Salário, Almoço" required></div><div class="form-group"><label for="amount">Valor</label><input type="number" step="0.01" id="amount" placeholder="Ex: 1500.00 ou -25.50" required></div><div class="form-check"><input type="checkbox" id="is-recurring"><label for="is-recurring">É uma despesa recorrente?</label></div><div id="recurring-fields"><div class="form-group"><label for="recurring-day">Dia do Mês</label><input type="number" id="recurring-day" min="1" max="31" value="1"></div><div class="form-group"><label for="installments">Número de Parcelas</label><input type="number" id="installments" min="1" max="420" value="12"></div></div><button type="submit">Adicionar</button></form>`;
        }
        if (activeModal === 'transactions') {
            titleEl.textContent = 'Transações';
            contentHTML = `<div class="card"><div class="form-group"><input type="search" id="filter" placeholder="Filtrar por descrição..."></div></div><div id="monthly-transactions-container"></div>`;
        }
        if (activeModal === 'settings') {
            titleEl.textContent = 'Configurações';
            contentHTML = `<div class="card"><h3>Exportar/Importar</h3><p>Salve ou restaure um backup de seus dados.</p><div style="display:flex; gap:10px; margin-top:10px;"><button id="btn-export">Exportar JSON</button><button id="btn-import" class="button-secondary">Importar JSON</button></div><input type="file" id="import-file-input" accept=".json" style="display: none;"></div><div class="card"><h3>Gastos Recorrentes</h3><p>Visualize e exclua regras de gastos recorrentes.</p><div id="recurring-list"></div></div><div class="card"><h3>Sobre</h3><p>Finix PWA V1.0.2.1</p><small>feito com ❤️ por Bruno Maia - <a href="https://github.com/BunoMaia" target="_blank">GitHub</a></small></div>`;
        }

        bodyEl.innerHTML = contentHTML;

        this.container.appendChild(modalClone);
        modalEl.style.display = 'block';

        if (activeModal === 'add-tx') {
            document.getElementById('date').valueAsDate = new Date();
            const isRecurringCheck = document.getElementById('is-recurring');
            const recurringFields = document.getElementById('recurring-fields');
            isRecurringCheck.addEventListener('change', () => {
                recurringFields.classList.toggle('visible', isRecurringCheck.checked);
            });
        }
        if (activeModal === 'settings') this.renderRecurringList();
        if (activeModal === 'transactions') this.renderTransactionList();
    }

    renderTransactionList(filter = '') {
        const container = document.getElementById('monthly-transactions-container'); if(!container) return;
        const filteredTx = this.app.state.transactions.filter(t => t.description.toLowerCase().includes(filter.toLowerCase()));
        const grouped = filteredTx.reduce((acc, tx) => {
            const month = new Date(tx.date).toLocaleDateString('pt-BR', { year: 'numeric', month: 'long' });
            if (!acc[month]) acc[month] = { transactions: [], total: 0 };
            acc[month].transactions.push(tx);
            acc[month].total += tx.amount;
            return acc;
        }, {});
        const sortedMonths = Object.keys(grouped).sort((a, b) => new Date(b.split(' de ').reverse().join('-')) - new Date(a.split(' de ').reverse().join('-')));
        if (sortedMonths.length === 0) { container.innerHTML = `<div class="card"><p style="text-align: center;">Nenhuma transação encontrada.</p></div>`; return; }
        let html = '';
        sortedMonths.forEach(month => {
            const { transactions, total } = grouped[month];
            html += `<div class="month-group-header"><span class="month-name">${month}</span><span class="month-balance ${total >= 0 ? 'income' : 'expense'}">${formatCurrency(total)}</span></div>`;
            html += `<div class="card"><ul class="transaction-list">`;
            transactions.sort((a,b) => new Date(b.date) - new Date(a.date)).forEach(tx => {
                html += `<li class="transaction-item"><div class="transaction-details">${tx.description} <small style="opacity:0.6">${new Date(tx.date).toLocaleDateString('pt-BR')}</small></div><div class="transaction-amount ${tx.amount >= 0 ? 'income' : 'expense'}">${formatCurrency(tx.amount)}</div></li>`;
            });
            html += `</ul></div>`;
        });
        container.innerHTML = html;
    }
    renderRecurringList() {
        const listEl = document.getElementById('recurring-list'); if(!listEl) return;
        listEl.innerHTML = '';
        const expenses = this.app.state.recurringExpenses.sort((a,b) => a.day - b.day);
        if (expenses.length === 0) { listEl.innerHTML = `<p style="opacity: 0.7; text-align: center; margin: 15px 0;">Nenhuma regra recorrente.</p>`; return; }
        expenses.forEach(exp => {
            const itemClone = this.recurringItemTemplate.content.cloneNode(true);
            itemClone.querySelector('.recurring-description').textContent = `${exp.description} (Dia ${exp.day}) `;
            itemClone.querySelector('.recurring-end-date').textContent = `${exp.appliedCount} de ${exp.installments} parcelas aplicadas.`;
            const amountEl = itemClone.querySelector('.transaction-amount'); amountEl.textContent = formatCurrency(exp.amount); amountEl.classList.add('expense');
            itemClone.querySelector('.delete-btn').dataset.id = exp.id;
            listEl.appendChild(itemClone);
        });
    }
}

class NavView {
    constructor(appInstance) { this.app = appInstance; this.fab = document.getElementById('fab-add-tx'); this.navTransactions = document.getElementById('nav-transactions'); this.navCalendar = document.getElementById('nav-calendar'); this.btnSettings = document.getElementById('btn-settings'); }
    bindEvents() {
        this.fab.onclick = () => this.app.modalManager.open('add-tx');
        this.navTransactions.onclick = () => this.app.modalManager.open('transactions');
        this.btnSettings.onclick = () => this.app.modalManager.open('settings');
        this.navCalendar.onclick = () => { this.app.modalManager.close(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
        document.body.addEventListener('submit', e => {
            e.preventDefault();
            if (e.target.id === 'transaction-form') {
                const form = e.target;
                const isRecurring = form['is-recurring'].checked;
                if (isRecurring) {
                    this.app.addRecurringExpense({ description: form.description.value, amount: parseFloat(form.amount.value), day: parseInt(form['recurring-day'].value), installments: parseInt(form['installments'].value) });
                } else {
                    this.app.addTransaction({ date: new Date(form.date.value + 'T00:00:00-03:00'), description: form.description.value, amount: parseFloat(form.amount.value) });
                }
            }
        });
        document.body.addEventListener('click', e => {
             if (e.target.id === 'btn-export') { const dataStr = JSON.stringify(this.app.state, null, 2); const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr); const link = document.createElement('a'); link.setAttribute('href', dataUri); link.setAttribute('download', `finix_backup_${new Date().toISOString().slice(0,10)}.json`); link.click(); }
             if (e.target.id === 'btn-import') document.getElementById('import-file-input').click();
             const recurDelBtn = e.target.closest('.delete-btn'); if(recurDelBtn) this.app.deleteRecurringExpense(parseInt(recurDelBtn.dataset.id, 10));
        });
        document.body.addEventListener('change', e => { if (e.target.id === 'import-file-input') { const file = e.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = (event) => this.app.importData(event.target.result); reader.readAsText(file); } });
        document.body.addEventListener('input', e => { if (e.target.id === 'filter') this.app.modalManager.renderTransactionList(e.target.value); });
    }
}
const formatCurrency = (value) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
