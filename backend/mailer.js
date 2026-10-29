/**
 */

const nodemailer = require('nodemailer');

const SMTP_USER      = process.env.SMTP_USER || '';
const SMTP_PASS      = process.env.SMTP_PASS || '';
const CONTACT_EMAIL_TO = process.env.CONTACT_EMAIL_TO || 'Yovana.zevorus@gmail.com';

// MAIL_DRY_RUN=1 (solo pruebas): se comporta como si hubiera correo, pero no envía nada.
const DRY_RUN   = Boolean(process.env.MAIL_DRY_RUN);
const isEnabled = () => DRY_RUN || Boolean(SMTP_USER && SMTP_PASS);

let transporter = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
  }
  return transporter;
}

async function sendContactNotification(lead) {
  if (!isEnabled()) return { sent: false, reason: 'SMTP no configurado' };
  if (DRY_RUN) return { sent: false, reason: 'dry-run' };

  const { nombre, empresa, email, telefono, motivo, mensaje } = lead;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto">
      <h2 style="color:#0b213c;">Nueva solicitud desde zevorus.com</h2>
      <table style="border-collapse:collapse;width:100%;">
        <tr><td style="padding:6px 0;color:#666;">Nombre</td><td style="padding:6px 0;"><b>${escapeHtml(nombre)}</b></td></tr>
        <tr><td style="padding:6px 0;color:#666;">Empresa</td><td style="padding:6px 0;">${escapeHtml(empresa || '—')}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Email</td><td style="padding:6px 0;">${escapeHtml(email)}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Teléfono</td><td style="padding:6px 0;">${escapeHtml(telefono || '—')}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Motivo</td><td style="padding:6px 0;">${escapeHtml(motivo || '—')}</td></tr>
      </table>
      <p style="margin-top:16px;color:#666;">Mensaje:</p>
      <p style="white-space:pre-wrap;border-left:3px solid #c9b27e;padding-left:12px;">${escapeHtml(mensaje)}</p>
    </div>`;

  const info = await getTransporter().sendMail({
    from: `"Zevorus — Sitio Web" <${SMTP_USER}>`,
    to: CONTACT_EMAIL_TO,
    replyTo: email,
    subject: `Nueva solicitud de contacto — ${nombre}${empresa ? ' (' + empresa + ')' : ''}`,
    html
  });

  return { sent: true, messageId: info.messageId };
}

// ── Correos de cuentas ────────────────────────────────────────
const wrap = (title, body) => `
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2937">
    <h2 style="color:#0b213c;">${title}</h2>
    ${body}
    <p style="margin-top:28px;color:#9ca3af;font-size:12px;">Zevorus — SecOps Management Platform</p>
  </div>`;

const button = (href, text) =>
  `<p style="margin:24px 0;"><a href="${href}" style="background:#14b8a6;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold;">${text}</a></p>`;

async function send(to, subject, html) {
  if (!isEnabled()) return { sent: false, reason: 'SMTP no configurado' };
  if (DRY_RUN) return { sent: false, reason: 'dry-run' };
  const info = await getTransporter().sendMail({ from: `"Zevorus" <${SMTP_USER}>`, to, subject, html });
  return { sent: true, messageId: info.messageId };
}

function sendPasswordReset({ to, name, link }) {
  return send(to, 'Restablece tu contraseña de Zevorus', wrap('Restablecer contraseña', `
    <p>Hola ${escapeHtml(name)},</p>
    <p>Recibimos una solicitud para cambiar la contraseña de tu cuenta. Da clic en el botón para crear una nueva:</p>
    ${button(link, 'Crear nueva contraseña')}
    <p style="color:#6b7280;font-size:13px;">El enlace es válido por 1 hora y solo se puede usar una vez.<br>
    Si tú no lo pediste, ignora este correo: tu contraseña no cambiará.</p>`));
}

function sendVerification({ to, name, link }) {
  return send(to, 'Confirma tu correo en Zevorus', wrap('Confirma tu correo', `
    <p>Hola ${escapeHtml(name)},</p>
    <p>Gracias por registrarte en Zevorus. Para activar tu cuenta, confirma que este correo es tuyo:</p>
    ${button(link, 'Confirmar mi correo')}
    <p style="color:#6b7280;font-size:13px;">El enlace es válido por 24 horas.<br>
    Si tú no creaste esta cuenta, ignora este correo.</p>`));
}

function sendAccessRequest({ to, leaderName, requester, company, link }) {
  return send(to, `Solicitud de acceso a ${company} en Zevorus`, wrap('Nueva solicitud de acceso', `
    <p>Hola ${escapeHtml(leaderName)},</p>
    <p><b>${escapeHtml(requester.name)}</b> (${escapeHtml(requester.email)}) creó una cuenta y pidió unirse a
    <b>${escapeHtml(company)}</b>. Mientras no la apruebes, no podrá entrar ni ver la información de tu empresa.</p>
    ${button(link, 'Revisar solicitud')}
    <p style="color:#6b7280;font-size:13px;">Si no conoces a esta persona, rechaza la solicitud.</p>`));
}

function sendAccountApproved({ to, name, company, link }) {
  return send(to, 'Tu cuenta de Zevorus fue aprobada', wrap('¡Cuenta aprobada!', `
    <p>Hola ${escapeHtml(name)},</p>
    <p>Tu acceso a <b>${escapeHtml(company)}</b> fue aprobado. Ya puedes iniciar sesión.</p>
    ${button(link, 'Iniciar sesión')}`));
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = { isEnabled, sendContactNotification, sendPasswordReset, sendVerification, sendAccessRequest, sendAccountApproved };
