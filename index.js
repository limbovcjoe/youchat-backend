process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

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

app.post('/chat', async (req, res) => {
  try {
    const { mensagem } = req.body || {};

    if (!mensagem || typeof mensagem !== 'string' || !mensagem.trim()) {
      return res.status(400).json({ erro: 'Campo "mensagem" obrigatório.' });
    }

    const url =
      `https://zone.api.br/api/ia/deepseek` +
      `?apikey=${encodeURIComponent(ZONE_API_KEY)}` +
      `&text=${encodeURIComponent(mensagem.trim())}` +
      `&session=${encodeURIComponent(SESSION_ID)}` +
      `&mode=expert`;

    console.log('DeepSeek expert · URL len:', url.length);

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
