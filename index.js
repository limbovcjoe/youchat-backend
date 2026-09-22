process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const express = require('express');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const ZONE_API_KEY = process.env.ZONE_API_KEY;
const SESSION_ID = 'gloria-v3';

if (!ZONE_API_KEY) {
  console.error('ERRO: ZONE_API_KEY não configurada.');
  process.exit(1);
}

// ====== prompt ======
const PROMPT_GLORIA =
  'Você é a GlorIA, uma assistente virtual feminina, amigável, direta e inteligente. ' +
  'Você é mulher — use sempre adjetivos e concordâncias no feminino quando falar de si mesma. ' +
  'Nunca mencione OpenAI, GPT, DeepSeek, Claude, Anthropic, Microsoft, Google ou qualquer outra empresa ou modelo por trás. ' +
  'Você É a GlorIA — não é "baseada em" nem "construída com" outra IA. Se perguntarem quem você é, diga que é a GlorIA. ' +
  'Se perguntarem quem desenvolveu o app GlorIA Chat, quem te criou ou coisa assim, diga que foi Joe Reis. ' +
  'Você tem memória da conversa — lembre do que o usuário já disse antes. ' +
  'A busca na web NÃO está ativa por padrão. Se o usuário precisar de informação atual, avise que ele pode ativar o botão de pesquisa. ' +
  'SOBRE O APP GLORIA CHAT: aplicativo pessoal criado pelo Joe Reis. Faz: (1) conversa com IA (você); (2) baixa vídeos/músicas do YouTube. ' +
  'Para baixar: usuário toca na aba "YouTube", escolhe uma categoria, toca no vídeo e escolhe "Baixar". ' +
  'Arquivos vão pra pasta GlorIA/Downloads do celular. Aparecem na aba "Reproduzir". ' +
  'Nunca peça confirmações desnecessárias. Apenas responda. ' +
  'Não se apresente repetidamente. ' +
  'Nunca use "certamente" ou "claro" no começo da resposta. ' +
  'Mantenha respostas curtas quando a pergunta for simples. ' +
  'Responda em português do Brasil, com emojis quando fizer sentido. ' +
  'Se não souber algo com certeza, diga que não sabe em vez de inventar.';

// ====== ferramentas disponíveis ======
const FERRAMENTAS_INFO =
  '\n\nVocê tem acesso a FERRAMENTAS. Use APENAS quando necessário:\n' +
  '[TOOL:pesquisa] <termo>  — para buscar informação atual na web (notícias, jogos, cotação)\n' +
  '[TOOL:placar] <time>  — para resultados de futebol (jogos, tabelas)\n' +
  '\nSe precisar de uma ferramenta, responda EXATAMENTE no formato acima, nada mais. ' +
  'Se não precisar, responda a pergunta normalmente.';

const PROMPT_COM_FERRAMENTAS = PROMPT_GLORIA + FERRAMENTAS_INFO;

// ====== funções de chamada ======

async function chamarGPT5Nano(texto, usarFerramentas) {
  const promptFinal = usarFerramentas ? PROMPT_COM_FERRAMENTAS : PROMPT_GLORIA;

  const url =
    `https://zone.api.br/api/ia/gpt-5-nano` +
    `?apikey=${encodeURIComponent(ZONE_API_KEY)}` +
    `&text=${encodeURIComponent(texto)}` +
    `&prompt=${encodeURIComponent(promptFinal)}` +
    `&session=${encodeURIComponent(SESSION_ID)}`;

  const resposta = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36' }
  });
  const corpo = await resposta.text();
  return { status: resposta.status, body: corpo };
}

async function pesquisarWeb(termo) {
  // usa o próprio GPT5 com search implícito — alternativa: DeepSearch
  const url =
    `https://zone.api.br/api/ia/gpt-5-nano` +
    `?apikey=${encodeURIComponent(ZONE_API_KEY)}` +
    `&text=${encodeURIComponent('Pesquise na web e responda: ' + termo)}` +
    `&prompt=${encodeURIComponent('Pesquise na web e responda de forma factual e direta.')}` +
    `&search=1`;

  try {
    const r = await fetch(url);
    const texto = await r.text();
    const dados = JSON.parse(texto);
    return dados?.result || dados?.text || '';
  } catch (e) {
    return '';
  }
}

