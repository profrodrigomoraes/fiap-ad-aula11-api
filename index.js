import express from 'express';
import cors from 'cors';
import { sql, garantirTabela, resetarBase } from './db.js';

const app = express();

// Quantos alunos a tabela aceita e quantas escritas (POST/PUT/PATCH/DELETE) por minuto cada IP pode fazer
const MAX_ALUNOS = Number(process.env.MAX_ALUNOS) || 500;
const LIMITE_ESCRITAS = Number(process.env.LIMITE_ESCRITAS_POR_MINUTO) || 60;

app.disable('x-powered-by');
// Na Vercel o IP real do visitante vem no header x-forwarded-for
if (process.env.VERCEL) app.set('trust proxy', true);

// Libera o acesso de qualquer site (necessário para usar fetch() de uma página HTML)
app.use(cors());
// Lê o corpo das requisições enviadas como JSON (no máximo 10 KB)
app.use(express.json({ limit: '10kb' }));
// Documentação e exemplos (na Vercel a pasta public/ é servida automaticamente)
app.use(express.static('public', { extensions: ['html'] }));

app.get('/', (req, res) => res.redirect('/docs'));
app.get('/exemplos', (req, res) => res.redirect('/exemplos/get'));

app.use((req, res, next) => {
  console.log(`${req.method} ${req.originalUrl}`);
  next();
});

// ---------------------------------------------------------------------------
// Limite de requisições: cada IP pode fazer LIMITE_ESCRITAS escritas por minuto.
// Fica na memória de cada instância do servidor, então é uma proteção básica.
// ---------------------------------------------------------------------------

const contadores = new Map();

function limitarEscritas(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const agora = Date.now();
  if (contadores.size > 10_000) contadores.clear();

  let contador = contadores.get(req.ip);
  if (!contador || agora - contador.inicio > 60_000) {
    contador = { inicio: agora, total: 0 };
    contadores.set(req.ip, contador);
  }
  contador.total++;

  if (contador.total > LIMITE_ESCRITAS) {
    const espera = Math.ceil((contador.inicio + 60_000 - agora) / 1000);
    res.set('Retry-After', String(espera));
    return res.status(429).json({ erro: `Muitas requisições. Aguarde ${espera} segundo(s) e tente de novo.` });
  }
  next();
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

const CAMPOS = ['nome', 'email', 'curso', 'idade'];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// parcial = true no PATCH (só valida o que foi enviado)
function validarAluno(body, { parcial = false } = {}) {
  if (body === undefined) {
    return ['Corpo da requisição vazio. Envie um JSON com o header "Content-Type: application/json".'];
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return ['O corpo da requisição deve ser um objeto JSON, ex: { "nome": "Ana", "email": "ana@email.com" }'];
  }

  const erros = [];

  const desconhecidos = Object.keys(body).filter((c) => !CAMPOS.includes(c));
  if (desconhecidos.length) {
    erros.push(`Campo(s) desconhecido(s): ${desconhecidos.join(', ')}. Campos aceitos: ${CAMPOS.join(', ')}.`);
  }

  if (!parcial || 'nome' in body) {
    if (typeof body.nome !== 'string' || body.nome.trim() === '') {
      erros.push('"nome" é obrigatório e deve ser um texto.');
    } else if (body.nome.length > 100) {
      erros.push('"nome" deve ter no máximo 100 caracteres.');
    }
  }

  if (!parcial || 'email' in body) {
    if (typeof body.email !== 'string' || !EMAIL_REGEX.test(body.email)) {
      erros.push('"email" é obrigatório e deve ser um e-mail válido, ex: "ana@email.com".');
    } else if (body.email.length > 150) {
      erros.push('"email" deve ter no máximo 150 caracteres.');
    }
  }

  if (body.curso !== undefined && body.curso !== null) {
    if (typeof body.curso !== 'string') {
      erros.push('"curso" deve ser um texto.');
    } else if (body.curso.length > 100) {
      erros.push('"curso" deve ter no máximo 100 caracteres.');
    }
  }

  if (body.idade !== undefined && body.idade !== null) {
    if (!Number.isInteger(body.idade) || body.idade < 0 || body.idade > 150) {
      erros.push('"idade" deve ser um número inteiro entre 0 e 150 (sem aspas), ex: 20.');
    }
  }

  // Bloqueia tags HTML (ex: <script>) para ninguém injetar código nas páginas dos colegas
  for (const campo of ['nome', 'email', 'curso']) {
    if (typeof body[campo] === 'string' && /[<>]/.test(body[campo])) {
      erros.push(`"${campo}" não pode conter os caracteres < ou >.`);
    }
  }

  if (parcial && erros.length === 0 && Object.keys(body).length === 0) {
    erros.push(`Envie ao menos um campo para atualizar: ${CAMPOS.join(', ')}.`);
  }

  return erros;
}

function limpar(body) {
  const dados = {};
  for (const campo of CAMPOS) {
    if (campo in body) {
      const valor = body[campo];
      dados[campo] = typeof valor === 'string' ? valor.trim() : valor;
    }
  }
  if (typeof dados.email === 'string') dados.email = dados.email.toLowerCase();
  return dados;
}

function lerId(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ erro: `ID inválido: "${req.params.id}". O ID deve ser um número inteiro positivo.` });
    return null;
  }
  return id;
}

