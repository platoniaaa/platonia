import { Resend } from 'resend';

const resendApiKey = import.meta.env.RESEND_API_KEY;
const notificationEmail = import.meta.env.NOTIFICATION_EMAIL || 'ignacio.calderon237@gmail.com';
const fromAddress = import.meta.env.RESEND_FROM || 'Platonia Leads <onboarding@resend.dev>';

interface FormLeadData {
  nombre: string;
  email: string;
  telefono?: string;
  empresa?: string;
  servicio: string;
  desafio: string;
}

interface ChatLeadData {
  email?: string | null;
  telefono?: string | null;
  desafio?: string | null;
  conversation?: { role: string; content: string }[];
  sessionId?: string;
}

function escapeHtml(s: string | null | undefined): string {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export async function sendFormLeadNotification(data: FormLeadData) {
  if (!resendApiKey) {
    console.warn('[email] RESEND_API_KEY not set, skipping notification');
    return;
  }

  try {
    const resend = new Resend(resendApiKey);
    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <div style="background:linear-gradient(135deg,#3B0764,#6B21A8);color:#fff;padding:24px;border-radius:12px 12px 0 0;">
          <h1 style="margin:0;font-size:22px;">📩 Nuevo lead desde el formulario</h1>
          <p style="margin:6px 0 0;opacity:0.85;font-size:14px;">platonia.cl</p>
        </div>
        <div style="background:#fff;border:1px solid #eee;border-top:none;padding:24px;border-radius:0 0 12px 12px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:8px 0;color:#666;width:140px;">Nombre</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(data.nombre)}</td></tr>
            <tr><td style="padding:8px 0;color:#666;">Email</td><td style="padding:8px 0;"><a href="mailto:${escapeHtml(data.email)}" style="color:#6B21A8;">${escapeHtml(data.email)}</a></td></tr>
            ${data.telefono ? `<tr><td style="padding:8px 0;color:#666;">WhatsApp</td><td style="padding:8px 0;"><a href="https://wa.me/${escapeHtml(data.telefono.replace(/\D/g, ''))}" style="color:#6B21A8;">${escapeHtml(data.telefono)}</a></td></tr>` : ''}
            ${data.empresa ? `<tr><td style="padding:8px 0;color:#666;">Empresa</td><td style="padding:8px 0;">${escapeHtml(data.empresa)}</td></tr>` : ''}
            <tr><td style="padding:8px 0;color:#666;">Servicio</td><td style="padding:8px 0;">${escapeHtml(data.servicio)}</td></tr>
          </table>
          <div style="margin-top:18px;padding-top:18px;border-top:1px solid #eee;">
            <div style="color:#666;font-size:13px;margin-bottom:8px;">Desafío principal:</div>
            <div style="background:#faf7f0;padding:14px;border-radius:8px;border-left:3px solid #6B21A8;font-size:14px;line-height:1.5;color:#333;white-space:pre-wrap;">${escapeHtml(data.desafio)}</div>
          </div>
        </div>
        <p style="text-align:center;color:#999;font-size:12px;margin-top:16px;">Recibido vía Platonia · ${new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' })}</p>
      </div>
    `;

    await resend.emails.send({
      from: fromAddress,
      to: notificationEmail,
      replyTo: data.email,
      subject: `📩 Nuevo lead: ${data.nombre} (${data.servicio})`,
      html,
    });
  } catch (err: any) {
    console.error('[email] Form notification failed:', err.message);
  }
}

export async function sendChatLeadNotification(data: ChatLeadData) {
  if (!resendApiKey) {
    console.warn('[email] RESEND_API_KEY not set, skipping notification');
    return;
  }

  try {
    const resend = new Resend(resendApiKey);

    const transcript = (data.conversation || [])
      .map(m => {
        const who = m.role === 'user' ? '👤 Usuario' : '🤖 Platonia';
        return `<div style="margin-bottom:10px;"><div style="font-size:11px;color:#888;margin-bottom:2px;">${who}</div><div style="background:${m.role === 'user' ? '#f3f4f6' : '#F3E8FF'};padding:8px 12px;border-radius:8px;font-size:13px;line-height:1.5;color:#333;white-space:pre-wrap;">${escapeHtml(m.content)}</div></div>`;
      })
      .join('');

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <div style="background:linear-gradient(135deg,#3B0764,#6B21A8);color:#fff;padding:24px;border-radius:12px 12px 0 0;">
          <h1 style="margin:0;font-size:22px;">🤖 Nuevo lead capturado por la IA</h1>
          <p style="margin:6px 0 0;opacity:0.85;font-size:14px;">El asistente capturó datos de contacto</p>
        </div>
        <div style="background:#fff;border:1px solid #eee;border-top:none;padding:24px;border-radius:0 0 12px 12px;">
          <table style="width:100%;border-collapse:collapse;">
            ${data.email ? `<tr><td style="padding:8px 0;color:#666;width:140px;">Email</td><td style="padding:8px 0;"><a href="mailto:${escapeHtml(data.email)}" style="color:#6B21A8;">${escapeHtml(data.email)}</a></td></tr>` : ''}
            ${data.telefono ? `<tr><td style="padding:8px 0;color:#666;">WhatsApp</td><td style="padding:8px 0;"><a href="https://wa.me/${escapeHtml(data.telefono.replace(/\D/g, ''))}" style="color:#6B21A8;">${escapeHtml(data.telefono)}</a></td></tr>` : ''}
            ${data.desafio ? `<tr><td style="padding:8px 0;color:#666;vertical-align:top;">Primer mensaje</td><td style="padding:8px 0;">${escapeHtml(data.desafio.slice(0, 200))}${data.desafio.length > 200 ? '…' : ''}</td></tr>` : ''}
          </table>
          <div style="margin-top:18px;padding-top:18px;border-top:1px solid #eee;">
            <div style="color:#666;font-size:13px;margin-bottom:12px;">Conversación completa:</div>
            ${transcript}
          </div>
        </div>
        <p style="text-align:center;color:#999;font-size:12px;margin-top:16px;">Recibido vía Platonia · ${new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' })}</p>
      </div>
    `;

    const subject = data.email
      ? `🤖 Lead IA: ${data.email}`
      : data.telefono
      ? `🤖 Lead IA: ${data.telefono}`
      : '🤖 Lead capturado por el asistente IA';

    await resend.emails.send({
      from: fromAddress,
      to: notificationEmail,
      replyTo: data.email || undefined,
      subject,
      html,
    });
  } catch (err: any) {
    console.error('[email] Chat notification failed:', err.message);
  }
}
