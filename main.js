/**
 * @namespace App
 * @description Módulo principal da aplicação, encapsulado em uma IIFE para não poluir o escopo global.
 * A estrutura segue um padrão de "Separação de Responsabilidades", dividindo o código em:
 * - state: Os dados da aplicação.
 * - data: Funções para salvar e carregar os dados.
 * - logic: Funções de negócio puras (cálculos, formatação).
 * - ui: Funções que manipulam o DOM (a tela).
 * - events: Funções que lidam com as interações do usuário.
 * - init: Ponto de entrada que inicializa a aplicação.
 */
(function() {
    'use strict';

    const App = {
        state: {
            transactions: [],
            recurringExpenses: [],
            calendarDate: new Date(),
            filterQuery: '',
            activeModal: null
        },
        config: { storageKey: 'financePWAData_v6' },
        data: {
            save() { localStorage.setItem(App.config.storageKey, JSON.stringify(App.state)); },
            load() {
                const data = localStorage.getItem(App.config.storageKey);
                if (!data) return;
                const parsedData = JSON.parse(data);
                // BUG FIX: Garante que TODAS as datas sejam restauradas como objetos Date
                if (parsedData.transactions) parsedData.transactions.forEach(t => t.date = new Date(t.date));
                if (parsedData.recurringExpenses) parsedData.recurringExpenses.forEach(r => { if(r.lastApplied) r.lastApplied = new Date(r.lastApplied); });
                App.state = { ...App.state, ...parsedData };
            }
        },
        logic: {
            sortTransactions: (transactions) => transactions.sort((a, b) => new Date(b.date) - new Date(a.date)),
            applyRecurringExpenses(applyUntilDate = new Date()) {
                let needsUpdate = false;
                App.state.recurringExpenses.forEach(expense => {
                    let firstCheckDate;
                    if (expense.lastApplied) {
                        firstCheckDate = new Date(expense.lastApplied);
                        firstCheckDate.setMonth(firstCheckDate.getMonth() + 1);
                    } else {
                        const earliestTxDate = App.state.transactions.length > 0 ? [...App.state.transactions].sort((a, b) => a.date - b.date)[0].date : new Date();
                        firstCheckDate = new Date(Math.min(new Date(), earliestTxDate));
                    }
                    firstCheckDate.setDate(1);
                    while (firstCheckDate <= applyUntilDate) {
                        const transactionDate = new Date(firstCheckDate.getFullYear(), firstCheckDate.getMonth(), expense.day, 12, 0, 0);
                        if (expense.endDate && transactionDate > new Date(expense.endDate + 'T23:59:59-03:00')) {
                            firstCheckDate.setMonth(firstCheckDate.getMonth() + 1); continue;
                        }
                        const alreadyExists = App.state.transactions.some(t => t.recurringId === expense.id && t.date.getFullYear() === transactionDate.getFullYear() && t.date.getMonth() === transactionDate.getMonth());
                        if (!alreadyExists) {
                            App.state.transactions.push({ id: Date.now() + Math.random(), date: transactionDate, description: expense.description, amount: expense.amount, recurringId: expense.id });
                            expense.lastApplied = transactionDate.toISOString();
                            needsUpdate = true;
                        }
                        firstCheckDate.setMonth(firstCheckDate.getMonth() + 1);
                    }
                });
                if (needsUpdate) App.logic.sortTransactions(App.state.transactions);
                return needsUpdate;
            },
            formatCurrency: (value) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        },
        ui: {
            elements: {},
            cacheDOMElements() {
                this.elements = {
                    mainContent: document.getElementById('main-content'),
                    modalContainer: document.getElementById('modal-container'),
                    fabAddTx: document.getElementById('fab-add-tx'),
                    navFlow: document.getElementById('nav-flow'),
                    navData: document.getElementById('nav-data'),
                };
            },
            templates: {
                modal(id, title, content) {
                    return `
                        <div class="modal" id="${id}">
                            <div class="modal-content">
                                <div class="modal-header">
                                    <h2 class="modal-title">${title}</h2>
                                    <button class="close-button" data-modal-id="${id}">&times;</button>
                                </div>
                                ${content}
                            </div>
                        </div>`;
                },
                addTransactionModal() {
                    return `
                        <form id="transaction-form" style="padding-top: 20px;">
                            <div class="form-group"><label for="date">Data</label><input type="date" id="date" required></div>
                            <div class="form-group"><label for="description">Descrição</label><input type="text" id="description" placeholder="Ex: Salário, Almoço" required></div>
                            <div class="form-group"><label for="amount">Valor (use - para despesas)</label><input type="number" step="0.01" id="amount" placeholder="Ex: 1500.00 ou -25.50" required></div>
                            <button type="submit">Adicionar</button>
                        </form>`;
                },
                flowModal() {
                    return `
                        <div id="filter-card" class="card" style="margin-top:20px;"><div class="form-group"><label for="filter">Filtrar por descrição</label><input type="search" id="filter" placeholder="Ex: Supermercado, Salário..."></div></div>
                        <div id="flow-list-container"></div>`;
                },
                dataModal() {
                    return `
                        <div style="padding-top: 20px;">
                            <div class="card">
                                <h3>Exportar Dados</h3>
                                <p>Salve um backup de todos os seus dados em um arquivo JSON.</p>
                                <button id="btn-export">Exportar JSON</button>
                            </div>
                            <div class="card">
                                <h3>Importar Dados</h3>
                                <p style="color: var(--expense-color);">Atenção: A importação irá sobrescrever todos os dados existentes.</p>
                                <button id="btn-import" class="button-secondary">Importar JSON</button>
                                <input type="file" id="import-file-input" accept=".json" style="display: none;">
                            </div>
                            <div class="card">
                                <h3>Gastos Recorrentes</h3>
                                <p>Gerencie despesas que se repetem todo mês.</p>
                                <div id="recurring-list"></div>
                                <form id="recurring-form" style="margin-top: 20px;">
                                    <div class="form-group"><label for="recurring-description">Nova Despesa Recorrente</label><input type="text" id="recurring-description" placeholder="Ex: Aluguel" required></div>
                                    <div class="form-group"><label for="recurring-amount">Valor</label><input type="number" step="0.01" id="recurring-amount" placeholder="Ex: -1200.00" required></div>
                                    <div class="form-group"><label for="recurring-day">Dia do Mês</label><input type="number" id="recurring-day" min="1" max="31" value="1" required></div>
                                    <div class="form-group"><label for="recurring-end-date">Data Final (Opcional)</label><input type="date" id="recurring-end-date"></div>
                                    <button type="submit">Adicionar</button>
                                </form>
                            </div>
                        </div>`;
                },
                transactionItem: (t, balance) => `...`, // Re-used inside renderFlowList
                recurringItem: (exp) => `...`, // Re-used inside renderRecurringList
            },
            renderCalendar() {
                const { mainContent } = this.elements;
                const year = App.state.calendarDate.getFullYear(); const month = App.state.calendarDate.getMonth();
                const firstDay = new Date(year, month, 1); const lastDay = new Date(year, month + 1, 0);
                App.logic.applyRecurringExpenses(lastDay);
                let html = `<div class="calendar-controls"><button id="prev-month">&lt;</button><h2>${firstDay.toLocaleString('pt-BR',{month:'long',year:'numeric'})}</h2><button id="next-month">&gt;</button></div><div class="calendar-grid">`;
                html += ['D','S','T','Q','Q','S','S'].map(d => `<div class="calendar-header">${d}</div>`).join('');
                for (let i = 0; i < firstDay.getDay(); i++) html += `<div class="calendar-day other-month"></div>`;
                for (let day = 1; day <= lastDay.getDate(); day++) {
                    const dailyTransactions = App.state.transactions.filter(t => t.date.getFullYear() === year && t.date.getMonth() === month && t.date.getDate() === day);
                    const dailyTotal = dailyTransactions.reduce((sum, t) => sum + t.amount, 0);
                    html += `<div class="calendar-day"><div class="day-number">${day}</div><div class="day-summary">${dailyTotal > 0 ? `<div class="income">${App.logic.formatCurrency(dailyTotal)}</div>`:''}${dailyTotal < 0 ? `<div class="expense">${App.logic.formatCurrency(dailyTotal)}</div>`:''}</div></div>`;
                }
                html += `</div>`;
                mainContent.innerHTML = `<div class="card">${html}</div>`;
            },
            renderFlowList() {
                const container = document.getElementById('flow-list-container');
                if(!container) return;
                let balance = 0;
                const sortedForBalance = [...App.state.transactions].sort((a, b) => a.date - b.date);
                const balanceMap = new Map(); sortedForBalance.forEach(t => { balance += t.amount; balanceMap.set(t.id, balance); });
                const filteredTransactions = App.state.filterQuery ? App.state.transactions.filter(t => t.description.toLowerCase().includes(App.state.filterQuery.toLowerCase())) : App.state.transactions;
                if (filteredTransactions.length === 0) { container.innerHTML = `<div class="card"><p style="text-align: center; padding: 20px;">${App.state.filterQuery ? 'Nenhuma transação encontrada.' : 'Nenhuma transação registrada.'}</p></div>`;
                } else {
                    const listHTML = filteredTransactions.map(t => {
                        return `<li class="transaction-item"><div class="transaction-details"><div class="transaction-description">${t.description} ${t.recurringId ? '🔁' : ''}</div><div class="transaction-date">${t.date.toLocaleDateString('pt-BR')}</div></div><div class="transaction-amount-wrapper"><div class="transaction-amount"><span class="${t.amount > 0 ? 'income' : 'expense'}">${App.logic.formatCurrency(t.amount)}</span><div class="transaction-balance">Saldo: ${App.logic.formatCurrency(balanceMap.get(t.id))}</div></div></li>`;
                    }).join('');
                    container.innerHTML = `<div class="card"><ul class="transaction-list">${listHTML}</ul></div>`;
                }
            },
             renderRecurringList() {
                const container = document.getElementById('recurring-list');
                if(!container) return;
                if (App.state.recurringExpenses.length === 0) { container.innerHTML = `<p style="opacity: 0.7; text-align: center; margin: 15px 0;">Nenhum gasto recorrente.</p>`; } else {
                     const listHTML = App.state.recurringExpenses.sort((a,b) => a.day - b.day).map(exp => {
                         const endDateText = exp.endDate ? `Termina em ${new Date(exp.endDate + 'T00:00:00-03:00').toLocaleDateString('pt-BR')}` : '';
                         return `<li class="transaction-item"><div class="recurring-item-details"><span>${exp.description} (${App.logic.formatCurrency(exp.amount)}) - Dia ${exp.day}</span><div class="recurring-item-end-date">${endDateText}</div></div><button class="delete-btn" data-id="${exp.id}">Remover</button></li>`
                     }).join('');
                     container.innerHTML = `<ul class="transaction-list">${listHTML}</ul>`;
                }
            },
            renderModal() {
                const { modalContainer } = this.elements;
                const { activeModal } = App.state;
                modalContainer.innerHTML = '';
                if (!activeModal) return;

                let title = '', content = '';
                if (activeModal === 'add-tx') { title = 'Nova Transação'; content = this.templates.addTransactionModal(); }
                if (activeModal === 'flow') { title = 'Fluxo de Caixa'; content = this.templates.flowModal(); }
                if (activeModal === 'data') { title = 'Dados e Configurações'; content = this.templates.dataModal(); }

                modalContainer.innerHTML = this.templates.modal(`modal-${activeModal}`, title, content);
                document.getElementById(`modal-${activeModal}`).style.display = 'block';

                // After injecting modal, attach specific listeners and render content
                if (activeModal === 'add-tx') document.getElementById('date').valueAsDate = new Date();
                if (activeModal === 'flow') this.renderFlowList();
                if (activeModal === 'data') this.renderRecurringList();
            },
            render() { this.renderCalendar(); this.renderModal(); }
        },
        events: {
            handleTransactionSubmit(e) { e.preventDefault(); App.addTransaction({date: new Date(e.target.date.value + 'T00:00:00-03:00'), description: e.target.description.value, amount: parseFloat(e.target.amount.value)}); App.closeModal(); },
            handleRecurringSubmit(e) { e.preventDefault(); const form = e.target; App.addRecurringExpense({description: form['recurring-description'].value, amount: parseFloat(form['recurring-amount'].value), day: parseInt(form['recurring-day'].value), endDate: form['recurring-end-date'].value}); form.reset(); },
            handleCalendarNav(e) { if (e.target.id === 'prev-month') App.state.calendarDate.setMonth(App.state.calendarDate.getMonth() - 1); if (e.target.id === 'next-month') App.state.calendarDate.setMonth(App.state.calendarDate.getMonth() + 1); App.ui.render(); },
            handleFileImport(e) {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (event) => {
                    try {
                        const importedData = JSON.parse(event.target.result);
                        if (!confirm('Tem certeza? Todos os seus dados atuais serão substituídos por este backup.')) return;
                        App.state.transactions = importedData.transactions || [];
                        App.state.recurringExpenses = importedData.recurringExpenses || [];
                        App.data.load(); // Re-run load to parse dates
                        App.data.save();
                        App.ui.render();
                        App.closeModal();
                        alert('Dados importados com sucesso!');
                    } catch (err) { alert('Erro: O arquivo selecionado não é um JSON válido.'); }
                };
                reader.readAsText(file);
            },
            bind() {
                const { elements } = App.ui;
                elements.fabAddTx.addEventListener('click', () => App.openModal('add-tx'));
                elements.navFlow.addEventListener('click', () => App.openModal('flow'));
                elements.navData.addEventListener('click', () => App.openModal('data'));
                elements.mainContent.addEventListener('click', this.handleCalendarNav);
                // Listeners for dynamic modal content
                document.body.addEventListener('click', e => {
                    if (e.target.classList.contains('close-button')) App.closeModal();
                    if (e.target.id === 'btn-export') {
                         const dataStr = JSON.stringify(App.state, null, 2); const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr); const link = document.createElement('a'); link.setAttribute('href', dataUri); link.setAttribute('download', `dados_financeiros_${new Date().toISOString().slice(0,10)}.json`); link.click();
                    }
                    if (e.target.id === 'btn-import') document.getElementById('import-file-input').click();
                    const recurDelBtn = e.target.closest('.delete-btn'); if(recurDelBtn) App.deleteRecurringExpense(parseInt(recurDelBtn.dataset.id, 10));
                });
                document.body.addEventListener('submit', e => {
                    if (e.target.id === 'transaction-form') this.handleTransactionSubmit(e);
                    if (e.target.id === 'recurring-form') this.handleRecurringSubmit(e);
                });
                document.body.addEventListener('input', e => { if (e.target.id === 'filter') { App.state.filterQuery = e.target.value.toLowerCase(); App.ui.renderFlowList(); } });
                document.body.addEventListener('change', e => { if(e.target.id === 'import-file-input') this.handleFileImport(e); });
            }
        },
        openModal(modalId) { this.state.activeModal = modalId; this.ui.renderModal(); },
        closeModal() { this.state.activeModal = null; this.ui.renderModal(); },
        addTransaction({date, description, amount}) { if (!description || isNaN(amount)) return; this.state.transactions.push({ id: Date.now(), date, description, amount, recurringId: null }); this.logic.sortTransactions(this.state.transactions); this.data.save(); this.ui.render(); },
        addRecurringExpense({description, amount, day, endDate}) { if (amount > 0) amount = -amount; if (!description || isNaN(amount) || isNaN(day)) return; this.state.recurringExpenses.push({ id: Date.now(), description, amount, day, endDate: endDate || null, lastApplied: null }); if (this.logic.applyRecurringExpenses()) { this.data.save(); this.ui.renderCalendar(); } else this.data.save(); this.ui.renderRecurringList(); },
        deleteRecurringExpense(id) { if (!confirm('Remover esta regra e TODAS as suas transações?')) return; this.state.transactions = this.state.transactions.filter(t => t.recurringId !== id); this.state.recurringExpenses = this.state.recurringExpenses.filter(exp => exp.id !== id); this.data.save(); this.ui.renderRecurringList(); this.ui.renderCalendar(); },
        init() {
            this.ui.cacheDOMElements();
            this.data.load();
            if (this.logic.applyRecurringExpenses()) this.data.save();
            this.logic.sortTransactions(this.state.transactions);
            this.events.bind();
            this.ui.render();
            if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').then(reg => console.log('SW Registrado')).catch(err => console.error('SW Falhou:', err));
        }
    };
    document.addEventListener('DOMContentLoaded', () => App.init());
})();
