// Ponto de entrada de PRODUÇÃO.
// Sobe o backend em HTTPS quando há certificado (CERT_FULLCHAIN/CERT_KEY nas
// variáveis de ambiente); caso contrário, em HTTP (desenvolvimento).
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { criaApp } from './server.js';

const port = Number(process.env.PORT || 3000);
const app = criaApp();

const fullchain = process.env.CERT_FULLCHAIN;
const key = process.env.CERT_KEY;

if (fullchain && key && fs.existsSync(fullchain) && fs.existsSync(key)) {
  const options = { cert: fs.readFileSync(fullchain), key: fs.readFileSync(key) };
  https.createServer(options, app).listen(port, () => {
    console.log(`Aliança backend (HTTPS) na porta ${port}`);
  });
} else {
  http.createServer(app).listen(port, () => {
    console.log(`Aliança backend (HTTP) na porta ${port}`);
  });
}
