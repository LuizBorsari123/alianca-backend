// Configurações e segredos. Na produção, tudo isto vem de variáveis de ambiente.

export const JANELA_REMOCAO_MS = Number(process.env.JANELA_REMOCAO_MS || 30 * 60 * 1000); // 30 min
export const CARENCIA_CANCEL_MS = Number(process.env.CARENCIA_CANCEL_MS || 30 * 60 * 1000); // 30 min de espera
export const CARENCIA_POS_CANCEL_MS = Number(process.env.CARENCIA_POS_CANCEL_MS || 72 * 60 * 60 * 1000); // 72h
export const SUPORTE_EMAIL = process.env.SUPORTE_EMAIL || 'suporte@aliancaapp.com.br';

// segredo compartilhado com o servidor de DNS, o gateway de pagamento e o suporte.
// Esses pontos NÃO usam token de usuário; usam este segredo no cabeçalho.
const SERVICE_SECRET = process.env.SERVICE_SECRET || 'servico-prototipo-trocar';

export function exigeServico(req, res, next) {
  if ((req.headers['x-service-secret'] || '') !== SERVICE_SECRET) {
    return res.status(403).json({ erro: 'Acesso de serviço negado.' });
  }
  next();
}

// token que o Asaas envia no cabeçalho do webhook (configurável no painel do Asaas)
export const ASAAS_WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN || 'asaas-prototipo-trocar';

// metas de dias firmes (psicologia da recuperação)
export const MARCOS_META = [7, 21, 66, 90];
