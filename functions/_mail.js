import { connect } from 'cloudflare:sockets';

const SMTP_HOST = 'smtps.ac-nancy-metz.fr';
const SMTP_PORT = 465;

async function readResponse(reader) {
  let response = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    response += new TextDecoder().decode(value);
    if (response.includes('\r\n')) break;
  }
  return response;
}

async function command(writer, reader, text) {
  await writer.write(new TextEncoder().encode(text + '\r\n'));
  return readResponse(reader);
}

export async function sendMail(env, { to, subject, text }) {
  const socket = connect(
    { hostname: SMTP_HOST, port: SMTP_PORT },
    { secureTransport: 'on' }
  );

  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();

  await readResponse(reader);
  await command(writer, reader, `EHLO mediatheque.pages.dev`);
  await command(writer, reader, `AUTH LOGIN`);
  await command(writer, reader, btoa(env.SMTP_USER));
  await command(writer, reader, btoa(env.SMTP_PASSWORD));
  await command(writer, reader, `MAIL FROM:<${env.SMTP_FROM}>`);
  await command(writer, reader, `RCPT TO:<${to}>`);
  await command(writer, reader, `DATA`);

  const message =
    `From: ${env.SMTP_FROM}\r\n` +
    `To: ${to}\r\n` +
    `Subject: ${subject}\r\n` +
    `Content-Type: text/plain; charset=UTF-8\r\n` +
    `\r\n` +
    `${text}\r\n.`;

  await command(writer, reader, message);
  await command(writer, reader, `QUIT`);

  writer.releaseLock();
  reader.releaseLock();
  socket.close();
}