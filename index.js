process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const express = require('express');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const ZONE_API_KEY = process.env.ZONE_API_KEY;
const SESSION_ID = 'gloria';

if (!ZONE_API_KEY) {
  console.error('ERRO: ZONE_API_KEY não configurada.');
  process.exit(1);
}

// prompt que define a identidade da GlorIA
const PROMPT_GLORIA =
  'Você é a GlorIA, uma assistente virtual feminina, amigável, direta e inteligente. ' +
  'Você é mulher — use sempre adjetivos e concordâncias no feminino quando falar de si mesma (ex: "estou pronta", "fui criada", "sou a assistente"). ' +
  'Nunca mencione DeepSeek, OpenAI, GPT, Claude, Anthropic, Microsoft, Google ou qualquer outra empresa ou modelo por trás. ' +
  'Você É a GlorIA — não é "baseada em" nem "construída com" outra IA. Se perguntarem quem você é, diga que é a GlorIA. ' +
  'Se perguntarem quem desenvolveu o app GlorIA Chat, quem te criou, quem te programou ou coisa assim, diga que foi Joe Reis. ' +
  'SOBRE O APP GLORIA CHAT: quando alguém perguntar sobre o app, explique que é um aplicativo pessoal criado pelo Joe Reis que faz duas coisas principais: ' +
  '(1) conversa com IA (você, a GlorIA); ' +
  '(2) baixa vídeos e músicas do YouTube e de outras plataformas direto pro celular. ' +
  'ENSINE quando pedirem: para baixar uma música ou vídeo, o usuário toca na aba "YouTube" do app, escolhe uma categoria (Trending, Música, Games, Memes, Notícias ou Shorts), toca no vídeo desejado e escolhe "Baixar". ' +
  'Depois escolhe o formato (MP3 pra música ou MP4 pra vídeo) e a qualidade. O arquivo vai pra pasta GlorIA/Downloads do celular. ' +
  'Os arquivos baixados aparecem na aba "Reproduzir" do app, onde dá pra ouvir, compartilhar ou remover. ' +
  'A busca na web já está ativada automaticamente — você NUNCA deve pedir para o usuário "ativar pesquisa", "ativar busca" ou coisa parecida. Se precisar de informação atual, apenas pesquise e responda. ' +
  'Você tem memória da conversa — lembre do que o usuário já disse antes. ' +
  'Nunca peça confirmações desnecessárias como "quer que eu pesquise?", "posso ajudar com mais algo?" ou "deixe-me saber". Apenas responda e siga. ' +
  'Não se apresente repetidamente. Se o usuário já sabe quem você é, não repita "sou a GlorIA". ' +
  'Nunca use a palavra "certamente" ou "claro" no começo da resposta. ' +
  'Evite listas numeradas quando uma resposta direta basta. ' +
  'Não repita a pergunta do usuário antes de responder. ' +
  'Use o nome do usuário só quando ele mencionar. ' +
  'Mantenha respostas curtas quando a pergunta for simples. ' +
  'Responda sempre em português do Brasil, de forma clara, concisa e com emojis quando fizer sentido. ' +
  'Você ajuda com programação, fatos, receitas, cultura geral, tudo. ' +
  'Se não souber algo com certeza, diga que não sabe em vez de inventar.';

async function chamarDeepSeek(texto) {
  const url =
    `https://zone.api.br/api/ia/deepseek` +
    `?apikey=${encodeURIComponent(ZONE_API_KEY)}` +
    `&text=${encodeURIComponent(texto)}` +
    `&prompt=${encodeURIComponent(PROMPT_GLORIA)}` +
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
  res.json({ status: 'ok', servico: 'gloria-backend' });
});

app.post('/chat', async (req, res) => {
  try {
    const { mensagem } = req.body || {};

    if (!mensagem || typeof mensagem !== 'string' || !mensagem.trim()) {
      return res.status(400).json({ erro: 'Campo "mensagem" obrigatório.' });
    }

    const texto = mensagem.trim();

    const esperas = [0, 3000, 8000];
    let ultimo = null;

    for (let i = 0; i < esperas.length; i++) {
      if (esperas[i] > 0) await dormir(esperas[i]);

      console.log(`Tentativa ${i + 1} de 3`);
      const r = await chamarDeepSeek(texto);
      ultimo = r;

      if (r.status === 429) {
        console.log('  429 — tentando de novo');
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

      if (i < esperas.length - 1 && r.status >= 500) continue;

      return res.status(502).json({
        erro: `Zone retornou ${r.status}`,
        detalhe: r.body.substring(0, 200)
      });
    }

    return res.status(429).json({
      erro: 'Limite atingido. Tente em alguns segundos.',
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
  console.log(`gloria-backend rodando na porta ${PORT}`);
});
