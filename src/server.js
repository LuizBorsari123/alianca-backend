// Aliança — Backend (o cérebro). Partes 1 a 5.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db } from './db.js';
import { hash, verificaSenha, geraToken, exigeAuth } from './auth.js';
import { mountDevices } from './routes/devices.js';
import { mountJourney } from './routes/journey.js';
import { mountLifecycle } from './routes/lifecycle.js';
import { mountBilling } from './routes/billing.js';
import { mountMessages } from './routes/messages.js';
import { mountConvite } from './routes/convite.js';

export function criaApp() {
  const app = express();
  app.use(express.json());

  // Serve o PWA (app web do iPhone) a partir da pasta web/ — mesmo domínio, sem CORS.
  const __dirname = dirname(fileURLToPath(import.meta.url));
  app.use(express.static(join(__dirname, '..', 'web')));

  const publico = u => u && ({ id: u.id, nome: u.nome, email: u.email, genero: u.genero, papel: u.papel, householdId: u.householdId, status: u.status });

  app.get('/health', (_req, res) => res.json({ app: 'Aliança', partes: '1–5', ok: true }));

  // ---- Cadastro do titular: cria usuário, família, assinatura e inicia a caminhada ----
  app.post('/auth/signup', (req, res) => {
    const { nome, email, senha, genero, plano } = req.body || {};
    if (!nome || !email || !senha) return res.status(400).json({ erro: 'Informe nome, e-mail e senha.' });
    if (String(senha).length < 6) return res.status(400).json({ erro: 'A senha precisa de pelo menos 6 caracteres.' });
    if (db.findUserByEmail(email)) return res.status(409).json({ erro: 'Já existe uma conta com esse e-mail.' });

    const household = db.createHousehold({ donoId: null, guardiaoId: null, pinHash: null, streakInicio: new Date().toISOString() });
    const user = db.createUser({
      nome, email, senhaHash: hash(senha),
      genero: genero === 'ela' ? 'ela' : 'ele',
      papel: 'titular', householdId: household.id, status: 'ativo',
    });
    db.updateHousehold(household.id, { donoId: user.id });
    db.subscriptions.create({
      householdId: household.id,
      plano: ['mensal', 'anual'].includes(plano) ? plano : 'anual',
      estado: 'ativa', vigenteAte: null, cancelamento: null, asaasCustomerId: null,
    });

    res.status(201).json({ token: geraToken(user), usuario: publico(user) });
  });

  app.post('/auth/login', (req, res) => {
    const { email, senha } = req.body || {};
    const user = email ? db.findUserByEmail(email) : null;
    if (!user || !verificaSenha(senha, user.senhaHash)) return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
    res.json({ token: geraToken(user), usuario: publico(user) });
  });

  app.get('/me', exigeAuth, (req, res) => {
    const user = db.getUser(req.userId);
    if (!user) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    const h = user.householdId ? db.getHousehold(user.householdId) : null;
    res.json({
      usuario: publico(user),
      familia: h ? {
        id: h.id, temGuardiao: !!h.guardiaoId, temPin: !!h.pinHash,
        codigoPareamento: h.guardiaoId ? null : (h.codigoPareamento || null),
        membros: db.membersOf(h.id).map(publico),
        dependentes: db.membersOf(h.id).filter(u => u.papel === 'dependente').map(publico),
      } : null,
    });
  });

  // Titular convida o cônjuge: gera um CÓDIGO DE PAREAMENTO para ele entrar na
  // mesma conta pelo próprio celular. (Sem WhatsApp: o titular passa o código.)
  app.post('/household/guardiao', exigeAuth, (req, res) => {
    const { nome } = req.body || {};
    const user = db.getUser(req.userId);
    if (!user?.householdId) return res.status(400).json({ erro: 'Você não tem uma família.' });
    if (!nome) return res.status(400).json({ erro: 'Informe o nome do guardião.' });
    const h = db.getHousehold(user.householdId);
    if (h.guardiaoId) return res.status(409).json({ erro: 'Essa família já tem um guardião.' });
    const codigo = h.codigoPareamento || db.codigoPareamento();
    db.updateHousehold(h.id, { codigoPareamento: codigo, guardiaoNome: nome });
    res.status(201).json({ ok: true, codigoPareamento: codigo, aviso: 'Passe este código ao seu cônjuge para ele entrar na mesma conta pelo app dele.' });
  });

  // Cônjuge entra na mesma conta pelo próprio aparelho, com o código.
  app.post('/auth/guardiao/entrar', (req, res) => {
    const { codigo, email, senha } = req.body || {};
    if (!codigo || !email || !senha) return res.status(400).json({ erro: 'Informe o código, o e-mail e a senha.' });
    if (String(senha).length < 6) return res.status(400).json({ erro: 'A senha precisa de pelo menos 6 caracteres.' });
    const h = db.householdByCodigo(String(codigo));
    if (!h) return res.status(404).json({ erro: 'Código inválido ou expirado.' });
    if (h.guardiaoId) return res.status(409).json({ erro: 'Essa família já tem um guardião.' });
    if (db.findUserByEmail(email)) return res.status(409).json({ erro: 'Já existe uma conta com esse e-mail.' });
    const titular = db.getUser(h.donoId);
    const guardiao = db.createUser({
      nome: h.guardiaoNome || 'Guardião', email, senhaHash: hash(senha),
      genero: titular?.genero === 'ela' ? 'ele' : 'ela',
      papel: 'guardiao', householdId: h.id, status: 'ativo',
    });
    db.updateHousehold(h.id, { guardiaoId: guardiao.id, codigoPareamento: null });
    res.status(201).json({ token: geraToken(guardiao), usuario: publico(guardiao) });
  });

  app.post('/household/pin', exigeAuth, (req, res) => {
    const { pin } = req.body || {};
    const user = db.getUser(req.userId);
    if (!user?.householdId) return res.status(400).json({ erro: 'Você não tem uma família.' });
    if (!/^\d{4}$/.test(String(pin || ''))) return res.status(400).json({ erro: 'O PIN precisa ter 4 dígitos.' });
    const h = db.getHousehold(user.householdId);
    if (!h.guardiaoId) return res.status(400).json({ erro: 'O cônjuge precisa entrar na conta (parear) antes de definir o PIN.' });
    db.updateHousehold(h.id, { pinHash: hash(pin) });
    res.json({ ok: true, aviso: 'PIN de proteção salvo. A partir de agora, só o suporte reseta esse PIN.' });
  });

  // Verifica o PIN do guardião — usado para liberar a DESATIVAÇÃO da proteção.
  app.post('/household/verificar-pin', exigeAuth, (req, res) => {
    const { pin } = req.body || {};
    const user = db.getUser(req.userId);
    if (!user?.householdId) return res.status(400).json({ erro: 'Sem família.' });
    const h = db.getHousehold(user.householdId);
    if (!h?.pinHash) return res.json({ ok: true, semPin: true }); // sem PIN definido ainda
    res.json({ ok: verificaSenha(pin, h.pinHash) });
  });

  // Dependentes (filhos): membros gerenciados pelos pais, sem login próprio.
  // O aparelho do dependente é provisionado em /devices com donoId = id dele.
  const publicoDep = u => ({ id: u.id, nome: u.nome, idade: u.idade ?? null, papel: u.papel, status: u.status });
  app.post('/household/dependente', exigeAuth, (req, res) => {
    const { nome, idade } = req.body || {};
    const user = db.getUser(req.userId);
    if (!user?.householdId) return res.status(400).json({ erro: 'Você não tem uma família.' });
    if (user.papel === 'dependente') return res.status(403).json({ erro: 'Dependente não gerencia a família.' });
    if (!nome) return res.status(400).json({ erro: 'Informe o nome do dependente.' });
    const dep = db.createUser({
      nome, idade: idade ?? null,
      email: `dep-${db.id()}@dependente.aliancaapp`, senhaHash: null,
      genero: 'na', papel: 'dependente', householdId: user.householdId, status: 'gerenciado',
    });
    res.status(201).json({ ok: true, dependente: publicoDep(dep) });
  });

  app.get('/household/dependentes', exigeAuth, (req, res) => {
    const user = db.getUser(req.userId);
    const deps = db.membersOf(user.householdId).filter(u => u.papel === 'dependente').map(publicoDep);
    res.json({ dependentes: deps });
  });

  // Partes 2–5
  mountDevices(app);
  mountJourney(app);
  mountLifecycle(app);
  mountBilling(app);
  mountMessages(app);
  mountConvite(app);

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = process.env.PORT || 3000;
  criaApp().listen(port, () => console.log(`Aliança backend (Partes 1–5) rodando em http://localhost:${port}`));
}