async function buscarPlacar(time) {
  const url =
    `https://zone.api.br/api/placar` +
    `?apikey=${encodeURIComponent(ZONE_API_KEY)}` +
    `&time=${encodeURIComponent(time)}`;

  try {
    const r = await fetch(url);
    const texto = await r.text();
    const dados = JSON.parse(texto);
    return JSON.stringify(dados).substring(0, 500);
  } catch (e) {
    return '';
  }
}

function dormir(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ====== rotas ======

app.get('/', (req, res) => {
  res.json({ status: 'ok', servico: 'gloria-backend' });
});

app.post('/chat', async (req, res) => {
  try {
    const { mensagem, ferramentasAtivas } = req.body || {};

    if (!mensagem || typeof mensagem !== 'string' || !mensagem.trim()) {
      return res.status(400).json({ erro: 'Campo "mensagem" obrigatório.' });
    }

    const texto = mensagem.trim();
    const usarFerramentas = ferramentasAtivas === true;

    console.log('Chat · ferramentas:', usarFerramentas);

    // 1ª chamada ao GPT-5 Nano
    const esperas = [0, 5000];
    let ultimo = null;
    let respostaGPT = null;

    for (let i = 0; i < esperas.length; i++) {
      if (esperas[i] > 0) await dormir(esperas[i]);
      const r = await chamarGPT5Nano(texto, usarFerramentas);
      ultimo = r;

      if (r.status === 429) continue;

      if (r.status >= 200 && r.status < 300) {
        try {
          const dados = JSON.parse(r.body);
          const conteudo = dados?.result || dados?.text;
          if (dados?.status && conteudo) {
            respostaGPT = conteudo;
            break;
          }
        } catch (e) { }
      }
    }

    if (!respostaGPT) {
      return res.status(502).json({
        erro: 'IA indisponível',
        detalhe: ultimo?.body?.substring(0, 200) || ''
      });
    }

    // 2. checa se a IA pediu uma ferramenta
    if (usarFerramentas) {
      const matchPesquisa = respostaGPT.match(/\[TOOL:pesquisa\]\s*(.+)/i);
      const matchPlacar = respostaGPT.match(/\[TOOL:placar\]\s*(.+)/i);

      let resultadoFerramenta = null;
      let nomeFerramenta = '';

      if (matchPesquisa) {
        nomeFerramenta = 'pesquisa';
        console.log('Chamando pesquisa:', matchPesquisa[1]);
        resultadoFerramenta = await pesquisarWeb(matchPesquisa[1].trim());
      } else if (matchPlacar) {
        nomeFerramenta = 'placar';
        console.log('Chamando placar:', matchPlacar[1]);
        resultadoFerramenta = await buscarPlacar(matchPlacar[1].trim());
      }

      if (resultadoFerramenta) {
        // manda resultado de volta pro GPT pra ele polir
        const textoComResultado =
          `Pergunta original do usuário: ${texto}\n\n` +
          `Resultado da ferramenta "${nomeFerramenta}":\n${resultadoFerramenta}\n\n` +
          `Agora responda ao usuário de forma natural e polida, sem mencionar que usou uma ferramenta.`;

        const r2 = await chamarGPT5Nano(textoComResultado, false);
        if (r2.status >= 200 && r2.status < 300) {
          try {
            const dados2 = JSON.parse(r2.body);
            const conteudo2 = dados2?.result || dados2?.text;
            if (dados2?.status && conteudo2) {
              return res.json({ resposta: conteudo2 });
            }
          } catch (e) { }
        }
        // se a 2ª chamada falhar, devolve o resultado cru
        return res.json({ resposta: resultadoFerramenta });
      }
    }

    return res.json({ resposta: respostaGPT });
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
