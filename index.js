process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const express = require('express');

const app = express();
app.use(express.json({ limit: '25mb' }));

const PORT = process.env.PORT || 3000;
const ZONE_API_KEY = process.env.ZONE_API_KEY;
const SESSION_ID = 'gloria-v4';

if (!ZONE_API_KEY) {
  console.error('ERRO: ZONE_API_KEY não configurada.');
  process.exit(1);
}

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
  'Não se apresente repetidamente. você tem memória ativada e pode usar várias outras ferramentas de ia' +
  'Nunca use "certamente" ou "claro" no começo da resposta. ' +
  'Mantenha respostas curtas quando a pergunta for simples. ' +
  'Responda em português do Brasil, com emojis quando fizer sentido. ' +
  'Se não souber algo com certeza, diga que não sabe em vez de inventar.';

const FERRAMENTAS_INFO =
  '\n\nVocê tem acesso a FERRAMENTAS. Use APENAS quando necessário:\n' +
  '[TOOL:pesquisa] <termo>  — para buscar informação atual na web\n' +
  '[TOOL:placar] <time>  — para resultados de futebol\n' +
  '\nSe precisar de uma ferramenta, responda EXATAMENTE no formato acima. ' +
  'Se não precisar, responda a pergunta normalmente.';

const PROMPT_COM_FERRAMENTAS = PROMPT_GLORIA + FERRAMENTAS_INFO;

// ===== helpers =====

function dormir(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function contarPalavras(texto) {
  return texto.trim().split(/\s+/).filter(p => p.length > 0).length;
}

// ===== IA =====

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

function extrairConteudo(body) {
  try {
    const d = JSON.parse(body);
    if (d?.status) return d.result || d.text || null;
  } catch (e) { }
  return null;
}

async function pesquisarWeb(termo) {
  const url =
    `https://zone.api.br/api/ia/gpt-5-nano` +
    `?apikey=${encodeURIComponent(ZONE_API_KEY)}` +
    `&text=${encodeURIComponent('Pesquise na web e responda: ' + termo)}` +
    `&prompt=${encodeURIComponent('Pesquise na web e responda de forma factual.')}` +
    `&search=1`;
  try {
    const r = await fetch(url);
    const texto = await r.text();
    const dados = JSON.parse(texto);
    return dados?.result || dados?.text || '';
  } catch (e) { return ''; }
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
  } catch (e) { return ''; }
}

// ===== TTS =====

async function gerarTTS(texto, voz) {
  const url =
    `https://zone.api.br/api/tts-edge` +
    `?apikey=${encodeURIComponent(ZONE_API_KEY)}` +
    `&text=${encodeURIComponent(texto)}` +
    `&voice=${encodeURIComponent(voz || 'pt-BR-FranciscaNeural')}`;

  const resposta = await fetch(url);
  const corpo = await resposta.text();
  return { status: resposta.status, body: corpo, contentType: resposta.headers.get('content-type') || '' };
}

// ===== STT =====

async function transcreverAudio(base64, formato) {
  const buffer = Buffer.from(base64, 'base64');
  const blob = new Blob([buffer], { type: 'audio/' + (formato || 'ogg') });

  const formData = new FormData();
  formData.append('audio', blob, 'audio.' + (formato || 'ogg'));

  const url = `https://zone.api.br/api/ia/transcrever-audio?apikey=${encodeURIComponent(ZONE_API_KEY)}`;

  const resposta = await fetch(url, {
    method: 'POST',
    body: formData
  });

  const corpo = await resposta.text();

  // resposta pode vir como SSE (event-stream); pega o último JSON
  let dados = null;
  try {
    dados = JSON.parse(corpo);
  } catch (e) {
    const blocos = corpo.split(/\r?\n\r?\n+/);
    for (const bloco of blocos) {
      const linha = bloco.split('\n').find(l => l.trim().startsWith('data:'));
      if (!linha) continue;
      try {
        dados = JSON.parse(linha.replace(/^data:\s*/, '').trim());
      } catch (e2) { }
    }
  }

  return { status: resposta.status, dados, corpo };
}

