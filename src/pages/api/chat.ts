export const prerender = false;

import type { APIRoute } from 'astro';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { SYSTEM_PROMPT } from '../../lib/system-prompt';
import { getSupabaseAdmin } from '../../lib/supabase';
import { sendChatLeadNotification } from '../../lib/email';

interface ChatMsg { role: 'user' | 'assistant'; content: string; }

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
  const phoneMatch = userText.match(/(?:\+?56\s*)?(?:9\s*)?(\d[\d\s.-]{7,12}\d)/);
  const telefono = phoneMatch ? phoneMatch[0].replace(/\s/g, '').slice(0, 20) : null;

  return { email, telefono };
}

async function saveConversation(sessionId: string, messages: ChatMsg[]) {
  try {
    const supabase = getSupabaseAdmin();
    const { email, telefono } = extractContactInfo(messages);

    const userMessages = messages.filter(m => m.role === 'user');
    if (userMessages.length === 0) return;

    // Check if conversation already exists for this session
    const { data: existing } = await supabase
      .from('leads')
      .select('id, email, telefono, notas')
      .eq('source', 'chatbot')
      .filter('conversacion->>session_id', 'eq', sessionId)
      .maybeSingle();

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
      email: email || null,
      telefono: telefono || null,
    };
    if (desafio) payload.desafio = desafio;

    let isNewLead = false;

    if (existing && (existing as any).id) {
      const prev = existing as any;
      // Detect if this update is the first time we have email or phone
      const hadContact = !!(prev.email || prev.telefono);
      const hasContactNow = !!(email || telefono);
      const notifiedAlready = (prev.notas || '').includes('email_sent');

      if (hasContactNow && !hadContact && !notifiedAlready) {
        isNewLead = true;
        payload.notas = (prev.notas ? prev.notas + ';' : '') + 'email_sent';
      }

      await supabase.from('leads').update(payload).eq('id', prev.id);
    } else {
      payload.estado = 'nuevo';
      // If this is the first save AND already has contact info, notify
      if (email || telefono) {
        isNewLead = true;
        payload.notas = 'email_sent';
      }
      await supabase.from('leads').insert(payload);
    }

    // Send notification email if first capture of contact info
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
    console.error('[chat] Error saving conversation:', err.message);
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
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();

          // Save conversation after streaming completes (don't await - fire and forget)
          const fullMessages: ChatMsg[] = [
            ...messages,
            { role: 'assistant', content: fullResponse },
          ];
          saveConversation(sessionId, fullMessages).catch(() => {});
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
