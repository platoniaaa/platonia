export const prerender = false;

import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../lib/supabase';
import { sendFormLeadNotification } from '../../lib/email';

export const POST: APIRoute = async ({ request }) => {
  try {
    const data = await request.json();
    const nombre = (data.nombre || '').trim();
    const email = (data.email || '').trim();
    const telefono = (data.telefono || '').trim();
    const empresa = (data.empresa || '').trim();
    const servicio = (data.servicio || '').trim();
    const dolor = (data.dolor || data.desafio || '').trim();

    if (!nombre || !email || !servicio || !dolor) {
      return new Response(
        JSON.stringify({ error: 'missing_fields' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ error: 'invalid_email' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from('leads').insert({
      source: 'form',
      nombre,
      email,
      telefono: telefono || null,
      empresa: empresa || null,
      servicio,
      desafio: dolor,
      estado: 'nuevo',
    });

    if (error) {
      console.error('[form] Supabase error:', error);
      return new Response(
        JSON.stringify({ error: 'db_error' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[form] New lead saved: ${email}`);

    // Send email notification (don't await - fire and forget)
    sendFormLeadNotification({
      nombre,
      email,
      telefono: telefono || undefined,
      empresa: empresa || undefined,
      servicio,
      desafio: dolor,
    }).catch(() => {});

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('[form] Error:', err.message);
    return new Response(
      JSON.stringify({ error: 'server_error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