function naoEncontrado(res, id) {
  return res.status(404).json({ erro: `Aluno com id ${id} não encontrado.` });
}

// Responde 404 ou 403 e devolve true se o aluno não puder ser alterado
async function bloqueado(res, id) {
  const [aluno] = await sql`SELECT protegido FROM alunos WHERE id = ${id}`;
  if (!aluno) {
    naoEncontrado(res, id);
    return true;
  }
  if (aluno.protegido) {
    res.status(403).json({
      erro: `O aluno ${id} é um exemplo protegido e não pode ser alterado nem excluído. Crie o seu com POST /alunos e use o id dele.`,
    });
    return true;
  }
  return false;
}

app.use(['/alunos', '/reset'], limitarEscritas);

// Garante que a tabela existe antes de qualquer rota de /alunos
app.use(['/alunos', '/reset'], async (req, res, next) => {
  await garantirTabela();
  next();
});

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------

// GET /alunos  -> lista todos (filtros opcionais: ?curso=Front-end  ?busca=ana)
app.get('/alunos', async (req, res) => {
  const curso = req.query.curso ? String(req.query.curso) : null;
  const busca = req.query.busca ? `%${req.query.busca}%` : null;

  const alunos = await sql`
    SELECT * FROM alunos
    WHERE (${curso}::text IS NULL OR curso ILIKE ${curso})
      AND (${busca}::text IS NULL OR nome ILIKE ${busca} OR email ILIKE ${busca})
    ORDER BY id`;

  res.json(alunos);
});

// GET /alunos/:id  -> busca um aluno
app.get('/alunos/:id', async (req, res) => {
  const id = lerId(req, res);
  if (id === null) return;

  const [aluno] = await sql`SELECT * FROM alunos WHERE id = ${id}`;
  if (!aluno) return naoEncontrado(res, id);

  res.json(aluno);
});

// POST /alunos  -> cria um aluno (o id é gerado pelo banco)
app.post('/alunos', async (req, res) => {
  const erros = validarAluno(req.body);
  if (erros.length) return res.status(400).json({ erro: 'Dados inválidos.', detalhes: erros });

  const [{ total }] = await sql`SELECT count(*)::int AS total FROM alunos`;
  if (total >= MAX_ALUNOS) {
    return res.status(403).json({ erro: `Limite de ${MAX_ALUNOS} alunos atingido. Exclua alguns antes de cadastrar novos.` });
  }

  const { nome, email, curso = null, idade = null } = limpar(req.body);
  const [aluno] = await sql`
    INSERT INTO alunos (nome, email, curso, idade)
    VALUES (${nome}, ${email}, ${curso}, ${idade})
    RETURNING *`;

  res.status(201).location(`/alunos/${aluno.id}`).json(aluno);
});

