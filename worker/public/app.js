const state = { games: [], loans: [], selectedGames: [], books: [], bookLoans: [], selectedBooks: [], collection: 'games', month: new Date(), manager: false };
let loansRefreshInFlight = false;
const $ = (selector) => document.querySelector(selector);
const iso = (date) => { const local = new Date(date); local.setMinutes(local.getMinutes() - local.getTimezoneOffset()); return local.toISOString().slice(0, 10); };
const formatDate = (value) => new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full' }).format(new Date(`${value}T12:00:00`));
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);

async function loadGames() {
  const [gamesResponse, loansResponse] = await Promise.all([fetch('/api/games'), fetch('/api/loans')]);
  if (!gamesResponse.ok || !loansResponse.ok) throw new Error('Impossible de charger les données Grist.');
  state.games = await gamesResponse.json();
  console.table(state.games.map(({ id, Jeu }) => ({ id, Jeu })));
  state.loans = await loansResponse.json();
  loadSchools();
  $('#game-count').textContent = `${state.games.length} jeu${state.games.length > 1 ? 'x' : ''}`;
  $('#games-body').innerHTML = state.games.map((game) => `<tr data-game-id="${game.id}"><td class="selection-cell"><input type="checkbox" aria-label="Sélectionner ${escapeHtml(game.Jeu)}"></td><td><strong>${escapeHtml(game.Jeu)}</strong></td><td>${escapeHtml(game.Marque) || '—'}</td><td>${escapeHtml(game['Âge indiqué']) || '—'}</td><td>${escapeHtml(game.Joueurs) || '—'}</td><td>${escapeHtml(game.Remarques) || '—'}</td></tr>`).join('');
  document.querySelectorAll('#games-body tr').forEach((row) => { row.addEventListener('click', () => toggleGame(Number(row.dataset.gameId))); const checkbox = row.querySelector('input'); checkbox.addEventListener('click', (event) => event.stopPropagation()); checkbox.addEventListener('change', () => toggleGame(Number(row.dataset.gameId))); });
}
async function loadBooks() {
  const [booksResponse, loansResponse] = await Promise.all([
    fetch('/api/books', { cache: 'no-store' }),
    fetch('/api/book-loans', { cache: 'no-store' }),
  ]);
  if (!booksResponse.ok || !loansResponse.ok) {
    const failedResponse = !loansResponse.ok ? loansResponse : booksResponse;
    const detail = await failedResponse.json().catch(() => ({}));
    throw new Error(detail.detail || 'Impossible de charger l’inventaire et les réservations des livres et albums.');
  }
  state.books = await booksResponse.json();
  state.bookLoans = await loansResponse.json();
  loadSchools();
  $('#series-count').textContent = `${state.books.length} série${state.books.length > 1 ? 's' : ''}`;
  $('#series-body').innerHTML = state.books.map((book) => `<tr data-book-id="${book.id}"><td class="selection-cell"><input type="checkbox" aria-label="Sélectionner ${escapeHtml(book.Titre)}"></td><td><strong>${escapeHtml(book.Titre)}</strong></td><td>${escapeHtml(book.Auteur) || '—'}</td><td>${escapeHtml(book.Lieu) || '—'}</td><td><div class="book-quantity"><span>${escapeHtml(book.available_quantity)} disponible(s) / ${escapeHtml(book.quantity)} au total</span><input class="book-quantity-input" type="number" min="1" max="${Math.max(1, Number(book.available_quantity) || 1)}" value="1" ${Number(book.available_quantity) > 0 ? '' : 'disabled'} aria-label="Quantité demandée pour ${escapeHtml(book.Titre)}"></div></td></tr>`).join('');
  document.querySelectorAll('#series-body tr').forEach((row) => {
    row.addEventListener('click', (event) => { if (!event.target.closest('input')) toggleBook(Number(row.dataset.bookId)); });
    const checkbox = row.querySelector('input[type="checkbox"]');
    checkbox.addEventListener('click', (event) => event.stopPropagation());
    checkbox.addEventListener('change', () => toggleBook(Number(row.dataset.bookId)));
    row.querySelector('.book-quantity-input').addEventListener('input', () => {
      const book = state.selectedBooks.find((item) => item.id === Number(row.dataset.bookId));
      if (book) {
        book.requested_quantity = Math.max(1, Number(row.querySelector('.book-quantity-input').value) || 1);
        if (state.collection === 'books') renderSeriesCalendar();
      }
    });
  });
}
async function refreshBookData() {
  const selectedQuantities = new Map(state.selectedBooks.map((book) => [book.id, book.requested_quantity]));
  const [booksResponse, loansResponse] = await Promise.all([
    fetch('/api/books', { cache: 'no-store' }),
    fetch('/api/book-loans', { cache: 'no-store' }),
  ]);
  if (!booksResponse.ok || !loansResponse.ok) throw new Error('Impossible d’actualiser le stock des séries.');
  state.books = await booksResponse.json();
  state.bookLoans = await loansResponse.json();
  state.selectedBooks = state.books
    .filter((book) => selectedQuantities.has(book.id))
    .map((book) => ({ ...book, requested_quantity: Math.min(selectedQuantities.get(book.id), Math.max(1, Number(book.available_quantity) || 0)) }));
  document.querySelectorAll('#series-body tr').forEach((row) => {
    const book = state.books.find((item) => item.id === Number(row.dataset.bookId));
    if (!book) return;
    row.querySelector('.book-quantity span').textContent = `${book.available_quantity} disponible(s) / ${book.quantity} au total`;
    const quantityInput = row.querySelector('.book-quantity-input');
    quantityInput.max = Math.max(1, Number(book.available_quantity) || 1);
    quantityInput.disabled = Number(book.available_quantity) < 1;
    const selectedBook = state.selectedBooks.find((item) => item.id === book.id);
    if (selectedBook) quantityInput.value = selectedBook.requested_quantity;
    row.classList.toggle('selected', selectedQuantities.has(book.id));
    row.querySelector('input[type="checkbox"]').checked = selectedQuantities.has(book.id);
  });
}
async function refreshLoans() {
  if ((!state.games.length && !state.books.length) || loansRefreshInFlight) return;
  loansRefreshInFlight = true;
  try {
    const response = await fetch('/api/loans', { cache: 'no-store' });
    if (!response.ok) return;
    state.loans = await response.json();
    if (state.books.length && location.hash === '#series') {
      await refreshBookData();
    } else {
      const bookLoansResponse = await fetch('/api/book-loans', { cache: 'no-store' });
      if (bookLoansResponse.ok) state.bookLoans = await bookLoansResponse.json();
    }
    if (state.selectedGames.length) renderCalendar();
    if (state.selectedBooks.length) renderSeriesCalendar();
    const manageModal = $('#manage-modal');
    if (!manageModal.hidden && manageModal.dataset.date) {
      if (loansForDate(manageModal.dataset.date).length) openManageModal(manageModal.dataset.date);
      else closeManageModal();
    }
  } catch (error) {
    console.error('Actualisation des réservations impossible :', error);
  } finally {
    loansRefreshInFlight = false;
  }
}
function refreshLoansWhenVisible() {
  if (!document.hidden) refreshLoans();
}
async function loadSchools() { const input = $('input[name="school"]'); if (!input || input.tagName === 'SELECT') return; const style = getComputedStyle(input); const select = document.createElement('select'); select.name = 'school'; select.required = true; select.style.cssText = `width:${style.width};padding:${style.padding};font:${style.font};color:${style.color};background:${style.backgroundColor};border:${style.border};border-radius:${style.borderRadius};`; const loading = new Option('Chargement des écoles…', ''); loading.disabled = true; loading.selected = true; select.add(loading); input.replaceWith(select); try { const response = await fetch('/api/schools'); if (!response.ok) throw new Error('Liste des écoles indisponible.'); const schools = await response.json(); select.replaceChildren(new Option(schools.length ? 'Choisir une école' : 'Aucune école trouvée', '')); select.options[0].disabled = true; select.options[0].selected = true; schools.forEach((school) => select.add(new Option(school, school))); } catch { select.replaceChildren(new Option('Liste des écoles indisponible', '')); select.options[0].disabled = true; select.options[0].selected = true; } }
function toggleGame(id) {
  const game = state.games.find((item) => item.id === id);
  if (!game) return;
  const selected = state.selectedGames.some((item) => item.id === id);
  state.selectedGames = selected
    ? state.selectedGames.filter((item) => item.id !== id)
    : [...state.selectedGames, game];
  document.querySelectorAll('#games-body tr').forEach((row) => {
    const isSelected = state.selectedGames.some((item) => item.id === Number(row.dataset.gameId));
    row.classList.toggle('selected', isSelected);
    row.querySelector('input').checked = isSelected;
  });
  $('#empty-calendar').hidden = state.selectedGames.length > 0;
  $('#calendar-content').hidden = state.selectedGames.length === 0;
  if (state.selectedGames.length) {
    $('#selected-game').textContent = state.selectedGames.length === 1
      ? state.selectedGames[0].Jeu
      : `${state.selectedGames.length} jeux sélectionnés`;
    renderCalendar();
  }
}
function toggleBook(id) {
  const book = state.books.find((item) => item.id === id);
  if (!book) return;
  const selected = state.selectedBooks.some((item) => item.id === id);
  const row = document.querySelector(`#series-body tr[data-book-id="${id}"]`);
  state.selectedBooks = selected
    ? state.selectedBooks.filter((item) => item.id !== id)
    : [...state.selectedBooks, { ...book, requested_quantity: Math.max(1, Number(row?.querySelector('.book-quantity-input').value) || 1) }];
  if (!selected) {
    const today = iso(new Date());
    const reservations = state.bookLoans
      .filter((loan) => loan.is_active && loan.return_date >= today && state.selectedBooks.some((item) => sameBook(loan, item)))
      .sort((first, second) => first.loan_date.localeCompare(second.loan_date));
    const currentReservation = reservations.find((loan) => loan.loan_date <= today && today <= loan.occupied_until);
    const nextReservation = currentReservation || reservations.find((loan) => loan.loan_date >= today);
    if (nextReservation) state.month = new Date(`${nextReservation.loan_date}T12:00:00`);
    else if (state.selectedBooks.length === 1) state.month = new Date();
  }
  document.querySelectorAll('#series-body tr').forEach((row) => {
    const isSelected = state.selectedBooks.some((item) => item.id === Number(row.dataset.bookId));
    row.classList.toggle('selected', isSelected);
    row.querySelector('input[type="checkbox"]').checked = isSelected;
  });
  $('#series-empty-calendar').hidden = state.selectedBooks.length > 0;
  $('#series-calendar-content').hidden = state.selectedBooks.length === 0;
  if (state.selectedBooks.length) {
    $('#series-selected').textContent = state.selectedBooks.map((item) => item.Titre).join(' + ');
    renderSeriesCalendar();
  }
}
function clearGameSelection() {
  state.selectedGames = [];
  document.querySelectorAll('#games-body tr').forEach((row) => {
    row.classList.remove('selected');
    row.querySelector('input').checked = false;
  });
  $('#empty-calendar').hidden = false;
  $('#calendar-content').hidden = true;
}
function clearBookSelection() {
  state.selectedBooks = [];
  document.querySelectorAll('#series-body tr').forEach((row) => {
    row.classList.remove('selected');
    row.querySelector('input[type="checkbox"]').checked = false;
  });
  $('#series-empty-calendar').hidden = false;
  $('#series-calendar-content').hidden = true;
}
function occupiedDates() { const selectedIds = new Set(state.selectedGames.map((game) => game.id)); const days = new Set(); state.loans.filter((loan) => selectedIds.has(loan.game_id)).forEach((loan) => { const day = new Date(`${loan.loan_date}T12:00:00`); const end = new Date(`${loan.occupied_until || loan.return_date}T12:00:00`); while (day <= end) { days.add(iso(day)); day.setDate(day.getDate() + 1); } }); return days; }
function sameBook(loan, book) {
  if (Number(loan.book_id) === Number(book.id)) return true;
  const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr-FR');
  const loanTitle = normalize(loan.Titre);
  if (!loanTitle || loanTitle !== normalize(book.Titre)) return false;
  const sameTitleBooks = state.books.filter((item) => normalize(item.Titre) === loanTitle);
  if (sameTitleBooks.length === 1) return true;
  return ['Auteur', 'Lieu'].every((field) => {
    const loanValue = normalize(loan[field]);
    const bookValue = normalize(book[field]);
    return !loanValue || !bookValue || loanValue === bookValue;
  });
}
function bookAvailabilityForDate(book, date) {
  const bookings = state.bookLoans.filter((loan) => sameBook(loan, book));
  const total = Math.max(0, Number(book.quantity) || 0);
  const reserved = bookings
    .filter((loan) => loan.loan_date <= date && date <= (loan.occupied_until || loan.return_date))
    .reduce((sum, loan) => sum + loan.quantity, 0);
  return { total, available: Math.max(0, total - reserved) };
}
function seriesAvailability() {
  const days = new Map();
  const year = state.month.getFullYear();
  const month = state.month.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = iso(new Date(year, month, day));
    let fullyReserved = false;
    let partiallyReserved = false;
    for (const book of state.selectedBooks) {
      const { total, available } = bookAvailabilityForDate(book, date);
      fullyReserved ||= available === 0;
      partiallyReserved ||= available > 0 && available < total;
    }
    days.set(date, fullyReserved ? 'full' : partiallyReserved ? 'partial' : 'available');
  }
  return days;
}
function allBookings() { const source = state.collection === 'books' ? state.bookLoans : state.loans; const grouped = new Map(); source.forEach((loan) => { const key = [loan.name, loan.first_name, loan.professional_email, loan.school, loan.loan_date, loan.return_date, state.collection].join('\u001f'); if (!grouped.has(key)) grouped.set(key, { ...loan, collection: state.collection, ids: [], entries: [] }); const booking = grouped.get(key); booking.ids.push(loan.id); booking.entries.push(loan); }); return [...grouped.values()]; }
function loansForDate(date) { return allBookings().filter((booking) => booking.entries.some((loan) => { const selected = state.collection === 'books' ? state.selectedBooks.some((book) => sameBook(loan, book)) : state.selectedGames.some((game) => game.id === loan.game_id); return selected && loan.loan_date <= date && date <= (loan.occupied_until || loan.return_date); })); }
function renderCalendar() { const year = state.month.getFullYear(); const month = state.month.getMonth(); $('#calendar-month').textContent = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(state.month); const firstDay = (new Date(year, month, 1).getDay() + 6) % 7; const daysInMonth = new Date(year, month + 1, 0).getDate(); const today = iso(new Date()); const busy = occupiedDates(); let html = ''; for (let index = 0; index < firstDay; index += 1) html += '<button class="day empty" tabindex="-1" aria-hidden="true"></button>'; for (let day = 1; day <= daysInMonth; day += 1) { const date = iso(new Date(year, month, day)); const occupied = busy.has(date); const unavailable = occupied || date < today; const classes = ['day', occupied ? 'occupied' : '', date < today ? 'past' : '', date === today ? 'today' : ''].filter(Boolean).join(' '); const disabled = unavailable && !state.manager; html += `<button class="${classes}" data-date="${date}" ${disabled ? 'disabled' : ''}>${day}</button>`; } $('#calendar-grid').innerHTML = html; document.querySelectorAll('#calendar-grid .day:not(.empty)').forEach((button) => button.addEventListener('click', () => { if (button.classList.contains('occupied')) openManageModal(button.dataset.date); else openModal(button.dataset.date); })); }
function renderSeriesCalendar() {
  const year = state.month.getFullYear();
  const month = state.month.getMonth();
  $('#series-calendar-month').textContent = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(state.month);
  const firstDay = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = iso(new Date());
  const availability = seriesAvailability();
  let html = '';
  for (let index = 0; index < firstDay; index += 1) html += '<button class="day empty" tabindex="-1" aria-hidden="true"></button>';
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = iso(new Date(year, month, day));
    const status = availability.get(date);
    const occupied = status === 'full';
    const unavailable = occupied || date < today;
    const classes = ['day', occupied ? 'occupied' : '', status === 'partial' ? 'partial' : '', date < today ? 'past' : '', date === today ? 'today' : ''].filter(Boolean).join(' ');
    const disabled = unavailable && !state.manager;
    html += `<button class="${classes}" data-date="${date}" ${disabled ? 'disabled' : ''}>${day}</button>`;
  }
  $('#series-calendar-grid').innerHTML = html;
  document.querySelectorAll('#series-calendar-grid .day:not(.empty)').forEach((button) => button.addEventListener('click', () => {
    if (button.classList.contains('occupied') || (state.manager && button.classList.contains('partial'))) openManageModal(button.dataset.date);
    else openModal(button.dataset.date);
  }));
}
function availableQuantityForPeriod(book, startDate, endDate) {
  const bookings = state.bookLoans.filter((loan) => sameBook(loan, book));
  const changeDates = new Set([startDate]);
  for (const loan of bookings) {
    if (loan.loan_date > startDate && loan.loan_date <= endDate) changeDates.add(loan.loan_date);
    const nextAvailable = new Date(`${loan.occupied_until || loan.return_date}T12:00:00`);
    nextAvailable.setDate(nextAvailable.getDate() + 1);
    const nextAvailableDate = iso(nextAvailable);
    if (nextAvailableDate > startDate && nextAvailableDate <= endDate) changeDates.add(nextAvailableDate);
  }
  return Math.min(...[...changeDates].map((date) => bookAvailabilityForDate(book, date).available));
}
function renderBookQuantityFields(startDate, endDate) {
  const container = $('#book-quantity-fields');
  const isBooks = state.collection === 'books';
  container.hidden = !isBooks;
  const submitButton = $('#loan-form').querySelector('button[type="submit"]');
  if (!isBooks) {
    submitButton.disabled = false;
    return;
  }
  let noStock = false;
  container.innerHTML = state.selectedBooks.map((book) => {
    const available = Math.min(Number(book.available_quantity) || 0, availableQuantityForPeriod(book, startDate, endDate));
    if (!available) noStock = true;
    book.requested_quantity = available ? Math.min(book.requested_quantity, available) : 1;
    return `<div class="book-quantity-item"><div><strong>${escapeHtml(book.Titre)}</strong><span>Disponible sur cette période : ${available}</span></div><label>Exemplaires<input data-book-quantity="${book.id}" type="number" min="1" max="${Math.max(1, available)}" value="${book.requested_quantity}" ${available ? '' : 'disabled'} required></label></div>${available ? '' : '<p class="form-error">Aucun exemplaire disponible sur cette période.</p>'}`;
  }).join('');
  submitButton.disabled = noStock;
  $('#loan-form').dataset.bookSelection = JSON.stringify(state.selectedBooks.map((book) => ({ id: book.id, quantity: book.requested_quantity })));
  container.querySelectorAll('[data-book-quantity]').forEach((input) => input.addEventListener('input', () => {
    const book = state.selectedBooks.find((item) => item.id === Number(input.dataset.bookQuantity));
    if (!book) return;
    const maximum = Number(input.max);
    book.requested_quantity = Math.min(maximum, Math.max(1, Number(input.value) || 1));
    input.value = book.requested_quantity;
    const inventoryInput = document.querySelector(`#series-body tr[data-book-id="${book.id}"] .book-quantity-input`);
    if (inventoryInput) inventoryInput.value = book.requested_quantity;
    $('#loan-form').dataset.bookSelection = JSON.stringify(state.selectedBooks.map((item) => ({ id: item.id, quantity: item.requested_quantity })));
  }));
}
function openModal(date) {
  const form = $('#loan-form');
  const startInput = $('#loan-start-date');
  const endInput = $('#loan-end-date');
  $('#modal-title').textContent = state.collection === 'books'
    ? state.selectedBooks.map((item) => `${item.Titre} × ${item.requested_quantity}`).join(' + ')
    : state.selectedGames.map((item) => item.Jeu).join(' + ');
  form.dataset.gameIds = JSON.stringify(state.selectedGames.map((item) => item.id));
  form.dataset.bookSelection = JSON.stringify(state.selectedBooks.map((item) => ({ id: item.id, quantity: item.requested_quantity })));
  form.dataset.collection = state.collection;
  form.reset();
  startInput.value = date;
  endInput.value = iso(new Date(new Date(`${date}T12:00:00`).getTime() + 20 * 86400000));
  const updateDates = () => {
    endInput.min = startInput.value;
    if (!startInput.value || !endInput.value) {
      $('#modal-date').textContent = 'Choisissez une période de réservation';
      return;
    }
    if (endInput.value < startInput.value) endInput.value = startInput.value;
    $('#modal-date').textContent = `Du ${formatDate(startInput.value)} au ${formatDate(endInput.value)}`;
    renderBookQuantityFields(startInput.value, endInput.value);
  };
  startInput.onchange = updateDates;
  endInput.onchange = updateDates;
  updateDates();
  $('#form-error').textContent = '';
  $('#loan-modal').hidden = false;
  form.querySelector('input[name="name"]').focus();
}
function closeModal() { $('#loan-modal').hidden = true; }
function showToast(message) { const toast = $('#toast'); toast.textContent = message; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 3500); }
async function submitLoan(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const gameIds = JSON.parse(form.dataset.gameIds);
  const bookSelection = JSON.parse(form.dataset.bookSelection || '[]');
  const isBooks = form.dataset.collection === 'books';
  const loanDate = data.loan_date;
  const endDate = data.end_date;
  const summary = isBooks
    ? bookSelection.map((item) => `${state.books.find((book) => book.id === item.id)?.Titre || 'Série'} × ${item.quantity}`).join(', ')
    : `${gameIds.length} jeu${gameIds.length > 1 ? 'x' : ''}`;
  if (!confirm(`Confirmer la réservation de ${summary} du ${formatDate(loanDate)} au ${formatDate(endDate)} ?`)) return;
  const printWindow = window.open('', '_blank');
  const response = await fetch(isBooks ? '/api/book-loans/batch' : '/api/loans/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(isBooks ? { ...data, books: bookSelection } : { ...data, game_ids: gameIds }) });
  const result = await response.json();
  if (!response.ok) {
    printWindow?.close();
    $('#form-error').textContent = result.detail || 'La réservation n’a pas pu être enregistrée.';
    return;
  }
  const returnDate = result[0]?.return_date || endDate;
  if (printWindow) printSheet('Fiche d’emprunt', data, isBooks ? bookSelection.map((item) => `${state.books.find((book) => book.id === item.id)?.Titre || 'Série'} × ${item.quantity}`) : state.selectedGames, loanDate, returnDate, printWindow);
  if (isBooks) {
    state.bookLoans.push(...result);
    closeModal();
    renderSeriesCalendar();
    refreshBookData()
      .then(renderSeriesCalendar)
      .catch((error) => console.error('Actualisation du stock après réservation impossible :', error));
  } else {
    state.loans.push(...result);
    closeModal();
    renderCalendar();
    clearGameSelection();
  }
  const emailStatus = response.headers.get('X-Email-Status');
  const emailError = response.headers.get('X-Email-Error');
  const printStatus = printWindow ? 'La fiche est prête à imprimer en PDF.' : 'Autorisez les fenêtres surgissantes pour imprimer la fiche.';
  const emailMessage = emailStatus === 'sending'
    ? 'Le courriel de confirmation est en cours d’envoi.'
    : emailStatus === 'pending'
    ? isBooks ? 'Le courriel de confirmation sera envoyé le jour de l’emprunt.' : 'Le courriel de confirmation est en cours d’envoi.'
    : emailStatus === 'sent'
      ? 'Le courriel de confirmation a été envoyé.'
      : `Échec du courriel : ${emailError ? decodeURIComponent(emailError) : 'aucun détail reçu'}.`;
  showToast(`Réservation enregistrée. ${printStatus} ${emailMessage}`);
}
function syncManagerButtons() { $('#manager-button').hidden = state.manager; $('#logout-manager').hidden = !state.manager; }
window.addEventListener('hashchange', syncManagerButtons);
syncManagerButtons();
async function loginManager(event) { event.preventDefault(); const form = event.currentTarget; const response = await fetch('/api/manager/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: form.password.value }) }); const result = await response.json(); if (!response.ok) { $('#manager-error').textContent = result.detail || 'Connexion impossible.'; return; } state.manager = true; syncManagerButtons(); form.reset(); $('#manager-modal').hidden = true; if (state.selectedGames.length) renderCalendar(); if (state.selectedBooks.length) renderSeriesCalendar(); showToast('Mode gestionnaire activé.'); }
function openManagerModal() { $('#manager-error').textContent = ''; $('#manager-modal').hidden = false; $('#manager-password').focus(); }
function closeManagerModal() { $('#manager-modal').hidden = true; }
async function logoutManager() {
  showToast('Déconnexion en cours…');
  state.manager = false;
  clearGameSelection();
  clearBookSelection();
  closeManageModal();
  closeManagerModal();
  syncManagerButtons();
  location.hash = '#home';
  try {
    const response = await fetch('/api/manager/logout', { method: 'POST', cache: 'no-store', credentials: 'same-origin' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.detail || `Erreur HTTP ${response.status}`);
    showToast('Déconnexion effectuée. Retour à l’accueil…');
    window.location.replace('/#home');
  } catch (error) {
    showToast(`Interface publique rétablie, mais la session serveur n’a pas été effacée : ${error.message || 'erreur réseau'}`);
  }
}
$('#logout-manager').addEventListener('click', logoutManager);
function openManageModal(date) { const bookings = loansForDate(date); if (!bookings.length) return; $('#manage-modal').dataset.date = date; $('#manage-date').textContent = formatDate(date); $('#manage-list').innerHTML = bookings.map((booking) => { const resources = booking.entries.map((loan) => booking.collection === 'books' ? `${state.books.find((item) => item.id === loan.book_id)?.Titre || 'Série'} × ${loan.quantity}` : state.games.find((item) => item.id === loan.game_id)?.Jeu || 'Jeu'); return `<article class="manage-item"><div><strong>${escapeHtml(resources.join(' + '))}</strong><span>${escapeHtml(booking.name)} ${escapeHtml(booking.first_name)} · du ${formatDate(booking.loan_date)} au ${formatDate(booking.return_date)}</span></div><div class="manage-actions"><button class="secondary-button" data-print-id="${booking.id}" type="button">Fiche</button><button class="secondary-button" data-return-id="${booking.id}" data-return-date="${date}" type="button">Annuler à partir de cette date</button><button class="danger-button" data-delete-id="${booking.id}" data-return-date="${date}" type="button">Supprimer toute la réservation</button></div></article>`; }).join(''); $('#manage-modal').hidden = false; document.querySelectorAll('[data-print-id]').forEach((button) => button.addEventListener('click', () => printLoan(Number(button.dataset.printId)))); document.querySelectorAll('[data-return-id]').forEach((button) => button.addEventListener('click', () => returnLoan(Number(button.dataset.returnId), button.dataset.returnDate))); document.querySelectorAll('[data-delete-id]').forEach((button) => button.addEventListener('click', () => deleteBooking(Number(button.dataset.deleteId), button.dataset.returnDate))); }
function closeManageModal() { $('#manage-modal').hidden = true; }
async function returnLoan(id, date) { const booking = allBookings().find((item) => item.id === id); if (!booking || !confirm(`Annuler uniquement cette réservation à partir du ${formatDate(date)} ? Les autres réservations, y compris futures, restent inchangées.`)) return; const printWindow = window.open('', '_blank'); try { const response = await fetch('/api/loans/return', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loan_ids: booking.ids.map(Number), return_date: date, collection: booking.collection }) }); const result = await response.json(); if (!response.ok) throw new Error(result.detail || 'La date de retour n’a pas pu être enregistrée dans Grist.'); } catch (error) { printWindow?.close(); showToast(error.message || 'La date de retour n’a pas pu être enregistrée dans Grist.'); return; } const occupiedUntil = iso(new Date(new Date(`${date}T12:00:00`).getTime() - 86400000)); const ids = new Set(booking.ids.map(String)); const source = booking.collection === 'books' ? state.bookLoans : state.loans; const updated = source.map((loan) => ids.has(String(loan.id)) ? { ...loan, return_date: date, occupied_until: occupiedUntil } : loan); if (booking.collection === 'books') state.bookLoans = updated; else state.loans = updated; const resources = booking.entries.map((loan) => booking.collection === 'books' ? `${state.books.find((book) => book.id === loan.book_id)?.Titre || 'Série'} × ${loan.quantity}` : state.games.find((game) => game.id === loan.game_id)?.Jeu || 'Jeu'); closeManageModal(); if (booking.collection === 'books') renderSeriesCalendar(); else renderCalendar(); if (printWindow) printSheet('Fiche de retour', booking, resources, booking.loan_date, date, printWindow); showToast(`Retour enregistré dans Grist.${printWindow ? ' Fiche prête à imprimer en PDF.' : ''}`); }
async function deleteBooking(id, returnDate) { const booking = allBookings().find((item) => item.id === id); if (!booking || !confirm('Annuler toute cette réservation ? Les autres réservations, y compris futures, restent inchangées.')) return; const printWindow = window.open('', '_blank'); try { const response = await fetch('/api/loans/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loan_ids: booking.ids.map(Number), cancelled_date: returnDate, collection: booking.collection }) }); const result = await response.json(); if (!response.ok) throw new Error(result.detail || 'L’annulation n’a pas pu être enregistrée dans Grist.'); } catch (error) { printWindow?.close(); showToast(error.message || 'L’annulation n’a pas pu être enregistrée dans Grist.'); return; } const removedIds = new Set(booking.ids.map(String)); if (booking.collection === 'books') state.bookLoans = state.bookLoans.filter((loan) => !removedIds.has(String(loan.id))); else state.loans = state.loans.filter((loan) => !removedIds.has(String(loan.id))); closeManageModal(); if (booking.collection === 'books') renderSeriesCalendar(); else renderCalendar(); const resources = booking.entries.map((loan) => booking.collection === 'books' ? `${state.books.find((book) => book.id === loan.book_id)?.Titre || 'Série'} × ${loan.quantity}` : state.games.find((game) => game.id === loan.game_id)?.Jeu || 'Jeu'); if (printWindow) printSheet('Fiche de retour', booking, resources, booking.loan_date, returnDate, printWindow); showToast('Annulation enregistrée dans Grist.'); }
function printLoan(id) { const booking = allBookings().find((item) => item.id === id); if (!booking) return; const resources = booking.entries.map((loan) => booking.collection === 'books' ? `${state.books.find((book) => book.id === loan.book_id)?.Titre || 'Série'} × ${loan.quantity}` : state.games.find((game) => game.id === loan.game_id)?.Jeu || 'Jeu'); printSheet('Fiche d’emprunt', booking, resources, booking.loan_date, booking.return_date); }
function printSheet(title, borrower, resources, loanDate, returnDate, printWindow = window.open('', '_blank')) { if (!printWindow) return; const resourceList = resources.map((resource) => `<li>${escapeHtml(typeof resource === 'string' ? resource : resource.Jeu)}</li>`).join(''); printWindow.document.open(); printWindow.document.write(`<title>${escapeHtml(title)}</title><style>body{font:16px Arial;max-width:680px;margin:50px auto;color:#182c28}h1{font-size:28px;border-bottom:2px solid #18734a;padding-bottom:14px}h2{font-size:18px;margin-top:32px}p{margin:18px 0}strong{display:block;font-size:12px;text-transform:uppercase;color:#18734a;margin-bottom:5px}li{margin:8px 0}.print-action{border:0;background:#18734a;color:#fff;padding:12px 18px;font:bold 14px Arial;cursor:pointer}@media print{body{margin:20mm auto}.print-action{display:none}}</style><button class="print-action" type="button" onclick="window.print()">Imprimer cette fiche</button><h1>${escapeHtml(title)}</h1><p><strong>Nom</strong>${escapeHtml(borrower.name)}</p><p><strong>Prénom</strong>${escapeHtml(borrower.first_name)}</p><p><strong>Mail professionnel</strong>${escapeHtml(borrower.professional_email)}</p><p><strong>École</strong>${escapeHtml(borrower.school)}</p><h2>Ressources empruntées</h2><ul>${resourceList}</ul><p><strong>Date d’emprunt</strong>${formatDate(loanDate)}</p><p><strong>Date de retour</strong>${formatDate(returnDate)}</p>`); printWindow.document.close(); window.focus(); }
function route() { const games = location.hash === '#jeux'; const books = location.hash === '#series'; state.collection = books ? 'books' : 'games'; $('#home-view').hidden = games || books; $('#games-view').hidden = !games; $('#series-view').hidden = !books; if (games && !state.games.length) loadGames().catch((error) => { $('#games-body').innerHTML = `<tr><td colspan="6" class="loading">${escapeHtml(error.message)}</td></tr>`; }); if (books && !state.books.length) loadBooks().catch((error) => { $('#series-body').innerHTML = `<tr><td colspan="5" class="loading">${escapeHtml(error.message)}</td></tr>`; }); else if (books) refreshBookData().then(() => { if (state.selectedBooks.length) renderSeriesCalendar(); }).catch((error) => console.error('Actualisation des séries impossible :', error)); }
window.addEventListener('hashchange', route); window.addEventListener('focus', refreshLoansWhenVisible); document.addEventListener('visibilitychange', refreshLoansWhenVisible); setInterval(refreshLoansWhenVisible, 15000); $('#previous-month').addEventListener('click', () => { state.month.setMonth(state.month.getMonth() - 1); renderCalendar(); }); $('#next-month').addEventListener('click', () => { state.month.setMonth(state.month.getMonth() + 1); renderCalendar(); }); $('#series-previous-month').addEventListener('click', () => { state.month.setMonth(state.month.getMonth() - 1); renderSeriesCalendar(); }); $('#series-next-month').addEventListener('click', () => { state.month.setMonth(state.month.getMonth() + 1); renderSeriesCalendar(); }); $('#close-modal').addEventListener('click', closeModal); $('#loan-modal').addEventListener('click', (event) => { if (event.target.id === 'loan-modal') closeModal(); }); $('#loan-form').addEventListener('submit', submitLoan); $('#manager-button').addEventListener('click', openManagerModal); $('#manager-modal').addEventListener('click', (event) => { if (event.target.id === 'manager-modal') closeManagerModal(); }); $('#close-manager-modal').addEventListener('click', closeManagerModal); $('#manager-form').addEventListener('submit', loginManager); $('#manage-modal').addEventListener('click', (event) => { if (event.target.id === 'manage-modal') closeManageModal(); }); $('#close-manage-modal').addEventListener('click', closeManageModal); document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { if (!$('#loan-modal').hidden) closeModal(); if (!$('#manager-modal').hidden) closeManagerModal(); if (!$('#manage-modal').hidden) closeManageModal(); } }); route();
