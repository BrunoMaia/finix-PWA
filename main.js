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
        /**
         * @property {object} state - A "única fonte da verdade". Todos os dados que a aplicação utiliza vivem aqui.
         */
        state: {
            transactions: [],
            recurringExpenses: [],
            currentView: 'flow',
            calendarDate: new Date(),
            filterQuery: ''
        },
        
        /**
         * @property {object} config - Constantes e configurações da aplicação.
         */
        config: {
            storageKey: 'financePWAData_v5'
        },

        /**
         * @namespace data
         * @description Módulo responsável pela persistência dos dados (leitura e escrita no localStorage).
         */
        data: {
            /**
             * Salva o estado atual da aplicação no localStorage.
             */
            save() {
                localStorage.setItem(App.config.storageKey, JSON.stringify(App.state));
            },
            /**
             * Carrega os dados do localStorage para o estado da aplicação.
             */
            load() {
                const data = localStorage.getItem(App.config.storageKey);
                if (!data) return;
                
                const parsedData = JSON.parse(data);
                // Garante que as strings de data sejam convertidas de volta para objetos Date.
                if (parsedData.transactions) parsedData.transactions.forEach(t => t.date = new Date(t.date));
                
                App.state = { ...App.state, ...parsedData };
            }
        },

        /**
         * @namespace logic
         * @description Contém a lógica de negócio "pura", ou seja, funções que manipulam dados sem interagir com a tela.
         */
        logic: {
            /**
             * Ordena as transações da mais recente para a mais antiga.
             * @param {Array} transactions - A lista de transações.
             * @returns {Array} A lista de transações ordenada.
             */
            sortTransactions: (transactions) => transactions.sort((a, b) => new Date(b.date) - new Date(a.date)),
            
            /**
             * Verifica e aplica despesas recorrentes que estão pendentes até uma data específica.
             * @param {Date} [applyUntilDate=new Date()] - A data limite para aplicar as despesas.
             * @returns {boolean} - Retorna true se alguma nova transação foi adicionada.
             */
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

            /**
             * Formata um número para a moeda local (BRL).
             * @param {number} value - O valor a ser formatado.
             * @returns {string} - O valor formatado como moeda.
             */
            formatCurrency: (value) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        },
        
        /**
         * @namespace ui
         * @description Módulo que controla todas as interações com o DOM (a interface do usuário).
         */
        ui: {
            elements: {},
            
            /**
             * Mapeia os elementos HTML para um objeto para acesso rápido, evitando múltiplas chamadas a `getElementById`.
             */
            cacheDOMElements() {
                this.elements = {
                    dateInput: document.getElementById('date'), viewContainer: document.getElementById('view-container'), btnFlowView: document.getElementById('btn-flow-view'),
                    btnCalendarView: document.getElementById('btn-calendar-view'), recurringModal: document.getElementById('recurring-modal'), recurringForm: document.getElementById('recurring-form'),
                    recurringList: document.getElementById('recurring-list'), filterCard: document.getElementById('filter-card'), filterInput: document.getElementById('filter'),
                    transactionForm: document.getElementById('transaction-form'), exportButton: document.getElementById('btn-export'), recurringButton: document.getElementById('btn-recurring'),
                    modalCloseButton: document.querySelector('.close-button'),
                };
            },

            /**
             * @namespace templates
             * @description Funções que geram o HTML para partes da UI, mantendo o HTML fora da lógica de renderização.
             */
            templates: {
                transactionItem(t, balance) { return `<div class="transaction-details"><div class="transaction-description">${t.description} ${t.recurringId ? '🔁' : ''}</div><div class="transaction-date">${t.date.toLocaleDateString('pt-BR')}</div></div><div class="transaction-amount-wrapper"><div class="transaction-amount"><span class="${t.amount > 0 ? 'income' : 'expense'}">${App.logic.formatCurrency(t.amount)}</span><div class="transaction-balance">Saldo: ${App.logic.formatCurrency(balance)}</div></div><button class="delete-transaction-btn" data-id="${t.id}" title="Remover transação">&times;</button></div>`; },
                recurringItem(exp) { const endDateText = exp.endDate ? `Termina em ${new Date(exp.endDate + 'T00:00:00-03:00').toLocaleDateString('pt-BR')}` : ''; return `<div class="recurring-item-details"><span>${exp.description} (${App.logic.formatCurrency(exp.amount)}) - Dia ${exp.day}</span><div class="recurring-item-end-date">${endDateText}</div></div><button class="delete-btn" data-id="${exp.id}">Remover</button>`;},
            },

            /**
             * Renderiza a visualização de fluxo contínuo.
             */
            renderFlowView() {
                const { viewContainer } = this.elements;
                viewContainer.innerHTML = '';
                const list = document.createElement('ul'); list.className = 'transaction-list card';
                let balance = 0;
                const sortedForBalance = [...App.state.transactions].sort((a, b) => a.date - b.date);
                const balanceMap = new Map(); sortedForBalance.forEach(t => { balance += t.amount; balanceMap.set(t.id, balance); });
                const filteredTransactions = App.state.filterQuery ? App.state.transactions.filter(t => t.description.toLowerCase().includes(App.state.filterQuery.toLowerCase())) : App.state.transactions;
                if (filteredTransactions.length === 0) { list.innerHTML = `<p style="text-align: center; padding: 20px;">${App.state.filterQuery ? 'Nenhuma transação encontrada.' : 'Nenhuma transação registrada.'}</p>`;
                } else { list.innerHTML = filteredTransactions.map(t => `<li class="transaction-item">${this.templates.transactionItem(t, balanceMap.get(t.id))}</li>`).join(''); }
                viewContainer.appendChild(list);
            },

            /**
             * Renderiza a visualização de calendário.
             */
            renderCalendarView() {
                const { viewContainer } = this.elements; viewContainer.innerHTML = '';
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
                html += `</div>`; viewContainer.innerHTML = `<div class="card">${html}</div>`;
            },
            
            /**
             * Renderiza a lista de gastos recorrentes dentro do modal.
             */
            renderRecurringList() {
                const { recurringList } = this.elements;
                if (App.state.recurringExpenses.length === 0) { recurringList.innerHTML = `<p style="opacity: 0.7; text-align: center; margin: 15px 0;">Nenhum gasto recorrente.</p>`; } else {
                     recurringList.innerHTML = App.state.recurringExpenses.sort((a,b) => a.day - b.day).map(exp => `<div class="transaction-item">${this.templates.recurringItem(exp)}</div>`).join('');
                }
            },
            
            /**
             * Mostra ou esconde o modal.
             * @param {boolean} show - True para mostrar, false para esconder.
             */
            toggleModal(show) { this.elements.recurringModal.style.display = show ? 'block' : 'none'; if (show) this.renderRecurringList(); },
            
            /**
             * Atualiza o estado visual dos botões de navegação e do filtro.
             */
            updateViewButtons() {
                this.elements.btnFlowView.classList.toggle('active', App.state.currentView === 'flow');
                this.elements.btnCalendarView.classList.toggle('active', App.state.currentView === 'calendar');
                this.elements.filterCard.style.display = App.state.currentView === 'flow' ? 'block' : 'none';
            },

            /**
             * Função principal de renderização que decide qual visualização desenhar.
             */
            render() { this.updateViewButtons(); if (App.state.currentView === 'flow') this.renderFlowView(); else this.renderCalendarView(); }
        },
        
        /**
         * @namespace events
         * @description Módulo que anexa todos os event listeners e lida com as ações do usuário.
         */
        events: {
            handleTransactionSubmit(e) { e.preventDefault(); const { dateInput, transactionForm } = App.ui.elements; App.addTransaction({date: new Date(transactionForm.date.value + 'T00:00:00-03:00'), description: transactionForm.description.value, amount: parseFloat(transactionForm.amount.value)}); transactionForm.reset(); dateInput.valueAsDate = new Date(); },
            handleRecurringSubmit(e) { e.preventDefault(); const form = e.target; App.addRecurringExpense({description: form['recurring-description'].value, amount: parseFloat(form['recurring-amount'].value), day: parseInt(form['recurring-day'].value), endDate: form['recurring-end-date'].value}); form.reset(); },
            handleDeleteRecurring(e) { const btn = e.target.closest('.delete-btn'); if (btn) App.deleteRecurringExpense(parseInt(btn.dataset.id, 10)); },
            handleDeleteTransaction(e) { const btn = e.target.closest('.delete-transaction-btn'); if (btn) App.deleteTransaction(parseInt(btn.dataset.id, 10)); },
            handleCalendarNav(e) { if (e.target.id === 'prev-month') App.state.calendarDate.setMonth(App.state.calendarDate.getMonth() - 1); if (e.target.id === 'next-month') App.state.calendarDate.setMonth(App.state.calendarDate.getMonth() + 1); App.ui.render(); },
            
            /**
             * Centraliza a anexação de todos os event listeners da aplicação.
             */
            bind() {
                const { elements } = App.ui;
                elements.transactionForm.addEventListener('submit', this.handleTransactionSubmit);
                elements.recurringForm.addEventListener('submit', this.handleRecurringSubmit);
                elements.recurringList.addEventListener('click', this.handleDeleteRecurring);
                elements.recurringButton.addEventListener('click', () => App.ui.toggleModal(true));
                elements.modalCloseButton.addEventListener('click', () => App.ui.toggleModal(false));
                window.addEventListener('click', (e) => { if (e.target === elements.recurringModal) App.ui.toggleModal(false); });
                elements.viewContainer.addEventListener('click', this.handleDeleteTransaction);
                elements.viewContainer.addEventListener('click', this.handleCalendarNav);
                elements.filterInput.addEventListener('input', e => App.setFilter(e.target.value));
                elements.btnFlowView.addEventListener('click', () => App.setView('flow'));
                elements.btnCalendarView.addEventListener('click', () => App.setView('calendar'));
                elements.exportButton.addEventListener('click', () => { const dataStr = JSON.stringify(App.state, null, 2); const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr); const link = document.createElement('a'); link.setAttribute('href', dataUri); link.setAttribute('download', `dados_financeiros_${new Date().toISOString().slice(0,10)}.json`); link.click(); });
            }
        },
        
        // --- Métodos "Controladores" da Aplicação ---
        // Estas funções são chamadas pelos eventos e orquestram as mudanças de estado e UI.

        addTransaction({date, description, amount}) { if (!description || isNaN(amount)) return alert('Dados da transação inválidos.'); this.state.transactions.push({ id: Date.now(), date, description, amount, recurringId: null }); this.logic.sortTransactions(this.state.transactions); this.data.save(); this.ui.render(); },
        deleteTransaction(id) { const tx = this.state.transactions.find(t => t.id === id); if (tx && tx.recurringId) return alert('Transações recorrentes devem ser removidas pela regra em "Gastos Recorrentes".'); if (!confirm('Remover esta transação?')) return; this.state.transactions = this.state.transactions.filter(t => t.id !== id); this.data.save(); this.ui.render(); },
        addRecurringExpense({description, amount, day, endDate}) { if (amount > 0) amount = -amount; if (!description || isNaN(amount) || isNaN(day)) return alert('Dados do gasto recorrente inválidos.'); this.state.recurringExpenses.push({ id: Date.now(), description, amount, day, endDate: endDate || null, lastApplied: null }); if (this.logic.applyRecurringExpenses()) this.data.save(); else this.data.save(); this.ui.render(); this.ui.renderRecurringList(); },
        deleteRecurringExpense(id) { if (!confirm('Deseja remover esta regra e TODAS as suas transações? Esta ação não pode ser desfeita.')) return; this.state.transactions = this.state.transactions.filter(t => t.recurringId !== id); this.state.recurringExpenses = this.state.recurringExpenses.filter(exp => exp.id !== id); this.data.save(); this.ui.renderRecurringList(); this.ui.render(); },
        setView(view) { this.state.currentView = view; if (view === 'calendar') { this.state.filterQuery = ''; this.ui.elements.filterInput.value = ''; } this.ui.render(); },
        setFilter(query) { this.state.filterQuery = query.toLowerCase(); this.ui.render(); },
        
        /**
         * @function init
         * @description Ponto de entrada da aplicação. Inicializa todos os módulos.
         */
        init() {
            this.ui.cacheDOMElements();
            this.data.load();
            if (this.logic.applyRecurringExpenses()) this.data.save();
            this.logic.sortTransactions(this.state.transactions);
            this.events.bind();
            this.ui.elements.dateInput.valueAsDate = new Date();
            this.ui.render();

            // Registo do Service Worker para PWA.
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.register('./sw.js')
                    .then(reg => console.log('Service Worker Registrado com sucesso.', reg))
                    .catch(err => console.error('Falha ao registrar Service Worker:', err));
            }
        }
    };

    // Inicia a aplicação quando o DOM estiver pronto.
    document.addEventListener('DOMContentLoaded', () => App.init());

})();