// PUT /alunos/:id  -> substitui o aluno inteiro (campos não enviados viram null)
app.put('/alunos/:id', async (req, res) => {
  const id = lerId(req, res);
  if (id === null) return;

  const erros = validarAluno(req.body);
  if (erros.length) return res.status(400).json({ erro: 'Dados inválidos.', detalhes: erros });
  if (await bloqueado(res, id)) return;

  const { nome, email, curso = null, idade = null } = limpar(req.body);
  const [aluno] = await sql`
    UPDATE alunos
    SET nome = ${nome}, email = ${email}, curso = ${curso}, idade = ${idade}, atualizado_em = now()
    WHERE id = ${id}
    RETURNING *`;
  if (!aluno) return naoEncontrado(res, id);

  res.json(aluno);
});

// PATCH /alunos/:id  -> atualiza só os campos enviados
app.patch('/alunos/:id', async (req, res) => {
  const id = lerId(req, res);
  if (id === null) return;

  const erros = validarAluno(req.body, { parcial: true });
  if (erros.length) return res.status(400).json({ erro: 'Dados inválidos.', detalhes: erros });
  if (await bloqueado(res, id)) return;

  const dados = limpar(req.body);
  const campos = Object.keys(dados);
  const sets = campos.map((campo, i) => `${campo} = $${i + 1}`).join(', ');
  const [aluno] = await sql.query(
    `UPDATE alunos SET ${sets}, atualizado_em = now() WHERE id = $${campos.length + 1} RETURNING *`,
    [...Object.values(dados), id],
  );
  if (!aluno) return naoEncontrado(res, id);

  res.json(aluno);
});

// DELETE /alunos/:id  -> remove o aluno
app.delete('/alunos/:id', async (req, res) => {
  const id = lerId(req, res);
  if (id === null) return;
  if (await bloqueado(res, id)) return;

  const [aluno] = await sql`DELETE FROM alunos WHERE id = ${id} RETURNING *`;
  if (!aluno) return naoEncontrado(res, id);

  res.json({ mensagem: `Aluno ${id} removido com sucesso.`, aluno });
});

// POST /reset  -> volta a base para os 5 alunos iniciais (uso do professor)
// Exige o header  x-reset-key  com o valor da variável RESET_KEY
app.post('/reset', async (req, res) => {
  if (!process.env.RESET_KEY || req.get('x-reset-key') !== process.env.RESET_KEY) {
    return res.status(403).json({ erro: 'Chave de reset inválida.' });
  }
  await resetarBase();
  res.json({ mensagem: 'Base resetada para os alunos iniciais.' });
});

// Métodos que não existem numa rota que existe -> 405 com dica
app.all('/alunos', (req, res) => {
  res.status(405).set('Allow', 'GET, POST').json({
    erro: `O método ${req.method} não é aceito em /alunos. Use GET (listar) ou POST (criar).`,
  });
});
app.all('/alunos/:id', (req, res) => {
  const dica = req.method === 'POST'
    ? ' Para criar um aluno use POST /alunos (sem id): o id é gerado automaticamente.'
    : '';
  res.status(405).set('Allow', 'GET, PUT, PATCH, DELETE').json({
    erro: `O método ${req.method} não é aceito em /alunos/:id.${dica}`,
  });
});

// Rota inexistente
app.use((req, res) => {
  res.status(404).json({ erro: `Rota ${req.method} ${req.path} não existe. Veja a documentação em /docs` });
});

// Tratamento de erros
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ erro: 'Corpo da requisição muito grande (máximo 10 KB).' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      erro: 'JSON mal formatado. Confira aspas duplas nas chaves e textos, vírgulas e chaves { }.',
    });
  }
  if (err.code === '23505') {
    return res.status(409).json({ erro: 'Já existe um aluno com esse e-mail.' });
  }
  console.error(err);
  res.status(500).json({ erro: 'Erro interno no servidor.' });
});

// Localmente sobe o servidor; na Vercel o app exportado é usado como função
if (!process.env.VERCEL) {
  const porta = process.env.PORT || 3000;
  app.listen(porta, () => console.log(`API rodando em http://localhost:${porta}`));
}

export default app;
