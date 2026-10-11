# AnitOS — Light Fade Dice Rooms

## Rodar localmente
Requer Node.js 20+. No terminal, dentro desta pasta:
1. `npm install`
2. `npm start`
3. Abra `http://localhost:3000`

Para testar, abra duas abas. Para jogar pela internet, publique este projeto como um serviço Node.js no Render ou Railway; use `npm install` como build command e `npm start` como start command.

## Incluído
- Salas com códigos gerados no servidor e entrada por código
- Limites de frequência para criação/entrada em salas, reconexão, rolagens e encerramento
- Limite de 200 salas simultâneas e 20 jogadores por sala
- Jogadores e histórico sincronizados em tempo real
- D4, D6, D8, D10, D12, D20 e D100, com modificador
- Resultado calculado no servidor via `crypto.randomInt`
- Encerrar sala como administrador; se o administrador sair, outro jogador é promovido
- Reconexão de sessão por token temporário, sem contas ou senhas

## Limitações
As salas e rolagens ficam na memória e desaparecem quando o servidor reinicia. Ainda não há persistência em banco de dados. Os limites de frequência também ficam na memória e não substituem proteção de infraestrutura contra ataques distribuídos (DDoS). Esta é uma proteção básica para o protótipo, não uma solução completa de alta segurança.
