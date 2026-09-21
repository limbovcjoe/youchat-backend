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

const PROMPT_PADRAO =
  'Você é um assistente que entende de assuntos no geral, muito amigável e sempre bem direto com suas respostas, gosta de usar emojis e entende sobre tudo, responde sempre com respostas diretas e sem firulas';

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
      `https://zone.api.br/api/ia/deepseek-v4-flash` +
      `?apikey=${encodeURIComponent(ZONE_API_KEY)}` +
      `&text=${encodeURIComponent(mensagem.trim())}` +
      `&prompt=${encodeURIComponent(PROMPT_PADRAO)}` +
      `&session=youchat`;

    console.log('Chamando DeepSeek V4 Flash');

    const resposta = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36'
      }
    });

    const textoBruto = await resposta.text();
    console.log('Zone status:', resposta.status);

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

    // aceita tanto "result" quanto "text" na resposta
    const conteudo = dados?.result || dados?.text;

    if (!dados || !dados.status || !conteudo) {
      return res.status(502).json({
        erro: 'Resposta sem status/conteúdo',
        detalhe: JSON.stringify(dados).substring(0, 300)
      });
    }

    return res.json({ resposta: conteudo });
  } catch (erro) {
    console.error('Erro no /chat:', erro);
    return res.status(500).json({
      erro: 'Erro interno',
      detalhe: erro.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`youchat-backend rodando na porta ${PORT}`);
});
