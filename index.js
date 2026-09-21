process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const express = require('express');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const ZONE_API_KEY = process.env.ZONE_API_KEY;

if (!ZONE_API_KEY) {
  console.error('ERRO: ZONE_API_KEY não configurada.');
  process.exit(1);
}

// ========== memória em RAM ==========
const LIMITE_HISTORICO = 10;
const historico = [];

function adicionarAoHistorico(role, content) {
  historico.push({ role, content });
  while (historico.length > LIMITE_HISTORICO) {
    historico.shift();
  }
}

function montarPromptComHistorico() {
  const base =
    'Você é um assistente amigável, direto e entende de tudo — programação, fatos, atualidades. Responda em português do Brasil, com emojis quando fizer sentido. Se não tiver certeza de algo, diga que não sabe em vez de inventar.';

  if (historico.length === 0) return base;

  const linhas = historico
    .map(m => `${m.role === 'user' ? 'Usuário' : 'Assistente'}: ${m.content}`)
    .join('\n');

  return (
    base +
    '\n\n--- Histórico recente ---\n' +
    linhas +
    '\n--- Fim ---\n' +
    'Use o histórico pra manter o contexto. Responda à nova mensagem a seguir.'
  );
}
// ====================================

app.get('/', (req, res) => {
  res.json({ status: 'ok', servico: 'youchat-backend' });
});

app.post('/limpar', (req, res) => {
  historico.length = 0;
  res.json({ status: 'ok', mensagem: 'Histórico limpo.' });
});

app.post('/chat', async (req, res) => {
  try {
    const { mensagem } = req.body || {};

    if (!mensagem || typeof mensagem !== 'string' || !mensagem.trim()) {
      return res.status(400).json({ erro: 'Campo "mensagem" obrigatório.' });
    }

    const msgLimpa = mensagem.trim();
    const prompt = montarPromptComHistorico();

    const url =
      `https://zone.api.br/api/copilot` +
      `?apikey=${encodeURIComponent(ZONE_API_KEY)}` +
      `&text=${encodeURIComponent(msgLimpa)}` +
      `&prompt=${encodeURIComponent(prompt)}`;

    console.log('Copilot 1 · Histórico:', historico.length);

    const resposta = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36'
      }
    });

    const textoBruto = await resposta.text();

    if (!resposta.ok) {
      return res.status(502).json({
        erro: `Zone retornou ${resposta.status}`,
        detalhe: textoBruto.substring(0, 200)
      });
    }

    let dados;
    try {
      dados = JSON.parse(textoBruto);
    } catch (e) {
      return res.status(502).json({
        erro: 'Zone não devolveu JSON',
        detalhe: textoBruto.substring(0, 200)
      });
    }

    const conteudo = dados?.result || dados?.text;

    if (!dados || !dados.status || !conteudo) {
      return res.status(502).json({
        erro: 'Resposta sem status/conteúdo',
        detalhe: JSON.stringify(dados).substring(0, 300)
      });
    }

    adicionarAoHistorico('user', msgLimpa);
    adicionarAoHistorico('assistant', conteudo);

    return res.json({ resposta: conteudo });
  } catch (erro) {
    console.error('Erro:', erro);
    return res.status(500).json({
      erro: 'Erro interno',
      detalhe: erro.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`youchat-backend rodando na porta ${PORT}`);
});
