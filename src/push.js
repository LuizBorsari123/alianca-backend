// Envio de notificações push (Firebase Cloud Messaging).
// Inicialização preguiçosa: se não houver credencial do Firebase no servidor,
// o push fica desativado e o resto do sistema segue normal (avisos in-app continuam).
import { readFileSync, existsSync } from 'node:fs';

let admin = null;
let app = null;
let tentouInit = false;

async function init() {
  if (tentouInit) return app;
  tentouInit = true;
  const caminho = process.env.FIREBASE_CREDENTIALS || '/etc/alianca-firebase.json';
  if (!existsSync(caminho)) {
    console.log('[push] Sem credencial Firebase em', caminho, '— push desativado (avisos in-app seguem normais).');
    return null;
  }
  try {
    admin = (await import('firebase-admin')).default;
    const sa = JSON.parse(readFileSync(caminho, 'utf8'));
    app = admin.initializeApp({ credential: admin.credential.cert(sa) });
    console.log('[push] Firebase admin iniciado.');
  } catch (e) {
    console.error('[push] Falha ao iniciar o Firebase admin:', e.message);
    app = null;
  }
  return app;
}

export async function enviarPush(fcmToken, titulo, corpo) {
  if (!fcmToken) return;
  const a = await init();
  if (!a || !admin) return;
  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: { title: titulo || 'Aliança', body: corpo || '' },
      android: { priority: 'high', notification: { channelId: 'alianca_avisos' } },
    });
  } catch (e) {
    console.error('[push] Envio falhou:', e.message);
  }
}
