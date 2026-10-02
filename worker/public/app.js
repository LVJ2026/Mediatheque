const state = { games: [], loans: [], selectedGames: [], month: new Date(), manager: false };
let loansRefreshInFlight = false;
const $ = (selector) => document.querySelector(selector);
const iso = (date) => { const local = new Date(date); local.setMinutes(local.getMinutes() - local.getTimezoneOffset()); return local.toISOString().slice(0, 10); };
const formatDate = (value) => new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full' }).format(new Date(`${value}T12:00:00`));
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);

async function loadGames() {
  const [gamesResponse, loansResponse] = await Promise.all([fetch('/api/games'), fetch('/api/loans')]);
  if (!gamesResponse.ok || !loansResponse.ok) throw new Error('Impossible de charger les données Grist.');
  state.games = await gamesResponse.json(); state.loans = await loansResponse.json();
  loadSchools();
  $('#game-count').textContent = `${state.games.length} jeu${state.games.length > 1 ? 'x' : ''}`;
  $('#games-body').innerHTML = state.games.map((game) => `<tr data-game-id="${game.id}"><td class="selection-cell"><input type="checkbox" aria-label="Sélectionner ${escapeHtml(game.Jeu)}"></td><td><strong>${escapeHtml(game.Jeu)}</strong></td><td>${escapeHtml(game.Marque) || '—'}</td><td>${escapeHtml(game['Âge indiqué']) || '—'}</td><td>${escapeHtml(game.Joueurs) || '—'}</td><td>${escapeHtml(game.Remarques) || '—'}</td></tr>`).join('');
  document.querySelectorAll('#games-body tr').forEach((row) => { row.addEventListener('click', () => toggleGame(Number(row.dataset.gameId))); const checkbox = row.querySelector('input'); checkbox.addEventListener('click', (event) => event.stopPropagation()); checkbox.addEventListener('change', () => toggleGame(Number(row.dataset.gameId))); });
}
async function refreshLoans() {
  if (!state.games.length || loansRefreshInFlight) return;
  loansRefreshInFlight = true;
  try {
    const response = await fetch('/api/loans', { cache: 'no-store' });
    if (!response.ok) return;
    state.loans = await response.json();
    if (state.selectedGames.length) renderCalendar();
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
function clearGameSelection() {
  state.selectedGames = [];
  document.querySelectorAll('#games-body tr').forEach((row) => {
    row.classList.remove('selected');
    row.querySelector('input').checked = false;
  });
  $('#empty-calendar').hidden = false;
  $('#calendar-content').hidden = true;
}
function occupiedDates() { const selectedIds = new Set(state.selectedGames.map((game) => game.id)); const days = new Set(); state.loans.filter((loan) => selectedIds.has(loan.game_id)).forEach((loan) => { const day = new Date(`${loan.loan_date}T12:00:00`); const end = new Date(`${loan.occupied_until || loan.return_date}T12:00:00`); while (day <= end) { days.add(iso(day)); day.setDate(day.getDate() + 1); } }); return days; }
function allBookings() { const grouped = new Map(); state.loans.forEach((loan) => { const key = [loan.name, loan.first_name, loan.professional_email, loan.school, loan.loan_date, loan.return_date].join('\u001f'); if (!grouped.has(key)) grouped.set(key, { ...loan, ids: [], entries: [] }); const booking = grouped.get(key); booking.ids.push(loan.id); booking.entries.push(loan); }); return [...grouped.values()]; }
function loansForDate(date) { const selectedIds = new Set(state.selectedGames.map((game) => game.id)); return allBookings().filter((booking) => booking.entries.some((loan) => selectedIds.has(loan.game_id) && loan.loan_date <= date && date <= (loan.occupied_until || loan.return_date))); }
function renderCalendar() { const year = state.month.getFullYear(); const month = state.month.getMonth(); $('#calendar-month').textContent = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(state.month); const firstDay = (new Date(year, month, 1).getDay() + 6) % 7; const daysInMonth = new Date(year, month + 1, 0).getDate(); const today = iso(new Date()); const busy = occupiedDates(); let html = ''; for (let index = 0; index < firstDay; index += 1) html += '<button class="day empty" tabindex="-1" aria-hidden="true"></button>'; for (let day = 1; day <= daysInMonth; day += 1) { const date = iso(new Date(year, month, day)); const occupied = busy.has(date); const unavailable = occupied || date < today; const classes = ['day', occupied ? 'occupied' : '', date < today ? 'past' : '', date === today ? 'today' : ''].filter(Boolean).join(' '); const disabled = unavailable && !state.manager; html += `<button class="${classes}" data-date="${date}" ${disabled ? 'disabled' : ''}>${day}</button>`; } $('#calendar-grid').innerHTML = html; document.querySelectorAll('#calendar-grid .day:not(.empty)').forEach((button) => button.addEventListener('click', () => { if (button.classList.contains('occupied')) openManageModal(button.dataset.date); else openModal(button.dataset.date); })); }
function openModal(date) {
  const form = $('#loan-form');
  const startInput = $('#loan-start-date');
  const endInput = $('#loan-end-date');
  $('#modal-title').textContent = state.selectedGames.map((item) => item.Jeu).join(' + ');
  form.dataset.gameIds = JSON.stringify(state.selectedGames.map((item) => item.id));
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
  const loanDate = data.loan_date;
  const endDate = data.end_date;
  if (!confirm(`Confirmer la réservation de ${gameIds.length} jeu${gameIds.length > 1 ? 'x' : ''} du ${formatDate(loanDate)} au ${formatDate(endDate)} ?`)) return;
  const printWindow = window.open('', '_blank');
  const response = await fetch('/api/loans/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, game_ids: gameIds }) });
  const result = await response.json();
  if (!response.ok) {
    printWindow?.close();
    $('#form-error').textContent = result.detail || 'La réservation n’a pas pu être enregistrée.';
    return;
  }
  state.loans.push(...result);
  closeModal();
  renderCalendar();
  const returnDate = result[0]?.return_date || endDate;
  if (printWindow) printSheet('Fiche d’emprunt', data, state.selectedGames, loanDate, returnDate, printWindow);
  clearGameSelection();
  const emailStatus = response.headers.get('X-Email-Status');
  const emailError = response.headers.get('X-Email-Error');
  const printStatus = printWindow ? 'La fiche est prête à imprimer en PDF.' : 'Autorisez les fenêtres surgissantes pour imprimer la fiche.';
  const emailMessage = emailStatus === 'pending'
    ? 'Le courriel de confirmation est en cours d’envoi.'
    : emailStatus === 'sent'
      ? 'Le courriel de confirmation a été envoyé.'
      : `Échec du courriel : ${emailError ? decodeURIComponent(emailError) : 'aucun détail reçu'}.`;
  showToast(`Réservation enregistrée. ${printStatus} ${emailMessage}`);
}
async function loginManager(event) { event.preventDefault(); const form = event.currentTarget; const response = await fetch('/api/manager/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: form.password.value }) }); const result = await response.json(); if (!response.ok) { $('#manager-error').textContent = result.detail || 'Connexion impossible.'; return; } state.manager = true; form.reset(); $('#manager-modal').hidden = true; $('#manager-button').textContent = 'Gestionnaire connecté'; if (state.selectedGames.length) renderCalendar(); showToast('Mode gestionnaire activé.'); }
function openManagerModal() { $('#manager-error').textContent = ''; $('#manager-modal').hidden = false; $('#manager-password').focus(); }
function closeManagerModal() { $('#manager-modal').hidden = true; }
function openManageModal(date) { const bookings = loansForDate(date); if (!bookings.length) return; $('#manage-modal').dataset.date = date; $('#manage-date').textContent = formatDate(date); $('#manage-list').innerHTML = bookings.map((booking) => { const games = booking.entries.map((loan) => state.games.find((item) => item.id === loan.game_id)?.Jeu || 'Jeu'); return `<article class="manage-item"><div><strong>${escapeHtml(games.join(' + '))}</strong><span>${escapeHtml(booking.name)} ${escapeHtml(booking.first_name)} · du ${formatDate(booking.loan_date)} au ${formatDate(booking.return_date)}</span></div><div class="manage-actions"><button class="secondary-button" data-print-id="${booking.id}" type="button">Fiche</button><button class="secondary-button" data-return-id="${booking.id}" data-return-date="${date}" type="button">Annuler à partir de cette date</button><button class="danger-button" data-delete-id="${booking.id}" data-return-date="${date}" type="button">Supprimer toute la réservation</button></div></article>`; }).join(''); $('#manage-modal').hidden = false; document.querySelectorAll('[data-print-id]').forEach((button) => button.addEventListener('click', () => printLoan(Number(button.dataset.printId)))); document.querySelectorAll('[data-return-id]').forEach((button) => button.addEventListener('click', () => returnLoan(Number(button.dataset.returnId), button.dataset.returnDate))); document.querySelectorAll('[data-delete-id]').forEach((button) => button.addEventListener('click', () => deleteBooking(Number(button.dataset.deleteId), button.dataset.returnDate))); }
function closeManageModal() { $('#manage-modal').hidden = true; }
async function returnLoan(id, date) { const booking = allBookings().find((item) => item.id === id); if (!booking || !confirm(`Annuler uniquement cette réservation à partir du ${formatDate(date)} ? Les autres réservations, y compris futures, restent inchangées.`)) return; const printWindow = window.open('', '_blank'); try { const response = await fetch('/api/loans/return', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loan_ids: booking.ids.map(Number), return_date: date }) }); const result = await response.json(); if (!response.ok) throw new Error(result.detail || 'La date de retour n’a pas pu être enregistrée dans Grist.'); } catch (error) { printWindow?.close(); showToast(error.message || 'La date de retour n’a pas pu être enregistrée dans Grist.'); return; } const occupiedUntil = iso(new Date(new Date(`${date}T12:00:00`).getTime() - 86400000)); const ids = new Set(booking.ids.map(String)); state.loans = state.loans.map((loan) => ids.has(String(loan.id)) ? { ...loan, return_date: date, occupied_until: occupiedUntil } : loan); const games = booking.entries.map((loan) => state.games.find((game) => game.id === loan.game_id)?.Jeu || 'Jeu'); closeManageModal(); renderCalendar(); if (printWindow) printSheet('Fiche de retour', booking, games, booking.loan_date, date, printWindow); showToast(`Retour enregistré dans Grist.${printWindow ? ' Fiche prête à imprimer en PDF.' : ''}`); }
async function deleteBooking(id, returnDate) { const booking = allBookings().find((item) => item.id === id); if (!booking || !confirm('Annuler toute cette réservation ? Les autres réservations, y compris futures, restent inchangées.')) return; const printWindow = window.open('', '_blank'); try { const response = await fetch('/api/loans/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loan_ids: booking.ids.map(Number), cancelled_date: returnDate }) }); const result = await response.json(); if (!response.ok) throw new Error(result.detail || 'L’annulation n’a pas pu être enregistrée dans Grist.'); } catch (error) { printWindow?.close(); showToast(error.message || 'L’annulation n’a pas pu être enregistrée dans Grist.'); return; } const removedIds = new Set(booking.ids.map(String)); state.loans = state.loans.filter((loan) => !removedIds.has(String(loan.id))); closeManageModal(); renderCalendar(); if (printWindow) printSheet('Fiche de retour', booking, booking.entries.map((loan) => state.games.find((game) => game.id === loan.game_id)?.Jeu || 'Jeu'), booking.loan_date, returnDate, printWindow); showToast('Annulation enregistrée dans Grist.'); }
function printLoan(id) { const booking = allBookings().find((item) => item.id === id); if (!booking) return; const games = booking.entries.map((loan) => state.games.find((game) => game.id === loan.game_id)?.Jeu || 'Jeu'); printSheet('Fiche d’emprunt', booking, games, booking.loan_date, booking.return_date); }
function printSheet(title, borrower, games, loanDate, returnDate, printWindow = window.open('', '_blank')) { if (!printWindow) return; const gameList = games.map((game) => `<li>${escapeHtml(typeof game === 'string' ? game : game.Jeu)}</li>`).join(''); printWindow.document.open(); printWindow.document.write(`<title>${escapeHtml(title)}</title><style>body{font:16px Arial;max-width:680px;margin:50px auto;color:#182c28}h1{font-size:28px;border-bottom:2px solid #18734a;padding-bottom:14px}h2{font-size:18px;margin-top:32px}p{margin:18px 0}strong{display:block;font-size:12px;text-transform:uppercase;color:#18734a;margin-bottom:5px}li{margin:8px 0}@media print{body{margin:20mm auto}}</style><h1>${escapeHtml(title)}</h1><p><strong>Nom</strong>${escapeHtml(borrower.name)}</p><p><strong>Prénom</strong>${escapeHtml(borrower.first_name)}</p><p><strong>Mail professionnel</strong>${escapeHtml(borrower.professional_email)}</p><p><strong>École</strong>${escapeHtml(borrower.school)}</p><h2>Jeux empruntés</h2><ul>${gameList}</ul><p><strong>Date d’emprunt</strong>${formatDate(loanDate)}</p><p><strong>Date de retour</strong>${formatDate(returnDate)}</p><script>window.onload=()=>window.print();<\/script>`); printWindow.document.close(); }
function route() { const games = location.hash === '#jeux'; $('#home-view').hidden = games; $('#games-view').hidden = !games; if (games && !state.games.length) loadGames().catch((error) => { $('#games-body').innerHTML = `<tr><td colspan="6" class="loading">${escapeHtml(error.message)}</td></tr>`; }); }
window.addEventListener('hashchange', route); window.addEventListener('focus', refreshLoansWhenVisible); document.addEventListener('visibilitychange', refreshLoansWhenVisible); setInterval(refreshLoansWhenVisible, 15000); $('#previous-month').addEventListener('click', () => { state.month.setMonth(state.month.getMonth() - 1); renderCalendar(); }); $('#next-month').addEventListener('click', () => { state.month.setMonth(state.month.getMonth() + 1); renderCalendar(); }); $('#close-modal').addEventListener('click', closeModal); $('#loan-modal').addEventListener('click', (event) => { if (event.target.id === 'loan-modal') closeModal(); }); $('#loan-form').addEventListener('submit', submitLoan); $('#manager-button').addEventListener('click', openManagerModal); $('#manager-modal').addEventListener('click', (event) => { if (event.target.id === 'manager-modal') closeManagerModal(); }); $('#close-manager-modal').addEventListener('click', closeManagerModal); $('#manager-form').addEventListener('submit', loginManager); $('#manage-modal').addEventListener('click', (event) => { if (event.target.id === 'manage-modal') closeManageModal(); }); $('#close-manage-modal').addEventListener('click', closeManageModal); document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { if (!$('#loan-modal').hidden) closeModal(); if (!$('#manager-modal').hidden) closeManagerModal(); if (!$('#manage-modal').hidden) closeManageModal(); } }); route();
