// Web Push para o PWA (iPhone no iOS 16.4+ e Android no navegador).
// Diferente do Firebase (push.js, que é só para o app Android nativo):
// aqui usamos o padrão aberto Web Push + VAPID, que é o que o Safari do
// iPhone aceita quando o app está ADICIONADO À TELA DE INÍCIO.
//
// Se o pacote web-push não estiver instalado ou faltar chave, o envio
// fica desativado em silêncio e o resto do sistema segue normal
// (os avisos in-app continuam aparecendo quando o app abre).

// As chaves VAPID identificam o nosso servidor para o serviço de push.
// A pública vai para o PWA; a privada fica só aqui. Podem ser trocadas
// por variável de ambiente sem mexer no código.
export const VAPID_PUBLIC =
  process.env.VAPID_PUBLIC ||
  'BLDBoPYqYiBKQuujtf_XdIQ75OagWhxVwh5mKFMPsIQOHN2zp83ukI_4uN24bP_NdG0Yeu6VxMnFdvMj2EPME4g';
const VAPID_PRIVATE =
  process.env.VAPID_PRIVATE || 'u8AzlkOGl24uWAHMGGUa_VfYzMZ8707yK-RLRCimF2g';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:contato@aliancaapp.com.br';

let webpush = null;
let tentouInit = false;

async function init() {
  if (tentouInit) return webpush;
  tentouInit = true;
  try {
    webpush = (await import('web-push')).default;
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
    console.log('[webpush] Web Push (VAPID) pronto.');
  } catch (e) {
    console.log('[webpush] Pacote web-push indisponível — push do PWA desativado:', e.message);
    webpush = null;
  }
  return webpush;
}

// sub = objeto PushSubscription salvo no usuário (endpoint + keys).
// Devolve true se enviou; false se não deu (e marca inscrição morta com 404/410).
export async function enviarWebPush(sub, titulo, corpo, dados = {}) {
  if (!sub || !sub.endpoint) return false;
  const w = await init();
  if (!w) return false;
  const payload = JSON.stringify({ titulo: titulo || 'Aliança', corpo: corpo || '', ...dados });
  try {
    await w.sendNotification(sub, payload, { TTL: 86400, urgency: 'high' });
    return true;
  } catch (e) {
    // 404/410 = inscrição cancelada no aparelho: o chamador deve removê-la.
    if (e.statusCode === 404 || e.statusCode === 410) {
      e.inscricaoMorta = true;
    }
    console.error('[webpush] Envio falhou:', e.statusCode || '', e.message);
    throw e;
  }
}
