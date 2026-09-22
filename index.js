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

async function chamarDeepSeek(texto) {
  const url =
    `https://zone.api.br/api/ia/deepseek` +
    `?apikey=${encodeURIComponent(ZONE_API_KEY)}` +
    `&text=${encodeURIComponent(texto)}` +
    `&session=${encodeURIComponent(SESSION_ID)}` +
    `&mode=expert`;

  const resposta = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36'
    }
  });

  const corpo = await resposta.text();
  return { status: resposta.status, body: corpo };
}

function dormir(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

    const texto = mensagem.trim();

    // 3 tentativas com espera progressiva em caso de 429
    const esperas = [0, 3000, 8000];
    let ultimo = null;

    for (let i = 0; i < esperas.length; i++) {
      if (esperas[i] > 0) await dormir(esperas[i]);

      console.log(`Tentativa ${i + 1} de 3`);
      const r = await chamarDeepSeek(texto);
      ultimo = r;

      if (r.status === 429) {
        console.log(`  429 — tentando de novo em ${esperas[i + 1] || 'desistir'}ms`);
        continue;
      }

      if (r.status >= 200 && r.status < 300) {
        try {
          const dados = JSON.parse(r.body);
          const conteudo = dados?.result || dados?.text;
          if (dados?.status && conteudo) {
            console.log('  OK');
            return res.json({ resposta: conteudo });
          }
          // status:false da própria Zone (ex: erro interno)
          console.log('  Zone status false:', JSON.stringify(dados).substring(0, 200));
          if (i < esperas.length - 1) continue;
          return res.status(502).json({
            erro: 'IA indisponível',
            detalhe: JSON.stringify(dados).substring(0, 200)
          });
        } catch (e) {
          return res.status(502).json({
            erro: 'Resposta inválida',
            detalhe: r.body.substring(0, 200)
          });
        }
      }

      // erro 5xx ou outro — tenta de novo se tiver tentativa
      if (i < esperas.length - 1 && r.status >= 500) continue;

      return res.status(502).json({
        erro: `Zone retornou ${r.status}`,
        detalhe: r.body.substring(0, 200)
      });
    }

    return res.status(429).json({
      erro: 'Limite de requisições atingido. Tente em alguns segundos.',
      detalhe: ultimo?.body?.substring(0, 200) || ''
    });
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
