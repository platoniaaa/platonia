export const prerender = false;

import type { APIRoute } from 'astro';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { SYSTEM_PROMPT } from '../../lib/system-prompt';
import { getSupabaseAdmin } from '../../lib/supabase';
import { sendChatLeadNotification } from '../../lib/email';

interface ChatMsg { role: 'user' | 'assistant'; content: string; }

function capitalize(s: string): string {
  return s.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

// Extract contact info from full conversation text
function extractContactInfo(messages: ChatMsg[]) {
  const userText = messages
    .filter(m => m.role === 'user')
    .map(m => m.content)
    .join('\n');

  // Email
  const emailMatch = userText.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  const email = emailMatch ? emailMatch[0].toLowerCase() : null;

  // Phone (Chilean format friendly)
  const phoneMatch = userText.match(/(?:\+?56[\s\-.]*)?(?:9[\s\-.]*)?\d{4}[\s\-.]*\d{4}/);
  const telefono = phoneMatch ? phoneMatch[0].replace(/[\s\-.]/g, '').slice(0, 20) : null;

  // Name extraction - multiple strategies
  let nombre: string | null = null;

  // Strategy 1: User explicitly says their name in any message
  const nameMatch = userText.match(/(?:me\s+llamo|mi\s+nombre\s+es|soy)\s+([A-ZÁÉÍÓÚÑa-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]+)?)/i);
  if (nameMatch) {
    nombre = capitalize(nameMatch[1].trim());
  }

  // Strategy 2: Bot asked "¿cómo te llamas?" → next user message is the name
  if (!nombre) {
    for (let i = 0; i < messages.length - 1; i++) {
      const msg = messages[i];
      const next = messages[i + 1];
      if (msg.role === 'assistant' && next?.role === 'user') {
        if (/c[óo]mo\s+te\s+llamas|tu\s+nombre|cu[áa]l\s+es\s+tu\s+nombre/i.test(msg.content)) {
          const candidate = next.content.trim();
          // Should be just a name (short, only letters)
          if (candidate.length < 50 && /^[A-ZÁÉÍÓÚÑa-záéíóúñ\s]+$/.test(candidate)) {
            const words = candidate.split(/\s+/).filter(w => w.length > 1);
            if (words.length >= 1 && words.length <= 3) {
              nombre = capitalize(words.slice(0, 2).join(' '));
              break;
            }
          }
        }
      }
    }
  }

  // Empresa extraction
  let empresa: string | null = null;
  const empresaPatterns = [
    /(?:mi\s+empresa\s+(?:se\s+llama\s+|es\s+))([^\.,;\n]+)/i,
    /(?:trabajo\s+en\s+)([A-ZÁÉÍÓÚÑ][^\.,;\n]{2,60})/,
    /(?:tengo\s+(?:una|un)\s+(?:empresa|negocio|tienda|pyme)\s+(?:de\s+|que\s+se\s+llama\s+)?)([^\.,;\n]+)/i,
  ];
  for (const pattern of empresaPatterns) {
    const m = userText.match(pattern);
    if (m && m[1]) {
      empresa = m[1].trim().slice(0, 100);
      break;
    }
  }

  return { email, telefono, nombre, empresa };
}

async function saveConversation(sessionId: string, messages: ChatMsg[]) {
  try {
    const supabase = getSupabaseAdmin();
    const { email, telefono, nombre, empresa } = extractContactInfo(messages);

    const userMessages = messages.filter(m => m.role === 'user');
    if (userMessages.length === 0) return;

    // Check if conversation already exists for this session
    const { data: existing, error: selectErr } = await supabase
      .from('leads')
      .select('id, email, telefono, notas')
      .eq('source', 'chatbot')
      .filter('conversacion->>session_id', 'eq', sessionId)
      .maybeSingle();

    if (selectErr) {
      console.error('[chat] Select error:', selectErr.message);
    }

    const conversacion = {
      session_id: sessionId,
      messages,
      message_count: messages.length,
      last_updated: new Date().toISOString(),
    };

    const desafio = userMessages[0] ? userMessages[0].content.slice(0, 500) : null;

    const payload: any = {
      source: 'chatbot',
      conversacion,
    };
    // Only set fields when we have a value, so we don't overwrite previous captures with null
    if (email) payload.email = email;
    if (telefono) payload.telefono = telefono;
    if (nombre) payload.nombre = nombre;
    if (empresa) payload.empresa = empresa;
    if (desafio) payload.desafio = desafio;

    let isNewLead = false;

    if (existing && (existing as any).id) {
      const prev = existing as any;
      const hadContact = !!(prev.email || prev.telefono);
      const hasContactNow = !!(email || telefono);
      const notifiedAlready = (prev.notas || '').includes('email_sent');

      if (hasContactNow && !hadContact && !notifiedAlready) {
        isNewLead = true;
        payload.notas = (prev.notas ? prev.notas + ';' : '') + 'email_sent';
      }

      const { error: updErr } = await supabase.from('leads').update(payload).eq('id', prev.id);
      if (updErr) {
        console.error('[chat] Update error:', updErr.message);
      } else {
        console.log(`[chat] Updated session ${sessionId} (${messages.length} msgs)`);
      }
    } else {
      payload.estado = 'nuevo';
      if (email || telefono) {
        isNewLead = true;
        payload.notas = 'email_sent';
      }
      const { error: insErr } = await supabase.from('leads').insert(payload);
      if (insErr) {
        console.error('[chat] Insert error:', insErr.message);
      } else {
        console.log(`[chat] Inserted new session ${sessionId} (${messages.length} msgs)`);
      }
    }

    if (isNewLead) {
      sendChatLeadNotification({
        email,
        telefono,
        desafio,
        conversation: messages,
        sessionId,
      }).catch(() => {});
    }
  } catch (err: any) {
    console.error('[chat] Error saving conversation:', err?.message || err);
  }
}

export const POST: APIRoute = async ({ request }) => {
  const apiKey = import.meta.env.GEMINI_API_KEY;

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'API key no configurada' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await request.json();
    const messages: ChatMsg[] = body.messages;
    const sessionId: string = body.sessionId || `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Mensajes inválidos' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: SYSTEM_PROMPT,
    });

    const history = messages.slice(0, -1).map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));

    const chat = model.startChat({ history });
    const lastMessage = messages[messages.length - 1].content;
    const result = await chat.sendMessageStream(lastMessage);

    let fullResponse = '';

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of result.stream) {
            const text = chunk.text();
            if (text) {
              fullResponse += text;
              controller.enqueue(
                new TextEncoder().encode(`data: ${JSON.stringify({ text })}\n\n`)
              );
            }
          }

          // SAVE conversation BEFORE closing the stream (otherwise on Vercel
          // the serverless function may terminate before the save completes)
          const fullMessages: ChatMsg[] = [
            ...messages,
            { role: 'assistant', content: fullResponse },
          ];
          try {
            await saveConversation(sessionId, fullMessages);
          } catch (saveErr: any) {
            console.error('[chat] saveConversation failed:', saveErr?.message);
          }

          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
        } catch (err) {
          controller.enqueue(
            new TextEncoder().encode(`data: ${JSON.stringify({ error: 'Error en la generación' })}\n\n`)
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Session-Id': sessionId,
      },
    });
  } catch (error: any) {
    const status = error?.status === 429 ? 429 : 500;
    return new Response(
      JSON.stringify({ error: status === 429 ? 'rate_limit' : 'server_error' }),
      { status, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
