// ============================================================
// Netlify Function: inscricoes
// Salva e lista as inscrições do torneio no MongoDB, para que
// todos os visitantes vejam os mesmos dados (não fica mais só
// no navegador de cada um).
//
// CONFIGURAÇÃO NECESSÁRIA (painel do Netlify):
//   Site settings > Environment variables > Add a variable
//     MONGODB_URI = sua connection string do MongoDB Atlas
//     MONGODB_DB  = valorcup   (opcional, esse é o padrão)
// ============================================================

const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'valorcup';
const COLLECTION = 'inscricoes';
const TOTAL_VAGAS = 64;

// Reaproveita a conexão entre invocações da function (fica mais rápido)
let cachedClient = null;
async function getCollection() {
  if (!uri) {
    throw new Error('MONGODB_URI não configurada nas variáveis de ambiente do Netlify.');
  }
  if (!cachedClient) {
    cachedClient = new MongoClient(uri);
    await cachedClient.connect();
  }
  return cachedClient.db(dbName).collection(COLLECTION);
}

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = 'VC-';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  try {
    const col = await getCollection();

    // ── LISTAR INSCRITOS (usado para montar o grid de participantes) ──
    if (event.httpMethod === 'GET') {
      const docs = await col
        .find({}, { projection: { _id: 0, nick: 1, rank: 1, agent: 1, code: 1 } })
        .sort({ createdAt: 1 })
        .toArray();

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ participants: docs, total: docs.length, vagas: TOTAL_VAGAS })
      };
    }

    // ── CRIAR NOVA INSCRIÇÃO ──
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { name, email, riot, discord, rank, agent, age } = body;

      if (!name || !email || !riot || !discord || !rank || !agent || !age) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Preencha todos os campos obrigatórios.' }) };
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'E-mail inválido.' }) };
      }

      const total = await col.countDocuments();
      if (total >= TOTAL_VAGAS) {
        return { statusCode: 409, headers, body: JSON.stringify({ error: 'As vagas do torneio já foram preenchidas.' }) };
      }

      const riotTrim = riot.trim();
      const jaInscrito = await col.findOne({ riot: riotTrim });
      if (jaInscrito) {
        return { statusCode: 409, headers, body: JSON.stringify({ error: 'Este Riot ID já está inscrito no torneio.' }) };
      }

      const nick = riotTrim.includes('#') ? riotTrim.split('#')[0] : riotTrim;
      const code = genCode();

      await col.insertOne({
        name: name.trim(),
        email: email.trim(),
        riot: riotTrim,
        discord: discord.trim(),
        rank,
        agent,
        age,
        nick,
        code,
        createdAt: new Date()
      });

      return { statusCode: 200, headers, body: JSON.stringify({ code, nick, rank, agent }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não permitido.' }) };
  } catch (err) {
    console.error('Erro na function inscricoes:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erro interno no servidor. Tente novamente em instantes.' }) };
  }
};
