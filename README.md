# AnitOS — Light Fade Dice Rooms

## Rodar localmente
Requer Node.js 20+. No terminal, dentro desta pasta:
1. `npm install`
2. `npm start`
3. Abra `http://localhost:3000`

Para testar, abra duas abas. Para jogar pela internet, publique este projeto como um serviço Node.js no Render ou Railway; use `npm install` como build command e `npm start` como start command.

## Persistência com Supabase
1. Crie um projeto no [Supabase](https://supabase.com/) e abra **Connect** no painel.
2. Copie a string PostgreSQL. Para ambientes IPv4, prefira o **Session pooler** se a conexão direta não estiver disponível.
3. Configure `DATABASE_URL` como variável de ambiente no serviço Node.js. Nunca coloque a string no frontend nem a envie ao GitHub.
4. Reinicie o serviço. O servidor cria a tabela `anitos_state` automaticamente e carrega o estado salvo.

O banco guarda salas, jogadores, tokens de recuperação e até 100 rolagens por sala. Depois de reiniciar o servidor, as sessões salvas podem ser recuperadas durante uma janela de 30 segundos. Sem `DATABASE_URL`, o projeto continua funcionando em memória, mas perde o estado ao reiniciar.

## Incluído
- Salas com códigos gerados no servidor e entrada por código
- Limites de frequência para criação/entrada em salas, reconexão, rolagens e encerramento
- Limite de 200 salas simultâneas e 20 jogadores por sala
- Jogadores e histórico sincronizados em tempo real
- D4, D6, D8, D10, D12, D20 e D100, com modificador
- Resultado calculado no servidor via `crypto.randomInt`
- Encerrar sala como administrador; se o administrador sair, outro jogador é promovido
- Reconexão de sessão por token temporário, sem contas ou senhas
