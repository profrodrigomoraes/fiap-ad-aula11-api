import { neon } from '@neondatabase/serverless';

export const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;

// Alunos que aparecem quando a tabela está vazia ou quando a base é resetada
const ALUNOS_INICIAIS = [
  { nome: 'Ana Souza', email: 'ana.souza@email.com', curso: 'Front-end', idade: 20 },
  { nome: 'Bruno Lima', email: 'bruno.lima@email.com', curso: 'Back-end', idade: 22 },
  { nome: 'Carla Mendes', email: 'carla.mendes@email.com', curso: 'Front-end', idade: 19 },
  { nome: 'Diego Rocha', email: 'diego.rocha@email.com', curso: 'Dados', idade: 25 },
  { nome: 'Elisa Martins', email: 'elisa.martins@email.com', curso: 'UX Design', idade: 21 },
];

// Os alunos iniciais são "protegidos": ninguém consegue editar ou excluir
async function inserirAlunosIniciais() {
  for (const a of ALUNOS_INICIAIS) {
    await sql`
      INSERT INTO alunos (nome, email, curso, idade, protegido)
      VALUES (${a.nome}, ${a.email}, ${a.curso}, ${a.idade}, true)`;
  }
}

// Cria a tabela na primeira requisição (só uma vez por instância do servidor)
let pronto;
export function garantirTabela() {
  if (!sql) {
    return Promise.reject(new Error('DATABASE_URL não definida. Coloque a URL do Neon no .env (local) ou nas Environment Variables da Vercel.'));
  }
  pronto ??= (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS alunos (
        id            SERIAL PRIMARY KEY,
        nome          TEXT NOT NULL,
        email         TEXT NOT NULL UNIQUE,
        curso         TEXT,
        idade         INTEGER,
        protegido     BOOLEAN NOT NULL DEFAULT false,
        criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
    // Para tabelas criadas antes da coluna "protegido" existir
    await sql`ALTER TABLE alunos ADD COLUMN IF NOT EXISTS protegido BOOLEAN NOT NULL DEFAULT false`;
    await sql`UPDATE alunos SET protegido = true WHERE email = ANY(${ALUNOS_INICIAIS.map((a) => a.email)}) AND NOT protegido`;

    const [{ total }] = await sql`SELECT count(*)::int AS total FROM alunos`;
    if (total === 0) await inserirAlunosIniciais();
  })().catch((erro) => {
    pronto = undefined; // tenta de novo na próxima requisição
    throw erro;
  });
  return pronto;
}

export async function resetarBase() {
  await sql`TRUNCATE alunos RESTART IDENTITY`;
  await inserirAlunosIniciais();
}
