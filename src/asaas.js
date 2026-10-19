// Cliente da API do Asaas (pagamento dentro do app).
// Precisa da chave de API do Asaas em ASAAS_API_KEY. Em produção, use a chave de
// produção e ASAAS_ENV=prod. Sem a chave, o backend responde que não está
// configurado (nada quebra).

const ENV = process.env.ASAAS_ENV || 'sandbox';
const BASE = ENV === 'prod' ? 'https://api.asaas.com/v3' : 'https://sandbox.asaas.com/api/v3';
const KEY = process.env.ASAAS_API_KEY || '';

export const asaasConfigurado = () => !!KEY;

async function asaas(path, { method = 'GET', body } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', access_token: KEY },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Asaas ${r.status}: ${JSON.stringify(data.errors || data)}`);
  return data;
}

// 1) cria (ou reaproveita) o cliente no Asaas
export function criarCliente({ nome, email, cpfCnpj, telefone }) {
  return asaas('/customers', { method: 'POST', body: { name: nome, email, cpfCnpj, mobilePhone: telefone } });
}

// 2) cria a assinatura recorrente ligada à família (externalReference)
export function criarAssinatura({ customerId, valor, ciclo, billingType, householdId }) {
  const hoje = new Date().toISOString().slice(0, 10);
  return asaas('/subscriptions', {
    method: 'POST',
    body: {
      customer: customerId,
      billingType,                 // 'PIX' | 'CREDIT_CARD' | 'UNDEFINED'
      value: valor,                // em reais (ex.: 29.90)
      nextDueDate: hoje,
      cycle: ciclo,                // 'MONTHLY' | 'YEARLY'
      externalReference: householdId,
      description: 'Aliança — proteção da família',
    },
  });
}

// 3) pega o QR Code Pix da primeira cobrança da assinatura (para mostrar no app)
export async function pixDaAssinatura(subscriptionId) {
  const pagamentos = await asaas(`/subscriptions/${subscriptionId}/payments`);
  const primeiro = pagamentos?.data?.[0];
  if (!primeiro) return null;
  const qr = await asaas(`/payments/${primeiro.id}/pixQrCode`);
  return { paymentId: primeiro.id, invoiceUrl: primeiro.invoiceUrl, pix: { payload: qr.payload, imagemBase64: qr.encodedImage, expira: qr.expirationDate } };
}