// ===== rotas =====

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

    // === HÍBRIDO ===
    // se botão ON e pergunta tem 5+ palavras, pesquisa direto
    const palavras = contarPalavras(texto);
    const forcarPesquisa = usarFerramentas && palavras >= 5;

    console.log('Chat · ferramentas:', usarFerramentas, '· palavras:', palavras, '· forçar:', forcarPesquisa);

    if (forcarPesquisa) {
      console.log('→ Pesquisa forçada');
      const resultado = await pesquisarWeb(texto);
      if (resultado) {
        const textoComResultado =
          `Pergunta original: ${texto}\n\n` +
          `Resultado da pesquisa na web:\n${resultado}\n\n` +
          `Agora responda ao usuário com base nas informações acima, de forma natural e polida, sem mencionar que usou pesquisa.`;

        const r2 = await chamarGPT5Nano(textoComResultado, false);
        const c2 = extrairConteudo(r2.body);
        if (c2) return res.json({ resposta: c2 });
        return res.json({ resposta: resultado });
      }
      // se a pesquisa falhar, segue fluxo normal
    }

    // === FLUXO NORMAL ===
    const esperas = [0, 5000];
    let ultimo = null;
    let respostaGPT = null;

    for (let i = 0; i < esperas.length; i++) {
      if (esperas[i] > 0) await dormir(esperas[i]);
      const r = await chamarGPT5Nano(texto, usarFerramentas);
      ultimo = r;
      if (r.status === 429) continue;
      const c = extrairConteudo(r.body);
      if (c) { respostaGPT = c; break; }
    }

    if (!respostaGPT) {
      return res.status(502).json({
        erro: 'IA indisponível',
        detalhe: ultimo?.body?.substring(0, 200) || ''
      });
    }

    // tool calling (só pra perguntas curtas com botão ON)
    if (usarFerramentas) {
      const matchPesquisa = respostaGPT.match(/\[TOOL:pesquisa\]\s*(.+)/i);
      const matchPlacar = respostaGPT.match(/\[TOOL:placar\]\s*(.+)/i);

      let resultadoFerramenta = null;
      let nomeFerramenta = '';

      if (matchPesquisa) {
        nomeFerramenta = 'pesquisa';
        resultadoFerramenta = await pesquisarWeb(matchPesquisa[1].trim());
      } else if (matchPlacar) {
        nomeFerramenta = 'placar';
        resultadoFerramenta = await buscarPlacar(matchPlacar[1].trim());
      }

      if (resultadoFerramenta) {
        const textoComResultado =
          `Pergunta original: ${texto}\n\n` +
          `Resultado da ferramenta "${nomeFerramenta}":\n${resultadoFerramenta}\n\n` +
          `Responda ao usuário de forma natural, sem mencionar ferramenta.`;
        const r2 = await chamarGPT5Nano(textoComResultado, false);
        const c2 = extrairConteudo(r2.body);
        if (c2) return res.json({ resposta: c2 });
        return res.json({ resposta: resultadoFerramenta });
      }
    }

    return res.json({ resposta: respostaGPT });
  } catch (erro) {
    console.error('Erro /chat:', erro);
    return res.status(500).json({ erro: 'Erro interno', detalhe: erro.message });
  }
});

// ===== TTS: texto → URL do áudio =====
app.post('/tts', async (req, res) => {
  try {
    const { texto, voz } = req.body || {};

    if (!texto || typeof texto !== 'string' || !texto.trim()) {
      return res.status(400).json({ erro: 'Campo "texto" obrigatório.' });
    }

    console.log('TTS:', texto.substring(0, 50));

    const r = await gerarTTS(texto.trim().substring(0, 500), voz);

    if (r.status !== 200) {
      return res.status(502).json({
        erro: `Zone retornou ${r.status}`,
        detalhe: r.body.substring(0, 200)
      });
    }

    let dados;
    try {
      dados = JSON.parse(r.body);
    } catch (e) {
      // se veio áudio direto, devolve o conteúdo bruto como base64
      return res.json({ audioBase64: Buffer.from(r.body).toString('base64'), tipo: 'audio/mpeg' });
    }

    const url = dados?.url || dados?.audio || dados?.result || dados?.audio_url;
    if (url) return res.json({ url: url });

    return res.status(502).json({
      erro: 'TTS sem URL',
      detalhe: JSON.stringify(dados).substring(0, 200)
    });
  } catch (erro) {
    console.error('Erro /tts:', erro);
    return res.status(500).json({ erro: 'Erro interno', detalhe: erro.message });
  }
});

// ===== STT: áudio → texto =====
app.post('/stt', async (req, res) => {
  try {
    const { audio, formato } = req.body || {};

    if (!audio || typeof audio !== 'string') {
      return res.status(400).json({ erro: 'Campo "audio" (base64) obrigatório.' });
    }

    console.log('STT · formato:', formato || 'ogg', '· bytes:', Math.floor(audio.length * 0.75));

    const r = await transcreverAudio(audio, formato);

    if (r.status !== 200) {
      return res.status(502).json({
        erro: `Zone retornou ${r.status}`,
        detalhe: r.corpo.substring(0, 200)
      });
    }

    if (!r.dados || !r.dados.text) {
      return res.status(502).json({
        erro: 'STT sem texto',
        detalhe: JSON.stringify(r.dados).substring(0, 200)
      });
    }

    return res.json({ texto: r.dados.text });
  } catch (erro) {
    console.error('Erro /stt:', erro);
    return res.status(500).json({ erro: 'Erro interno', detalhe: erro.message });
  }
});

app.listen(PORT, () => {
  console.log(`gloria-backend rodando na porta ${PORT}`);
});
