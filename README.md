# AnitOS — Light Fade Dice Rooms

## Rodar localmente
Requer Node.js 20+. No terminal, dentro desta pasta:
1. `npm install`
2. `npm start`
3. Abra `http://localhost:3000`

Para testar, abra duas abas. Para jogar pela internet, publique este projeto como um serviço Node.js no Render ou Railway; use `npm install` como build command e `npm start` como start command.

## Incluído
- Salas com códigos gerados no servidor e entrada por código
- Jogadores e histórico sincronizados em tempo real
- D4, D6, D8, D10, D12, D20 e D100, com modificador
- Resultado calculado no servidor via `crypto.randomInt`
- Encerrar sala como administrador; se o administrador sair, outro jogador é promovido

## Limitações
Salas e rolagens ficam na memória e desaparecem quando o servidor reinicia. Não há contas, autenticação, persistência em banco, expulsão de jogadores ou proteção contra abuso. É uma primeira versão funcional para teste, não um serviço de alta segurança.
