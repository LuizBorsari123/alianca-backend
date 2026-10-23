// Parte 2 — Aparelhos e o "olho" do DNS.
import { db } from '../db.js';
import { exigeAuth } from '../auth.js';
import { exigeServico, JANELA_REMOCAO_MS } from '../config.js';
import { notificaParceiros } from '../notify.js';

const publicoDevice = x => x && ({
  id: x.id, nome: x.nome, plataforma: x.plataforma, dnsId: x.dnsId,
  donoId: x.donoId, status: statusAtual(x), protegido: statusAtual(x) === 'protegido',
  ultimoDnsSinal: x.ultimoDnsSinal || null, ultimoAppSinal: x.ultimoAppSinal || null,
});

// Deriva o status do aparelho a partir dos sinais e do relógio.
// protegido: o DNS recebeu consultas há pouco.
// removido : o app diz que o celular está ligado, mas o filtro parou (BRECHA → alerta).
// offline  : sem sinal nenhum (celular desligado ou sem internet) → não alerta.
export function statusAtual(x, agora = Date.now()) {
  const t = v => (v ? Date.parse(v) : 0);
  const dnsRecente = agora - t(x.ultimoDnsSinal) <= JANELA_REMOCAO_MS;
  const appRecente = agora - t(x.ultimoAppSinal) <= JANELA_REMOCAO_MS;
  if (dnsRecente) return 'protegido';
  if (appRecente) return 'removido'; // celular ligado, filtro caiu
  return 'offline';
}

