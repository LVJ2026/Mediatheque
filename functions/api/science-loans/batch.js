import { assertConfigured, gristRequest } from '../../_grist.js';
import {
  availableScienceQuantity,
  loadScienceStock,
  normalizeScienceEquipment,
  normalizeScienceLoan,
  scienceLoansTable,
} from '../../_science.js';
import { sendMail, sendManagerMail } from '../../_mail.js';

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function formatDate(value) {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
}

async function sendReservationEmails(env, input, equipment, created) {
  const loanId = created.records?.[0]?.id;
  const equipmentName = equipment.Equipement || `Matériel ${equipment.id}`;
  const period = `Du ${formatDate(input.loan_date)} au ${formatDate(input.end_date)}.`;
  const userEmail = (async () => {
    try {
      await sendMail(env, {
        to: input.professional_email,
        subject: 'Confirmation de votre réservation de matériel scientifique',
        text: `Bonjour ${input.first_name} ${input.name},\n\nVotre réservation est confirmée pour :\n- ${equipmentName}\n\n${period}`,
      });
      if (!Number.isInteger(loanId)) return { status: 'sent', error: '' };
      try {
        await gristRequest(env, scienceLoansTable(env), {
          method: 'PATCH',
          body: JSON.stringify({ records: [{ id: loanId, fields: { Confirmation_Envoyee: new Date().toISOString().slice(0, 10) } }] }),
        });
      } catch (error) {
        console.error('Courriel sciences envoyé, mais son marqueur de confirmation n’a pas été enregistré :', error.message);
      }
      return { status: 'sent', error: '' };
    } catch (error) {
      const message = String(error.message || 'Erreur SMTP inconnue').slice(0, 200);
      console.error('Échec du courriel de confirmation du matériel scientifique :', message);
      return { status: 'failed', error: message };
    }
  })();
  const managerEmail = sendManagerMail(env, {
    subject: 'Nouvelle réservation de matériel scientifique',
    text: `Une nouvelle réservation de matériel scientifique a été enregistrée.\n\nMatériel : ${equipmentName}\nDemandeur : ${input.first_name} ${input.name}\nÉcole : ${input.school}\nCourriel : ${input.professional_email}\n${period}\n\nOuvrir l’interface gestionnaire : ${new URL('/#sciences', input.interface_url).href}`,
  });
  return Promise.all([userEmail, managerEmail]);
}

export async function onRequestPost({ request, env }) {
  try {
    assertConfigured(env);
    const input = await request.json();
    const selection = input.equipment;
    if (!input.name || !input.first_name || !input.professional_email || !input.school
      || !isValidDate(input.loan_date) || !isValidDate(input.end_date) || input.end_date < input.loan_date
      || !Array.isArray(selection) || selection.length !== 1
      || !Number.isInteger(Number(selection[0]?.id)) || Number(selection[0].id) < 1) {
      return Response.json({ detail: 'Renseignez tous les champs, vérifiez les dates et sélectionnez un seul matériel.' }, { status: 422 });
    }

    const { inventory, activeLoans, totals } = await loadScienceStock(env);
    const equipmentId = Number(selection[0].id);
    const inventoryRecord = (inventory.records || []).find((record) => Number(record.id) === equipmentId);
    if (!inventoryRecord) return Response.json({ detail: 'Le matériel sélectionné est introuvable dans l’inventaire sciences.' }, { status: 409 });
    const normalizedEquipment = normalizeScienceEquipment(inventoryRecord);
    const loans = activeLoans.map((record) => normalizeScienceLoan(record, inventory.records || []));
    const available = availableScienceQuantity(equipmentId, input.loan_date, input.end_date, totals.get(equipmentId) ?? 1, loans);
    if (available < 1) {
      return Response.json({
        detail: `${normalizedEquipment.Equipement || 'Ce matériel'} est déjà emprunté sur la période choisie.`,
      }, { status: 409 });
    }

    const record = { fields: {
      Nom: input.name,
      Prenom: input.first_name,
      Mail_professionnel: input.professional_email,
      Ecole: input.school,
      Date_Emprunt: input.loan_date,
      Date_Retour_prevu: input.end_date,
      Materiel: equipmentId,
      Quantite: 1,
    } };
    const created = await gristRequest(env, scienceLoansTable(env), {
      method: 'POST',
      body: JSON.stringify({ records: [record] }),
    });
    const result = normalizeScienceLoan({ id: created.records?.[0]?.id, ...record }, inventory.records || []);
    const [email, managerEmail] = await sendReservationEmails(env, {
      ...input,
      interface_url: request.url,
    }, normalizedEquipment, created);
    const headers = {
      'X-Email-Status': email.status,
      'X-Manager-Email-Status': managerEmail.status,
    };
    if (email.error) headers['X-Email-Error'] = encodeURIComponent(email.error);
    if (managerEmail.error) headers['X-Manager-Email-Error'] = encodeURIComponent(managerEmail.error);
    return Response.json([result], { status: 201, headers });
  } catch (error) {
    return Response.json({ detail: error.message }, { status: 503 });
  }
}
