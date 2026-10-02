import { connect } from 'cloudflare:sockets';

const DEFAULT_SMTP_HOST = 'smtps.ac-nancy-metz.fr';
const DEFAULT_SMTP_PORT = 465;

function createResponseReader(reader) {
  let buffer = '';
  const decoder = new TextDecoder();

  return async function readResponse() {
    const lines = [];
    while (true) {
      const lineEnd = buffer.indexOf('\r\n');
      if (lineEnd === -1) {
        const { value, done } = await reader.read();
        if (done) throw new Error('Connexion SMTP interrompue.');
        buffer += decoder.decode(value, { stream: true });
        continue;
      }

      const line = buffer.slice(0, lineEnd);
      buffer = buffer.slice(lineEnd + 2);
      lines.push(line);
      if (/^\d{3} /.test(line)) {
        return { code: Number(line.slice(0, 3)), message: lines.join('\n') };
      }
    }
  };
}

function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function assertResponse(response, expectedCodes) {
  if (!expectedCodes.includes(response.code)) {
    throw new Error(`Réponse SMTP inattendue (${response.code}).`);
  }
}

async function sendCommand(writer, readResponse, text, expectedCodes) {
  await writer.write(new TextEncoder().encode(`${text}\r\n`));
  const response = await readResponse();
  assertResponse(response, expectedCodes);
  return response;
}

function validateAddress(address, name) {
  if (typeof address !== 'string' || !/^[^\s<>@]+@[^\s<>@]+$/.test(address)) {
    throw new Error(`Adresse ${name} invalide.`);
  }
}

export async function sendMail(env, { to, subject, text }) {
  if (!env.SMTP_USER || !env.SMTP_PASSWORD || !env.SMTP_FROM) {
    throw new Error('Configurez SMTP_USER, SMTP_PASSWORD et SMTP_FROM dans Cloudflare.');
  }
  validateAddress(to, 'destinataire');
  validateAddress(env.SMTP_FROM, 'expéditeur');
  if (/[\r\n]/.test(subject)) throw new Error('Objet du courriel invalide.');

  const hostname = env.SMTP_HOST || DEFAULT_SMTP_HOST;
  const port = Number(env.SMTP_PORT || DEFAULT_SMTP_PORT);
  if (!Number.isInteger(port) || port !== 465) {
    throw new Error('Le transport SMTP configuré nécessite le port TLS implicite 465.');
  }

  const socket = connect({ hostname, port }, { secureTransport: 'on' });
  let reader;
  let writer;
  try {
    reader = socket.readable.getReader();
    writer = socket.writable.getWriter();
    const readResponse = createResponseReader(reader);

    assertResponse(await readResponse(), [220]);
    await sendCommand(writer, readResponse, `EHLO ${env.SMTP_EHLO || 'mediatheque.pages.dev'}`, [250]);
    await sendCommand(writer, readResponse, 'AUTH LOGIN', [334]);
    await sendCommand(writer, readResponse, encodeBase64(env.SMTP_USER), [334]);
    await sendCommand(writer, readResponse, encodeBase64(env.SMTP_PASSWORD), [235]);
    await sendCommand(writer, readResponse, `MAIL FROM:<${env.SMTP_FROM}>`, [250]);
    await sendCommand(writer, readResponse, `RCPT TO:<${to}>`, [250, 251]);
    await sendCommand(writer, readResponse, 'DATA', [354]);

    const encodedSubject = `=?UTF-8?B?${encodeBase64(subject)}?=`;
    const body = String(text).replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    const message = [
      `From: ${env.SMTP_FROM}`,
      `To: ${to}`,
      `Subject: ${encodedSubject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      body,
      '.',
      '',
    ].join('\r\n');
    await writer.write(new TextEncoder().encode(message));
    assertResponse(await readResponse(), [250]);
    await writer.write(new TextEncoder().encode('QUIT\r\n'));
  } finally {
    try { writer?.releaseLock(); } catch {}
    try { reader?.releaseLock(); } catch {}
    socket.close();
  }
}