export function mountDevices(app) {
  // Provisiona um aparelho e devolve o ID único de DNS + dica de configuração.
  app.post('/devices', exigeAuth, (req, res) => {
    const { nome, plataforma = 'android', donoId } = req.body || {};
    const user = db.getUser(req.userId);
    if (!user?.householdId) return res.status(400).json({ erro: 'Você não tem uma família.' });
    if (!nome) return res.status(400).json({ erro: 'Dê um nome ao aparelho.' });

    const dono = donoId ? db.getUser(donoId) : user;
    if (!dono || dono.householdId !== user.householdId) {
      return res.status(400).json({ erro: 'O dono do aparelho precisa ser da sua família.' });
    }
    const dnsId = db.dnsId();
    const device = db.devices.create({
      householdId: user.householdId, donoId: dono.id, nome,
      plataforma, dnsId, ultimoDnsSinal: null, ultimoAppSinal: null,
    });
    res.status(201).json({
      aparelho: publicoDevice(device),
      // é isto que o app configura no Android (DNS privado) / roteador:
      dnsConfig: { hostname: `${dnsId}.dns.aliancaapp.com.br`, tipo: 'DNS-over-TLS' },
    });
  });

  // Lista os aparelhos da família com o status atual.
  app.get('/devices', exigeAuth, (req, res) => {
    const user = db.getUser(req.userId);
    res.json({ aparelhos: db.devicesOf(user.householdId).map(publicoDevice) });
  });

  // >>> Ponto que o SERVIDOR DE DNS chama (não é usuário; usa o segredo de serviço).
  // tipo 'heartbeat'  → chegou consulta DNS (aparelho está filtrando)
  // tipo 'bloqueado'  → uma tentativa foi bloqueada → avisa e registra
  app.post('/dns/evento', exigeServico, (req, res) => {
    const { dnsId, tipo, categoria = 'conteúdo adulto', ts } = req.body || {};
    const device = dnsId ? db.deviceByDnsId(dnsId) : null;
    if (!device) return res.status(404).json({ erro: 'Aparelho não encontrado para esse dnsId.' });
    const agora = ts || new Date().toISOString();

    db.devices.update(device.id, { ultimoDnsSinal: agora });

    if (tipo === 'bloqueado') {
      db.events.create({
        householdId: device.householdId, deviceId: device.id,
        tipo: 'tentativa', titulo: 'Tentativa bloqueada',
        corpo: `${categoria} · ${device.nome}`, ts: agora,
      });
      // avisa o PARCEIRO (não quem usou o aparelho) — só categoria e horário,
      // NUNCA o endereço do site.
      notificaParceiros(device.householdId, device.donoId, {
        tipo: 'tentativa', titulo: 'Tentativa bloqueada',
        corpo: `${device.nome} · ${categoria} · ${new Date(agora).toLocaleTimeString('pt-BR')}`,
      });
    }
    res.json({ ok: true });
  });

  // App registra o token de push (FCM) do aparelho do usuário.
  app.post('/app/push-token', exigeAuth, (req, res) => {
    const { fcmToken } = req.body || {};
    if (!fcmToken) return res.status(400).json({ erro: 'Sem token.' });
    db.updateUser(req.userId, { fcmToken });
    res.json({ ok: true });
  });

  // >>> Ponte DNS em nível de FAMÍLIA (quando não há DNS por-dispositivo).
  // A ponte lê o AdGuard e, ao ver um bloqueio de conteúdo adulto, chama aqui
  // com o householdId configurado. Avisa o guardião só com categoria + horário.
  app.post('/dns/bloqueio-familia', exigeServico, (req, res) => {
    const { householdId, categoria = 'conteúdo adulto', ts } = req.body || {};
    if (!householdId) return res.status(400).json({ erro: 'Informe o householdId.' });
    const agora = ts || new Date().toISOString();
    db.events.create({
      householdId, tipo: 'tentativa', titulo: 'Tentativa bloqueada',
      corpo: `${categoria} · ${new Date(agora).toLocaleTimeString('pt-BR')}`, ts: agora,
    });
    // Bloqueio em nível de família (sem saber o aparelho): avisa todos da casa.
    notificaParceiros(householdId, null, {
      tipo: 'tentativa', titulo: 'Tentativa bloqueada',
      corpo: `${categoria} · ${new Date(agora).toLocaleTimeString('pt-BR')}`,
    });
    res.json({ ok: true });
  });

  // >>> Ponto que o APP chama com o TOKEN do usuário (Bearer): informa se a
  // proteção está ligada. Se passar de ligada -> desligada, avisa o guardião.
  app.post('/app/heartbeat', exigeAuth, (req, res) => {
    const user = db.getUser(req.userId);
    if (!user?.householdId) return res.status(400).json({ erro: 'Sem família.' });
    const protegido = !!(req.body && req.body.protegido);
    const agora = new Date().toISOString();
    let device = db.devicesOf(user.householdId).find(d => d.donoId === user.id);
    if (!device) {
      device = db.devices.create({
        householdId: user.householdId, donoId: user.id,
        nome: `Aparelho de ${user.nome}`, plataforma: 'android',
        dnsId: db.dnsId(), ultimoDnsSinal: null, ultimoAppSinal: null,
      });
    }
    const antes = device.protegidoApp;
    db.devices.update(device.id, { ultimoAppSinal: agora, protegidoApp: protegido });
    if (antes === true && protegido === false) {
      db.events.create({
        householdId: user.householdId, deviceId: device.id, tipo: 'protecao_off',
        titulo: 'Proteção desativada', corpo: `${user.nome} desativou a proteção.`, ts: agora,
      });
      notificaParceiros(user.householdId, user.id, {
        tipo: 'protecao_off', titulo: 'Proteção desativada',
        corpo: `${user.nome} desativou a proteção há pouco. Que tal conversar com carinho?`,
      });
    }
    res.json({ ok: true });
  });

  // Registra o token de push (FCM) do aparelho do usuário — usado quando o
  // push instantâneo (Firebase) estiver configurado.
  app.post('/app/push-token', exigeAuth, (req, res) => {
    const { fcmToken } = req.body || {};
    const user = db.getUser(req.userId);
    if (!user) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    if (!fcmToken) return res.status(400).json({ erro: 'Token ausente.' });
    db.updateUser(user.id, { fcmToken });
    res.json({ ok: true });
  });

  // >>> Ponto que o SERVIDOR DE DNS chama periodicamente (segredo de serviço).
  app.post('/devices/:id/app-heartbeat', exigeServico, (req, res) => {
    const device = db.devices.get(req.params.id);
    if (!device) return res.status(404).json({ erro: 'Aparelho não encontrado.' });
    db.devices.update(device.id, { ultimoAppSinal: req.body?.ts || new Date().toISOString() });
    res.json({ ok: true });
  });

  // >>> Varredura (em produção: um cron a cada poucos minutos).
  // Detecta aparelhos que saíram da proteção com o celular ainda ligado e avisa.
  app.post('/admin/varredura', exigeServico, (req, res) => {
    const agora = req.body?.agora ? Date.parse(req.body.agora) : Date.now();
    const alertados = [];
    for (const device of db.devices.all()) {
      const status = statusAtual(device, agora);
      const antes = device.statusConhecido || 'protegido';
      if (status === 'removido' && antes !== 'removido') {
        db.devices.update(device.id, { statusConhecido: 'removido' });
        db.events.create({
          householdId: device.householdId, deviceId: device.id,
          tipo: 'remocao', titulo: 'Proteção removida',
          corpo: `${device.nome} · filtro parou com o celular ligado`,
          ts: new Date(agora).toISOString(),
        });
        notificaParceiros(device.householdId, device.donoId, {
          tipo: 'remocao', titulo: 'Proteção removida',
          corpo: `${device.nome} saiu da proteção. O celular segue ligado.`,
        });
        alertados.push(device.id);
      } else if (status !== 'removido' && antes === 'removido') {
        db.devices.update(device.id, { statusConhecido: status });
      }
    }
    res.json({ ok: true, alertados });
  });
}
