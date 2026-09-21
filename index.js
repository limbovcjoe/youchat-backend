const express = require('express');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const ZONE_API_KEY = process.env.ZONE_API_KEY;
const SESSION_ID = 'youchat';

if (!ZONE_API_KEY) {
  console.error('ERRO: ZONE_API_KEY não configurada.');
  process.exit(1);
}

app.get('/', (req, res) => {
  res.json({ status: 'ok', servico: 'youchat-backend' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/chat', async (req, res) => {
  try {
    const { mensagem } = req.body || {};

    if (!mensagem || typeof mensagem !== 'string' || !mensagem.trim()) {
      return res.status(400).json({ erro: 'Campo "mensagem" obrigatório.' });
    }

    const prompt = 'Você é um assistente útil, direto e amigável. Responda em português do Brasil de forma clara e concisa.';

    const url =
      `https://zone.api.br/api/ia/deepai` +
      `?apikey=${encodeURIComponent(ZONE_API_KEY)}` +
      `&text=${encodeURIComponent(mensagem.trim())}` +
      `&prompt=${encodeURIComponent(prompt)}` +
      `&session=${encodeURIComponent(SESSION_ID)}`;

    const resposta = await fetch(url);

    if (!resposta.ok) {
      console.error('Zone API status:', resposta.status);
      return res.status(502).json({ erro: 'Serviço de IA indisponível.' });
    }

    const dados = await resposta.json();

    if (!dados || !dados.status || !dados.result) {
      console.error('Resposta inesperada da Zone:', dados);
      return res.status(502).json({ erro: 'Resposta inválida da IA.' });
    }

    return res.json({ resposta: dados.result });
  } catch (erro) {
    console.error('Erro no /chat:', erro);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
});

app.listen(PORT, () => {
  console.log(`youchat-backend rodando na porta ${PORT}`);
});
