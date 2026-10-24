# API de Alunos

API didática para praticar `fetch()` com GET, POST, PUT, PATCH e DELETE.
A documentação fica em `/docs` (a raiz `/` redireciona para lá) e tem e um botão para testar cada rota.

| Método | Rota           | O que faz                              |
| ------ | -------------- | -------------------------------------- |
| GET    | `/alunos`      | Lista todos (`?curso=` e `?busca=`)    |
| GET    | `/alunos/{id}` | Busca um aluno                         |
| POST   | `/alunos`      | Cria um aluno (id gerado pelo banco)   |
| PUT    | `/alunos/{id}` | Substitui o aluno inteiro              |
| PATCH  | `/alunos/{id}` | Atualiza só os campos enviados         |
| DELETE | `/alunos/{id}` | Remove o aluno                         |
| POST   | `/reset`       | Volta aos 5 alunos iniciais (header `x-reset-key`) |

Páginas de exemplo comentadas, uma por método, em [public/exemplos/](public/exemplos/)
(`get.html`, `post.html`, `put.html`, `delete.html`). Elas usam a constante `API_URL`
no início do `<script>`.

A tabela `alunos` é criada sozinha na primeira requisição, já com 5 alunos de exemplo.

## Segurança básica

- Os 5 alunos iniciais são protegidos (): PUT/PATCH/DELETE neles responde 403.
- Textos não aceitam  ou , para ninguém injetar HTML/JS nas páginas dos colegas.
- No máximo  registros (padrão 500).
- Cada IP pode fazer  escritas por minuto (padrão 60). Ajuste se a turma
  inteira sair pelo mesmo IP da rede da faculdade.
- Corpo JSON de no máximo 10 KB; erros 500 não expõem detalhes do banco.
- SQL sempre parametrizado (sem SQL injection).

## Rodar localmente

```bash
npm install
npm run dev        # http://localhost:3000
```

As variáveis ficam no `.env` (veja `.env.example`).

## Deploy na Vercel

1. Suba o projeto para o GitHub e importe na Vercel (ou rode `npx vercel`).
2. Em **Settings → Environment Variables**, cadastre `DATABASE_URL` e `RESET_KEY`.
3. Faça o deploy. Não precisa de `vercel.json`: a Vercel reconhece o Express sozinha.

## Resetar a base depois da aula

```bash
curl -X POST https://SEU-PROJETO.vercel.app/reset -H "x-reset-key: SUA_CHAVE"
```
