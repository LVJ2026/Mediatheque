import { assertConfigured, gristRequest } from '../../_grist.js';
import { normalizePedagogyLoan, pedagogyInventoryTable, pedagogyLoansTable } from '../../_pedagogy.js';
import { sendMail, sendManagerMail } from '../../_mail.js';

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function formatDate(value) {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
}

function dateInParis(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export async function onRequestPost({ request, env }) {
  try {
    assertConfigured(env);
    const input = await request.json();
    const bookId = Number(input.book_id);
    if (!input.name || !input.first_name || !input.professional_email || !input.school
      || !Number.isInteger(bookId) || bookId < 1
      || !isValidDate(input.loan_date) || !isValidDate(input.end_date) || input.end_date < input.loan_date) {
      return Response.json({ detail: 'Renseignez tous les champs, sélectionnez un seul livre et vérifiez les dates.' }, { status: 422 });
    }

    const [inventory, payload] = await Promise.all([
      gristRequest(env, pedagogyInventoryTable(env)),
      gristRequest(env, pedagogyLoansTable(env)),
    ]);
    const book = (inventory.records || []).find((record) => Number(record.id) === bookId);
    if (!book) return Response.json({ detail: 'Le livre sélectionné est introuvable dans l’inventaire.' }, { status: 409 });
    const activeLoans = (payload.records || [])
      .filter((record) => record.fields?.Titre != null && record.fields?.Date_Emprunt != null)
      .map((record) => normalizePedagogyLoan(record, inventory.records || []))
      .filter((loan) => loan.is_active && loan.book_id === bookId);
    const conflict = activeLoans.find((loan) => input.loan_date <= (loan.occupied_until || loan.return_date)
      && input.end_date >= loan.loan_date);
    if (conflict) {
      return Response.json({
        detail: `Ce livre est déjà réservé du ${formatDate(conflict.loan_date)} au ${formatDate(conflict.return_date)}.`,
      }, { status: 409 });
    }

    const created = await gristRequest(env, pedagogyLoansTable(env), {
      method: 'POST',
      body: JSON.stringify({ records: [{ fields: {
        Nom: input.name,
        Prenom: input.first_name,
        Mail_professionnel: input.professional_email,
        Ecole: input.school,
        Date_Emprunt: input.loan_date,
        Date_Retour_prevu: input.end_date,
        Titre: bookId,
        Validee: false,
      } }] }),
    });
    const loan = normalizePedagogyLoan({
      id: created.records?.[0]?.id,
      fields: {
        Nom: input.name,
        Prenom: input.first_name,
        Mail_professionnel: input.professional_email,
        Ecole: input.school,
        Date_Emprunt: input.loan_date,
        Date_Retour_prevu: input.end_date,
        Titre: bookId,
        Validee: false,
      },
    }, inventory.records || []);

    const interfaceUrl = new URL('/#pedagogie', request.url).href;
    const bookTitle = book.fields?.Titre ?? book.fields?.Titre_du_livre ?? `Livre ${bookId}`;
    const dateRange = `Du ${formatDate(input.loan_date)} au ${formatDate(input.end_date)}.`;
    const [borrowerEmail, managerEmail] = await Promise.all([
      (async () => {
        try {
          await sendMail(env, {
            to: input.professional_email,
            subject: 'Réception de votre demande de réservation de livre pédagogique',
            text: `Bonjour ${input.first_name} ${input.name},\n\nNous avons bien reçu votre demande de réservation pour « ${bookTitle} ».\n\n${dateRange}\nCette demande est en attente de validation par le gestionnaire. Vous recevrez un courriel lorsque la réservation sera validée.`,
          });
          const loanId = created.records?.[0]?.id;
          if (!Number.isInteger(loanId)) {
            return { status: 'sent', error: '', trackingStatus: 'failed', trackingError: 'Identifiant Grist indisponible.' };
          }
          try {
            await gristRequest(env, pedagogyLoansTable(env), {
              method: 'PATCH',
              body: JSON.stringify({
                records: [{ id: loanId, fields: { Demande_Envoyee: dateInParis(new Date()) } }],
              }),
            });
            return { status: 'sent', error: '', trackingStatus: 'saved', trackingError: '' };
          } catch (error) {
            const message = String(error.message || 'Erreur de suivi inconnue').slice(0, 200);
            console.error('Courriel pédagogique envoyé, mais son marqueur de demande n’a pas été enregistré :', message);
            return { status: 'sent', error: '', trackingStatus: 'failed', trackingError: message };
          }
        } catch (error) {
          const message = String(error.message || 'Erreur SMTP inconnue').slice(0, 200);
          console.error('Échec du courriel de réception du livre pédagogique :', message);
          return { status: 'failed', error: message, trackingStatus: 'not-sent', trackingError: '' };
        }
      })(),
      sendManagerMail(env, {
        subject: 'Nouvelle pré-réservation de livre pédagogique à valider',
        text: `Une nouvelle pré-réservation de livre pédagogique attend votre validation.\n\nLivre : ${bookTitle}\nAuteur : ${book.fields?.Auteur || '—'}\nÉdition : ${book.fields?.Edition ?? book.fields?.['Édition'] ?? '—'}\nDemandeur : ${input.first_name} ${input.name}\nÉcole : ${input.school}\nCourriel : ${input.professional_email}\n${dateRange}\n\nOuvrir l’interface gestionnaire : ${interfaceUrl}`,
      }),
    ]);
    const headers = {
      'X-Email-Status': borrowerEmail.status,
      'X-Email-Tracking-Status': borrowerEmail.trackingStatus,
      'X-Manager-Email-Status': managerEmail.status,
    };
    if (borrowerEmail.error) headers['X-Email-Error'] = encodeURIComponent(borrowerEmail.error);
    if (borrowerEmail.trackingError) headers['X-Email-Tracking-Error'] = encodeURIComponent(borrowerEmail.trackingError);
    if (managerEmail.error) headers['X-Manager-Email-Error'] = encodeURIComponent(managerEmail.error);
    return Response.json([loan], { status: 201, headers });
  } catch (error) {
    return Response.json({ detail: error.message }, { status: 503 });
  }
}
