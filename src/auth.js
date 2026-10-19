// Autenticação: hash de senha (bcrypt) e token de sessão (JWT).
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// Na produção isso vem de variável de ambiente; aqui um padrão para o protótipo.
const JWT_SECRET = process.env.JWT_SECRET || 'alianca-prototipo-segredo-trocar-em-producao';
const TOKEN_EXP = '30d';

export function hash(senha) {
  return bcrypt.hashSync(String(senha), 10);
}
export function verificaSenha(senha, hashSalvo) {
  if (!hashSalvo) return false;
  return bcrypt.compareSync(String(senha), hashSalvo);
}
export function geraToken(user) {
  return jwt.sign({ sub: user.id, papel: user.papel }, JWT_SECRET, { expiresIn: TOKEN_EXP });
}
export function leToken(token) {
  try { return jwt.verify(token, JWT_SECRET); }
  catch { return null; }
}

// middleware express: exige um token válido no cabeçalho Authorization: Bearer <token>
export function exigeAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const payload = token ? leToken(token) : null;
  if (!payload) return res.status(401).json({ erro: 'Não autenticado. Faça login.' });
  req.userId = payload.sub;
  next();
}
