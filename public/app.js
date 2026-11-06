const state = { games: [], loans: [], selectedGames: [], books: [], bookLoans: [], selectedBooks: [], equipment: [], digitalLoans: [], selectedEquipment: [], collection: 'games', month: new Date(), manager: false };
let loansRefreshInFlight = false;
const $ = (selector) => document.querySelector(selector);
const iso = (date) => { const local = new Date(date); local.setMinutes(local.getMinutes() - local.getTimezoneOffset()); return local.toISOString().slice(0, 10); };
const formatDate = (value) => new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full' }).format(new Date(`${value}T12:00:00`));
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
const normalizeSearchText = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('fr-FR');

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
async function loadDigital() {
  const [inventoryResponse, loansResponse] = await Promise.all([
    fetch('/api/digital-equipment', { cache: 'no-store' }),
    fetch('/api/digital-loans', { cache: 'no-store' }),
  ]);
  if (!inventoryResponse.ok || !loansResponse.ok) {
    const failedResponse = !loansResponse.ok ? loansResponse : inventoryResponse;
    const detail = await failedResponse.json().catch(() => ({}));
    throw new Error(detail.detail || 'Impossible de charger l’inventaire et les pré-réservations numériques.');
  }
  state.equipment = await inventoryResponse.json();
  state.digitalLoans = await loansResponse.json();
  loadSchools();
  $('#digital-count').textContent = `${state.equipment.length} équipement${state.equipment.length > 1 ? 's' : ''}`;
  $('#digital-body').innerHTML = state.equipment.map((item) => `<tr data-equipment-id="${item.id}"><td class="selection-cell"><input type="checkbox" aria-label="Sélectionner ${escapeHtml(item.Equipement)}"></td><td><strong>${escapeHtml(item.Equipement)}</strong></td><td>${escapeHtml(item.Marque) || '—'}</td><td>${escapeHtml(item.Type) || '—'}</td><td>${escapeHtml(item.quantity)}</td><td class="digital-remaining">${escapeHtml(item.available_quantity)}</td></tr>`).join('');
  document.querySelectorAll('#digital-body tr').forEach((row) => {
    row.addEventListener('click', (event) => { if (!event.target.closest('input')) toggleEquipment(Number(row.dataset.equipmentId)); });
    const checkbox = row.querySelector('input[type="checkbox"]');
    checkbox.addEventListener('click', (event) => event.stopPropagation());
    checkbox.addEventListener('change', () => toggleEquipment(Number(row.dataset.equipmentId)));
  });
}
async function refreshDigitalData() {
  const [inventoryResponse, loansResponse] = await Promise.all([
    fetch('/api/digital-equipment', { cache: 'no-store' }),
    fetch('/api/digital-loans', { cache: 'no-store' }),
  ]);
  if (!inventoryResponse.ok || !loansResponse.ok) throw new Error('Impossible d’actualiser le stock numérique.');
  state.equipment = await inventoryResponse.json();
  state.digitalLoans = await loansResponse.json();
  document.querySelectorAll('#digital-body tr').forEach((row) => {
    const item = state.equipment.find((equipment) => equipment.id === Number(row.dataset.equipmentId));
    if (item) row.querySelector('.digital-remaining').textContent = item.available_quantity;
  });
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
  $('#series-body').innerHTML = state.books.map((book) => `<tr data-book-id="${book.id}" data-author="${escapeHtml(book.Auteur)}"><td class="selection-cell"><input type="checkbox" aria-label="Sélectionner ${escapeHtml(book.Titre)}"></td><td><strong>${escapeHtml(book.Titre)}</strong></td><td>${escapeHtml(book.Auteur) || '—'}</td><td>${escapeHtml(book.Lieu) || '—'}</td><td><div class="book-quantity"><span>${escapeHtml(book.available_quantity)} disponible(s) / ${escapeHtml(book.quantity)} au total</span><input class="book-quantity-input" type="number" min="1" max="${Math.max(1, Number(book.available_quantity) || 1)}" value="1" ${Number(book.available_quantity) > 0 ? '' : 'disabled'} aria-label="Quantité demandée pour ${escapeHtml(book.Titre)}"></div></td></tr>`).join('');
  const authorSearch = $('#series-author-search');
  authorSearch.addEventListener('input', filterBooksByAuthor);
  filterBooksByAuthor();
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
function filterBooksByAuthor() {
  const query = normalizeSearchText($('#series-author-search').value);
  let visibleCount = 0;
  document.querySelectorAll('#series-body tr').forEach((row) => {
    const matches = !query || normalizeSearchText(row.dataset.author).includes(query);
    row.hidden = !matches;
    if (matches) visibleCount += 1;
  });
  $('#series-count').textContent = query
    ? `${visibleCount} / ${state.books.length} séries`
    : `${state.books.length} série${state.books.length > 1 ? 's' : ''}`;
  $('#series-no-results').hidden = visibleCount > 0;
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
  if ((!state.games.length && !state.books.length && !state.equipment.length) || loansRefreshInFlight) return;
  loansRefreshInFlight = true;
  try {
    if (state.equipment.length) {
      await refreshDigitalData();
      if (state.selectedEquipment.length) renderDigitalCalendar();
    }
    const response = await fetch('/api/loans', { cache: 'no-store' });
    if (response.ok) state.loans = await response.json();
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
function toggleEquipment(id) {
  const equipment = state.equipment.find((item) => item.id === id);
  if (!equipment) return;
  const selected = state.selectedEquipment.some((item) => item.id === id);
  const row = document.querySelector(`#digital-body tr[data-equipment-id="${id}"]`);
  state.selectedEquipment = selected
    ? state.selectedEquipment.filter((item) => item.id !== id)
    : [...state.selectedEquipment, { ...equipment, requested_quantity: 1 }];
  const today = iso(new Date());
  if (!selected && state.selectedEquipment.length === 1) {
    const nextReservation = state.digitalLoans
      .filter((loan) => loan.is_active && loan.equipment_id === id && loan.return_date >= today)
      .sort((first, second) => first.loan_date.localeCompare(second.loan_date))
      .find((loan) => loan.loan_date <= today && today <= loan.occupied_until)
      || state.digitalLoans.filter((loan) => loan.is_active && loan.equipment_id === id && loan.loan_date >= today)
        .sort((first, second) => first.loan_date.localeCompare(second.loan_date))[0];
    if (nextReservation) state.month = new Date(`${nextReservation.loan_date}T12:00:00`);
    else state.month = new Date();
  }
  document.querySelectorAll('#digital-body tr').forEach((itemRow) => {
    const isSelected = state.selectedEquipment.some((item) => item.id === Number(itemRow.dataset.equipmentId));
    itemRow.classList.toggle('selected', isSelected);
    itemRow.querySelector('input[type="checkbox"]').checked = isSelected;
  });
  $('#digital-empty-calendar').hidden = state.selectedEquipment.length > 0;
  $('#digital-calendar-content').hidden = state.selectedEquipment.length === 0;
  if (state.selectedEquipment.length) {
    $('#digital-selected').textContent = state.selectedEquipment.map((item) => item.Equipement).join(' + ');
    renderDigitalCalendar();
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
function clearEquipmentSelection() {
  state.selectedEquipment = [];
  document.querySelectorAll('#digital-body tr').forEach((row) => {
    row.classList.remove('selected');
    row.querySelector('input[type="checkbox"]').checked = false;
  });
  $('#digital-empty-calendar').hidden = false;
  $('#digital-calendar-content').hidden = true;
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
function digitalAvailabilityForDate(equipment, date) {
  const bookings = state.digitalLoans.filter((loan) => loan.equipment_id === equipment.id
    && loan.loan_date <= date && date <= (loan.occupied_until || loan.return_date));
  const total = Math.max(0, Number(equipment.quantity) || 0);
  const approvedQuantity = bookings
    .filter((loan) => loan.is_approved)
    .reduce((sum, loan) => sum + loan.quantity, 0);
  const pendingQuantity = bookings
    .filter((loan) => !loan.is_approved)
    .reduce((sum, loan) => sum + loan.quantity, 0);
  const reserved = approvedQuantity + pendingQuantity;
  return {
    total,
    available: Math.max(0, total - reserved),
    approvedQuantity,
    pendingQuantity,
  };
}
function availableDigitalQuantityForPeriod(equipment, startDate, endDate) {
  const bookings = state.digitalLoans.filter((loan) => loan.equipment_id === equipment.id
    && loan.loan_date <= endDate && (loan.occupied_until || loan.return_date) >= startDate);
  const changeDates = new Set([startDate]);
  for (const loan of bookings) {
    if (loan.loan_date > startDate && loan.loan_date <= endDate) changeDates.add(loan.loan_date);
    const nextAvailable = iso(new Date(new Date(`${loan.occupied_until || loan.return_date}T12:00:00`).getTime() + 86400000));
    if (nextAvailable > startDate && nextAvailable <= endDate) changeDates.add(nextAvailable);
  }
  return Math.min(...[...changeDates].map((date) => digitalAvailabilityForDate(equipment, date).available));
}
function renderDigitalCalendar() {
  const year = state.month.getFullYear();
  const month = state.month.getMonth();
  $('#digital-calendar-month').textContent = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(state.month);
  $('.digital-availability-key').innerHTML = '<span><i class="available-key"></i> disponible</span><span><i class="pending-key"></i> en attente</span><span><i class="partial-approved-key"></i> partiellement validé</span><span><i class="approved-key"></i> tout validé</span>';
  $('#digital-calendar-content .calendar-help').textContent = 'Vert : disponible. Bleu : matériel en attente de validation. Orange : une partie de la quantité est validée. Rouge : toute la quantité est validée.';
  const firstDay = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = iso(new Date());
  let html = '';
  for (let index = 0; index < firstDay; index += 1) html += '<button class="day empty" tabindex="-1" aria-hidden="true"></button>';
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = iso(new Date(year, month, day));
    const availability = state.selectedEquipment.map((equipment) => digitalAvailabilityForDate(equipment, date));
    const total = availability.reduce((sum, item) => sum + item.total, 0);
    const approvedQuantity = availability.reduce((sum, item) => sum + item.approvedQuantity, 0);
    const pendingQuantity = availability.reduce((sum, item) => sum + item.pendingQuantity, 0);
    const status = pendingQuantity > 0
      ? 'pending'
      : approvedQuantity > 0 && total > 0 && approvedQuantity >= total
        ? 'approved'
        : approvedQuantity > 0
          ? 'partial-approved'
          : 'available';
    const classes = ['day', `digital-${status}`, date < today ? 'past' : '', date === today ? 'today' : ''].filter(Boolean).join(' ');
    const disabled = date < today;
    html += `<button class="${classes}" data-date="${date}" ${disabled ? 'disabled' : ''}>${day}</button>`;
  }
  $('#digital-calendar-grid').innerHTML = html;
  document.querySelectorAll('#digital-calendar-grid .day:not(.empty)').forEach((button) => button.addEventListener('click', () => {
    if (state.manager && loansForDate(button.dataset.date).length) openManageModal(button.dataset.date);
    else if (button.dataset.date >= today) openModal(button.dataset.date);
  }));
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
function allBookings() { const source = state.collection === 'books' ? state.bookLoans : state.collection === 'digital' ? state.digitalLoans : state.loans; const grouped = new Map(); source.forEach((loan) => { const key = [loan.name, loan.first_name, loan.professional_email, loan.school, loan.loan_date, loan.return_date, state.collection].join('\u001f'); if (!grouped.has(key)) grouped.set(key, { ...loan, collection: state.collection, ids: [], entries: [] }); const booking = grouped.get(key); booking.confirmation_sent ||= loan.confirmation_sent; booking.ids.push(loan.id); booking.entries.push(loan); }); return [...grouped.values()]; }
function loansForDate(date) { return allBookings().filter((booking) => booking.entries.some((loan) => { const selected = state.collection === 'books' ? state.selectedBooks.some((book) => sameBook(loan, book)) : state.collection === 'digital' ? state.selectedEquipment.some((equipment) => equipment.id === loan.equipment_id) : state.selectedGames.some((game) => game.id === loan.game_id); return selected && loan.loan_date <= date && date <= (loan.occupied_until || loan.return_date); })); }
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
function renderDigitalQuantityFields(startDate, endDate) {
  const container = $('#digital-quantity-fields');
  const isDigital = state.collection === 'digital';
  container.hidden = !isDigital;
  if (!isDigital) return;
  const submitButton = $('#loan-form').querySelector('button[type="submit"]');
  const selections = state.selectedEquipment.map((equipment) => ({
    equipment,
    available: availableDigitalQuantityForPeriod(equipment, startDate, endDate),
  }));
  const availableSelections = selections.filter((item) => item.available > 0);
  $('#modal-title').textContent = availableSelections.length
    ? availableSelections.map(({ equipment }) => `${equipment.Equipement} × ${Math.min(equipment.requested_quantity, availableDigitalQuantityForPeriod(equipment, startDate, endDate))}`).join(' + ')
    : 'Aucun équipement disponible aux dates choisies';
  container.innerHTML = selections.map(({ equipment, available }) => {
    if (!available) return `<div class="book-quantity-item"><div><strong>${escapeHtml(equipment.Equipement)}</strong><span>Aucun exemplaire disponible sur cette période; cet équipement ne sera pas ajouté à la fiche.</span></div></div>`;
    equipment.requested_quantity = Math.min(equipment.requested_quantity, available);
    return `<div class="book-quantity-item"><div><strong>${escapeHtml(equipment.Equipement)}</strong><span>Disponible sur cette période : ${available}</span></div><label>Quantité<input data-digital-quantity="${equipment.id}" type="number" min="1" max="${Math.max(1, available)}" value="${equipment.requested_quantity}" ${available ? '' : 'disabled'} required></label></div>${available ? '' : '<p class="form-error">Aucun exemplaire disponible sur cette période.</p>'}`;
  }).join('');
  submitButton.disabled = availableSelections.length === 0;
  const selectionPayload = () => JSON.stringify(availableSelections
    .map(({ equipment }) => ({ id: equipment.id, quantity: equipment.requested_quantity })));
  $('#loan-form').dataset.digitalSelection = selectionPayload();
  container.querySelectorAll('[data-digital-quantity]').forEach((input) => input.addEventListener('input', () => {
    const equipment = state.selectedEquipment.find((item) => item.id === Number(input.dataset.digitalQuantity));
    if (!equipment) return;
    const maximum = Number(input.max);
    equipment.requested_quantity = Math.min(maximum, Math.max(1, Number(input.value) || 1));
    input.value = equipment.requested_quantity;
    $('#loan-form').dataset.digitalSelection = selectionPayload();
  }));
}
function openModal(date) {
  const form = $('#loan-form');
  const startInput = $('#loan-start-date');
  const endInput = $('#loan-end-date');
  $('#modal-title').textContent = state.collection === 'books'
    ? state.selectedBooks.map((item) => `${item.Titre} × ${item.requested_quantity}`).join(' + ')
    : state.collection === 'digital'
      ? state.selectedEquipment.map((item) => `${item.Equipement} × ${item.requested_quantity}`).join(' + ')
      : state.selectedGames.map((item) => item.Jeu).join(' + ');
  form.dataset.gameIds = JSON.stringify(state.selectedGames.map((item) => item.id));
  form.dataset.bookSelection = JSON.stringify(state.selectedBooks.map((item) => ({ id: item.id, quantity: item.requested_quantity })));
  form.dataset.digitalSelection = JSON.stringify(state.selectedEquipment.map((item) => ({ id: item.id, quantity: item.requested_quantity })));
  form.dataset.collection = state.collection;
  form.reset();
  $('#loan-modal-eyebrow').textContent = state.collection === 'digital' ? 'Pré-réservation soumise à validation' : 'Nouvelle réservation';
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
    renderDigitalQuantityFields(startInput.value, endInput.value);
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
  const digitalSelection = JSON.parse(form.dataset.digitalSelection || '[]');
  const isBooks = form.dataset.collection === 'books';
  const isDigital = form.dataset.collection === 'digital';
  const loanDate = data.loan_date;
  const endDate = data.end_date;
  const summary = isBooks
    ? bookSelection.map((item) => `${state.books.find((book) => book.id === item.id)?.Titre || 'Série'} × ${item.quantity}`).join(', ')
    : isDigital
      ? digitalSelection.map((item) => `${state.equipment.find((equipment) => equipment.id === item.id)?.Equipement || 'Équipement'} × ${item.quantity}`).join(', ')
      : `${gameIds.length} jeu${gameIds.length > 1 ? 'x' : ''}`;
  const bookingType = isDigital ? 'la pré-réservation' : 'la réservation';
  if (!confirm(`Confirmer ${bookingType} de ${summary} du ${formatDate(loanDate)} au ${formatDate(endDate)} ?`)) return;
  const printWindow = window.open('', '_blank');
  const endpoint = isBooks ? '/api/book-loans/batch' : isDigital ? '/api/digital-loans/batch' : '/api/loans/batch';
  const payload = isBooks ? { ...data, books: bookSelection } : isDigital ? { ...data, equipment: digitalSelection } : { ...data, game_ids: gameIds };
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const result = await response.json();
  if (!response.ok) {
    printWindow?.close();
    $('#form-error').textContent = result.detail || 'La réservation n’a pas pu être enregistrée.';
    return;
  }
  const returnDate = result[0]?.return_date || endDate;
  const resources = isBooks
    ? bookSelection.map((item) => `${state.books.find((book) => book.id === item.id)?.Titre || 'Série'} × ${item.quantity}`)
    : isDigital
      ? digitalSelection.map((item) => `${state.equipment.find((equipment) => equipment.id === item.id)?.Equipement || 'Équipement'} × ${item.quantity}`)
      : state.selectedGames;
  if (printWindow) printSheet(isDigital ? 'Fiche de pré-réservation' : 'Fiche d’emprunt', data, resources, loanDate, returnDate, printWindow);
  if (isBooks) {
    state.bookLoans.push(...result);
    closeModal();
    renderSeriesCalendar();
    refreshBookData()
      .then(renderSeriesCalendar)
      .catch((error) => console.error('Actualisation du stock après réservation impossible :', error));
  } else if (isDigital) {
    state.digitalLoans.push(...result);
    closeModal();
    renderDigitalCalendar();
    clearEquipmentSelection();
    refreshDigitalData().catch((error) => console.error('Actualisation du stock numérique après pré-réservation impossible :', error));
  } else {
    state.loans.push(...result);
    closeModal();
    renderCalendar();
    clearGameSelection();
  }
  const emailStatus = response.headers.get('X-Email-Status');
  const emailError = response.headers.get('X-Email-Error');
  const emailTrackingStatus = response.headers.get('X-Email-Tracking-Status');
  const emailTrackingError = response.headers.get('X-Email-Tracking-Error');
  const managerEmailStatus = response.headers.get('X-Manager-Email-Status');
  const managerEmailError = response.headers.get('X-Manager-Email-Error');
  const stockStatus = response.headers.get('X-Stock-Status');
  const printStatus = printWindow ? 'La fiche est prête à imprimer en PDF.' : 'Autorisez les fenêtres surgissantes pour imprimer la fiche.';
  const emailMessage = emailStatus === 'sending'
    ? 'Le courriel de confirmation est en cours d’envoi.'
    : emailStatus === 'pending'
    ? isBooks ? 'Le courriel de confirmation sera envoyé le jour de l’emprunt.' : 'Le courriel de confirmation est en cours d’envoi.'
    : emailStatus === 'sent'
      ? 'Le courriel de confirmation a été envoyé.'
      : `Échec du courriel : ${emailError ? decodeURIComponent(emailError) : 'aucun détail reçu'}.`;
  if (isDigital) {
    const messages = ['Pré-réservation enregistrée.'];
    messages.push(emailStatus === 'sent'
      ? 'Le courriel de réception a été envoyé au demandeur.'
      : `Échec du courriel au demandeur : ${emailError ? decodeURIComponent(emailError) : 'aucun détail reçu'}.`);
    messages.push(managerEmailStatus === 'sent'
      ? 'Le gestionnaire a été informé.'
      : `Échec du courriel au gestionnaire : ${managerEmailError ? decodeURIComponent(managerEmailError) : 'aucun détail reçu'}.`);
    if (emailTrackingStatus === 'failed') {
      messages.push(`Le suivi du courriel au demandeur n’a pas été enregistré dans Grist${emailTrackingError ? ` : ${decodeURIComponent(emailTrackingError)}` : '.'}`);
    }
    if (stockStatus === 'failed') messages.push('La mise à jour du stock Grist a échoué.');
    messages.push(printStatus);
    showToast(messages.join(' '));
  } else {
    showToast(`Réservation enregistrée. ${printStatus} ${emailMessage}`);
  }
}
function syncManagerButtons() { $('#manager-button').hidden = state.manager; $('#logout-manager').hidden = !state.manager; }
window.addEventListener('hashchange', syncManagerButtons);
syncManagerButtons();
async function loginManager(event) { event.preventDefault(); const form = event.currentTarget; const response = await fetch('/api/manager/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: form.password.value }) }); const result = await response.json(); if (!response.ok) { $('#manager-error').textContent = result.detail || 'Connexion impossible.'; return; } state.manager = true; syncManagerButtons(); form.reset(); $('#manager-modal').hidden = true; if (state.selectedGames.length) renderCalendar(); if (state.selectedBooks.length) renderSeriesCalendar(); if (state.selectedEquipment.length) renderDigitalCalendar(); showToast('Mode gestionnaire activé.'); }
function openManagerModal() { $('#manager-error').textContent = ''; $('#manager-modal').hidden = false; $('#manager-password').focus(); }
function closeManagerModal() { $('#manager-modal').hidden = true; }
async function logoutManager() {
  showToast('Déconnexion en cours…');
  state.manager = false;
  syncManagerButtons();
  $('#home-view').hidden = false;
  $('#games-view').hidden = true;
  $('#series-view').hidden = true;
  $('#digital-view').hidden = true;
  if (location.hash !== '#home') location.hash = '#home';
  try { clearGameSelection(); } catch (error) { console.error('Nettoyage de la sélection des jeux impossible :', error); }
  try { clearBookSelection(); } catch (error) { console.error('Nettoyage de la sélection des séries impossible :', error); }
  try { clearEquipmentSelection(); } catch (error) { console.error('Nettoyage de la sélection numérique impossible :', error); }
  closeManageModal();
  closeManagerModal();
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
function bookingResources(booking) {
  return booking.entries.map((loan) => booking.collection === 'books'
    ? `${state.books.find((item) => item.id === loan.book_id)?.Titre || 'Série'} × ${loan.quantity}`
    : booking.collection === 'digital'
      ? `${state.equipment.find((item) => item.id === loan.equipment_id)?.Equipement || loan.equipment_name || 'Équipement'} × ${loan.quantity}`
      : state.games.find((item) => item.id === loan.game_id)?.Jeu || 'Jeu');
}
function openManageModal(date) {
  const bookings = loansForDate(date);
  if (!bookings.length) return;
  $('#manage-modal').dataset.date = date;
  $('#manage-date').textContent = formatDate(date);
  $('#manage-list').innerHTML = bookings.map((booking) => {
    const resources = bookingResources(booking);
    const status = booking.collection === 'digital' ? booking.is_approved ? ' · Validée' : ' · En attente de validation' : '';
    const approvalControl = state.manager && booking.collection === 'digital'
      ? `<label class="manager-approval"><input type="checkbox" data-approve-id="${booking.id}" ${booking.is_approved ? 'checked disabled' : ''}> Validée</label>${booking.is_approved && !booking.confirmation_sent ? `<button class="secondary-button" data-resend-confirmation-id="${booking.id}" type="button">Envoyer la confirmation</button>` : ''}`
      : '';
    const managerActions = state.manager
      ? `<button class="secondary-button" data-return-id="${booking.id}" data-return-date="${date}" type="button">Enregistrer le retour à cette date</button><button class="danger-button" data-delete-id="${booking.id}" data-return-date="${date}" type="button">Annuler toute la réservation</button>`
      : '';
    return `<article class="manage-item"><div><strong>${escapeHtml(resources.join(' + '))}</strong><span>${escapeHtml(booking.name)} ${escapeHtml(booking.first_name)} · du ${formatDate(booking.loan_date)} au ${formatDate(booking.return_date)}${status}</span></div><div class="manage-actions">${approvalControl}<button class="secondary-button" data-print-id="${booking.id}" type="button">Fiche</button>${managerActions}</div></article>`;
  }).join('');
  $('#manage-modal').hidden = false;
  document.querySelectorAll('[data-print-id]').forEach((button) => button.addEventListener('click', () => printLoan(Number(button.dataset.printId))));
  document.querySelectorAll('[data-approve-id]').forEach((checkbox) => checkbox.addEventListener('change', () => approveDigitalBooking(Number(checkbox.dataset.approveId), checkbox)));
  document.querySelectorAll('[data-resend-confirmation-id]').forEach((button) => button.addEventListener('click', () => sendDigitalConfirmation(Number(button.dataset.resendConfirmationId), button)));
  document.querySelectorAll('[data-return-id]').forEach((button) => button.addEventListener('click', () => returnLoan(Number(button.dataset.returnId), button.dataset.returnDate)));
  document.querySelectorAll('[data-delete-id]').forEach((button) => button.addEventListener('click', () => deleteBooking(Number(button.dataset.deleteId), button.dataset.returnDate)));
}
function closeManageModal() { $('#manage-modal').hidden = true; }
async function approveDigitalBooking(id, control) {
  const booking = allBookings().find((item) => item.id === id);
  if (!booking || (control instanceof HTMLInputElement && !control.checked)) return;
  control.disabled = true;
  try {
    const response = await fetch('/api/digital-loans/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loan_ids: booking.ids.map(Number), action: 'approve' }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || 'La validation n’a pas pu être enregistrée dans Grist.');
    const ids = new Set(booking.ids.map(String));
    state.digitalLoans = state.digitalLoans.map((loan) => ids.has(String(loan.id))
      ? { ...loan, is_approved: true }
      : loan);
    if (state.selectedEquipment.length) renderDigitalCalendar();
    openManageModal($('#manage-modal').dataset.date);
    showToast('Réservation validée. Cliquez sur « Envoyer la confirmation » pour envoyer le courriel.');
  } catch (error) {
    if (control instanceof HTMLInputElement) control.checked = false;
    control.disabled = false;
    showToast(error.message || 'La validation a échoué.');
  }
}
async function sendDigitalConfirmation(id, control) {
  const booking = allBookings().find((item) => item.id === id);
  if (!booking) return;
  control.disabled = true;
  try {
    const response = await fetch('/api/digital-loans/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loan_ids: booking.ids.map(Number), action: 'send_confirmation' }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || 'Le courriel de confirmation n’a pas pu être envoyé.');
    const ids = new Set(booking.ids.map(String));
    const confirmationSent = result.email_status === 'sent' && result.tracking_status === 'saved';
    state.digitalLoans = state.digitalLoans.map((loan) => ids.has(String(loan.id))
      ? { ...loan, confirmation_sent: confirmationSent }
      : loan);
    if (state.selectedEquipment.length) renderDigitalCalendar();
    openManageModal($('#manage-modal').dataset.date);
    if (result.email_status === 'sent' && result.tracking_status === 'saved') {
      showToast('Courriel de confirmation envoyé et suivi enregistré dans Grist.');
    } else if (result.email_status === 'sent') {
      showToast(`Le courriel a été envoyé, mais son suivi n’a pas été enregistré dans Grist. Vérifiez la colonne Confirmation_Envoyee avant de renvoyer le courriel. ${result.tracking_error || ''}`);
    } else {
      showToast(`La réservation est validée, mais le courriel n’a pas pu être envoyé : ${result.email_error || 'aucun détail reçu'}.`);
    }
  } catch (error) {
    control.disabled = false;
    showToast(error.message || 'L’envoi du courriel de confirmation a échoué.');
  }
}
async function returnLoan(id, date) {
  const booking = allBookings().find((item) => item.id === id);
  if (!booking || !confirm(`Enregistrer le retour de cette réservation à partir du ${formatDate(date)} ?`)) return;
  const printWindow = window.open('', '_blank');
  try {
    const response = await fetch('/api/loans/return', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loan_ids: booking.ids.map(Number), return_date: date, collection: booking.collection }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || 'La date de retour n’a pas pu être enregistrée dans Grist.');
  } catch (error) {
    printWindow?.close();
    showToast(error.message || 'La date de retour n’a pas pu être enregistrée dans Grist.');
    return;
  }
  const occupiedUntil = iso(new Date(new Date(`${date}T12:00:00`).getTime() - 86400000));
  const ids = new Set(booking.ids.map(String));
  const source = booking.collection === 'books' ? state.bookLoans : booking.collection === 'digital' ? state.digitalLoans : state.loans;
  const updated = source.map((loan) => ids.has(String(loan.id))
    ? { ...loan, return_date: date, occupied_until: occupiedUntil, is_active: false }
    : loan);
  if (booking.collection === 'books') state.bookLoans = updated;
  else if (booking.collection === 'digital') state.digitalLoans = updated;
  else state.loans = updated;
  const resources = bookingResources(booking);
  closeManageModal();
  if (booking.collection === 'books') renderSeriesCalendar();
  else if (booking.collection === 'digital') renderDigitalCalendar();
  else renderCalendar();
  if (printWindow) printSheet('Fiche de retour', booking, resources, booking.loan_date, date, printWindow);
  if (booking.collection === 'digital') refreshDigitalData().catch((error) => console.error('Actualisation du stock numérique après retour impossible :', error));
  showToast(`Retour enregistré dans Grist.${printWindow ? ' Fiche prête à imprimer en PDF.' : ''}`);
}
async function deleteBooking(id, returnDate) {
  const booking = allBookings().find((item) => item.id === id);
  if (!booking || !confirm('Annuler toute cette réservation ?')) return;
  const printWindow = window.open('', '_blank');
  try {
    const response = await fetch('/api/loans/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loan_ids: booking.ids.map(Number), cancelled_date: returnDate, collection: booking.collection }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || 'L’annulation n’a pas pu être enregistrée dans Grist.');
  } catch (error) {
    printWindow?.close();
    showToast(error.message || 'L’annulation n’a pas pu être enregistrée dans Grist.');
    return;
  }
  const removedIds = new Set(booking.ids.map(String));
  if (booking.collection === 'books') state.bookLoans = state.bookLoans.filter((loan) => !removedIds.has(String(loan.id)));
  else if (booking.collection === 'digital') state.digitalLoans = state.digitalLoans.filter((loan) => !removedIds.has(String(loan.id)));
  else state.loans = state.loans.filter((loan) => !removedIds.has(String(loan.id)));
  closeManageModal();
  if (booking.collection === 'books') renderSeriesCalendar();
  else if (booking.collection === 'digital') renderDigitalCalendar();
  else renderCalendar();
  const resources = bookingResources(booking);
  if (printWindow) printSheet('Fiche de retour', booking, resources, booking.loan_date, returnDate, printWindow);
  if (booking.collection === 'digital') refreshDigitalData().catch((error) => console.error('Actualisation du stock numérique après annulation impossible :', error));
  showToast('Annulation enregistrée dans Grist.');
}
function printLoan(id) {
  const booking = allBookings().find((item) => item.id === id);
  if (!booking) return;
  printSheet(booking.collection === 'digital' && !booking.is_approved ? 'Fiche de pré-réservation' : 'Fiche d’emprunt',
    booking, bookingResources(booking), booking.loan_date, booking.return_date);
}
function printSheet(title, borrower, resources, loanDate, returnDate, printWindow = window.open('', '_blank')) { if (!printWindow) return; const resourceList = resources.map((resource) => `<li>${escapeHtml(typeof resource === 'string' ? resource : resource.Jeu)}</li>`).join(''); printWindow.document.open(); printWindow.document.write(`<title>${escapeHtml(title)}</title><style>body{font:16px Arial;max-width:680px;margin:50px auto;color:#182c28}h1{font-size:28px;border-bottom:2px solid #18734a;padding-bottom:14px}h2{font-size:18px;margin-top:32px}p{margin:18px 0}strong{display:block;font-size:12px;text-transform:uppercase;color:#18734a;margin-bottom:5px}li{margin:8px 0}.print-action{border:0;background:#18734a;color:#fff;padding:12px 18px;font:bold 14px Arial;cursor:pointer}@media print{body{margin:20mm auto}.print-action{display:none}}</style><button class="print-action" type="button" onclick="window.print()">Imprimer cette fiche</button><h1>${escapeHtml(title)}</h1><p><strong>Nom</strong>${escapeHtml(borrower.name)}</p><p><strong>Prénom</strong>${escapeHtml(borrower.first_name)}</p><p><strong>Mail professionnel</strong>${escapeHtml(borrower.professional_email)}</p><p><strong>École</strong>${escapeHtml(borrower.school)}</p><h2>Ressources empruntées</h2><ul>${resourceList}</ul><p><strong>Date d’emprunt</strong>${formatDate(loanDate)}</p><p><strong>Date de retour</strong>${formatDate(returnDate)}</p>`); printWindow.document.close(); window.focus(); }
function route() {
  const games = location.hash === '#jeux';
  const books = location.hash === '#series';
  const digital = location.hash === '#numerique';
  state.collection = digital ? 'digital' : books ? 'books' : 'games';
  $('#home-view').hidden = games || books || digital;
  $('#games-view').hidden = !games;
  $('#series-view').hidden = !books;
  $('#digital-view').hidden = !digital;
  if (games && !state.games.length) loadGames().catch((error) => {
    $('#games-body').innerHTML = `<tr><td colspan="6" class="loading">${escapeHtml(error.message)}</td></tr>`;
  });
  if (books && !state.books.length) loadBooks().catch((error) => {
    $('#series-body').innerHTML = `<tr><td colspan="5" class="loading">${escapeHtml(error.message)}</td></tr>`;
  });
  else if (books) refreshBookData().then(() => {
    if (state.selectedBooks.length) renderSeriesCalendar();
  }).catch((error) => console.error('Actualisation des séries impossible :', error));
  if (digital && !state.equipment.length) loadDigital().catch((error) => {
    $('#digital-body').innerHTML = `<tr><td colspan="6" class="loading">${escapeHtml(error.message)}</td></tr>`;
  });
  else if (digital) refreshDigitalData().then(() => {
    if (state.selectedEquipment.length) renderDigitalCalendar();
  }).catch((error) => console.error('Actualisation du matériel numérique impossible :', error));
}
window.addEventListener('hashchange', route); window.addEventListener('focus', refreshLoansWhenVisible); document.addEventListener('visibilitychange', refreshLoansWhenVisible); setInterval(refreshLoansWhenVisible, 15000); $('#previous-month').addEventListener('click', () => { state.month.setMonth(state.month.getMonth() - 1); renderCalendar(); }); $('#next-month').addEventListener('click', () => { state.month.setMonth(state.month.getMonth() + 1); renderCalendar(); }); $('#series-previous-month').addEventListener('click', () => { state.month.setMonth(state.month.getMonth() - 1); renderSeriesCalendar(); }); $('#series-next-month').addEventListener('click', () => { state.month.setMonth(state.month.getMonth() + 1); renderSeriesCalendar(); }); $('#digital-previous-month').addEventListener('click', () => { state.month.setMonth(state.month.getMonth() - 1); renderDigitalCalendar(); }); $('#digital-next-month').addEventListener('click', () => { state.month.setMonth(state.month.getMonth() + 1); renderDigitalCalendar(); }); $('#close-modal').addEventListener('click', closeModal); $('#loan-modal').addEventListener('click', (event) => { if (event.target.id === 'loan-modal') closeModal(); }); $('#loan-form').addEventListener('submit', submitLoan); $('#manager-button').addEventListener('click', openManagerModal); $('#manager-modal').addEventListener('click', (event) => { if (event.target.id === 'manager-modal') closeManagerModal(); }); $('#close-manager-modal').addEventListener('click', closeManagerModal); $('#manager-form').addEventListener('submit', loginManager); $('#manage-modal').addEventListener('click', (event) => { if (event.target.id === 'manage-modal') closeManageModal(); }); $('#close-manage-modal').addEventListener('click', closeManageModal); document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { if (!$('#loan-modal').hidden) closeModal(); if (!$('#manager-modal').hidden) closeManagerModal(); if (!$('#manage-modal').hidden) closeManageModal(); } }); route();
