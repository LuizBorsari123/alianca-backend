# Listas de bloqueio

O Aliança não mantém sua própria lista de sites adultos — isso seria trabalho
sem fim. Usamos listas abertas, mantidas pela comunidade e atualizadas todo dia,
e adicionamos só a nossa lista curta que fecha as fugas (`custom-bloqueio.txt`).

No painel do AdGuard Home → **Filtros → Listas de bloqueio DNS → Adicionar**,
cole as URLs abaixo. Confirme a URL atual de cada uma antes (projetos mudam de
caminho às vezes).

| Lista | O que cobre | URL (conferir) |
| --- | --- | --- |
| HaGeZi — NSFW | Pornografia e conteúdo adulto | `https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/nsfw.txt` |
| HaGeZi — DoH/VPN/Proxy Bypass | Serviços usados para escapar do filtro | `https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/doh-vpn-proxy-bypass.txt` |
| OISD (Big) | Malware, phishing e lixo em geral | `https://big.oisd.nl` |
| Aliança — própria | Fechos extras (este repositório) | `dns/custom-bloqueio.txt` |

## Busca segura forçada

No AdGuard Home → **Configurações → Busca segura**, ative para Google, Bing,
DuckDuckGo e YouTube (modo restrito). Isso tira conteúdo adulto de dentro dos
buscadores e do YouTube, que o bloqueio por domínio sozinho não alcança.

## Atualização

Marque as listas para **atualizar automaticamente** (ex.: a cada 24h). Sites
adultos trocam de domínio o tempo todo; a atualização diária é o que mantém o
filtro útil.
