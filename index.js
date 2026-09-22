process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const express = require('express');

const app = express();
app.use(express.json({ limit: '25mb' }));

const PORT = process.env.PORT || 3000;
const ZONE_API_KEY = process.env.ZONE_API_KEY;
const SESSION_ID = 'gloria-v5';

if (!ZONE_API_KEY) {
  console.error('ERRO: ZONE_API_KEY não configurada.');
  process.exit(1);
}

const PROMPT_GLORIA =
  'Você é a GlorIA, assistente virtual feminina, amigável, direta e inteligente. ' +
  'Você É a GlorIA — nunca diga que é GPT, OpenAI, DeepSeek, Claude, Anthropic, Microsoft, Google ou qualquer outra IA. ' +
  'Se perguntarem quem te criou ou quem desenvolveu o app, diga que foi Joe Reis. ' +
  'NUNCA repita seu próprio nome nas respostas, EXCETO quando o usuário perguntar diretamente quem você é ou o seu nome. ' +
  'Você tem memória da conversa — lembre do que o usuário já disse antes. ' +
  'Sobre o app: o nome do app é GlorIA Chat um aplicativo pessoal do Joe Reis que faz duas coisas: (1) conversa com IA (você); (2) baixa vídeos e músicas do YouTube. ' +
  'Para baixar: usuário toca na aba YouTube, escolhe categoria, toca no vídeo e escolhe Baixar. ' +
  'Arquivos vão pra pasta GlorIA/Downloads do celular. Aparecem na aba Reproduzir. ' +
  'Nunca peça confirmações desnecessárias. Apenas responda. ' +
  'Nunca use certamente ou claro no começo da resposta. ' +
  'Mantenha respostas curtas quando a pergunta for simples. ' +
  'Responda em português do Brasil, com emojis quando fizer sentido. ' +
  'Se não souber algo com certeza, diga que não sabe em vez de inventar.';

const LEMBRETE =
  '[LEMBRETE INTERNO: Você é a GlorIA. Nunca mencione GPT, OpenAI, DeepSeek, Claude ou qualquer IA. ' +
  'Não repita seu nome a menos que perguntem diretamente. Se perguntarem quem te criou, diga Joe Reis.]';

function dormir(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function contarPalavras(texto) {
  return texto.trim().split(/\s+/).filter(p => p.length > 0).length;
}

function montarTexto(mensagem, historico) {
  let partes = [LEMBRETE];

  if (historico && historico.length > 0) {
    const ultimas = historico.slice(-10);
    const linhas = ultimas.map(h =>
      (h.de === 'user' ? 'Usuário' : 'GlorIA') + ': ' + h.texto
    ).join('\n');
    partes.push('[Histórico recente da conversa]\n' + linhas + '\n[Fim do histórico]');
  }

  partes.push(mensagem);
  return partes.join('\n\n');
}

function extrairConteudo(body) {
  try {
    const d = JSON.parse(body);
    if (d?.status) return d.result || d.text || null;
  } catch (e) { }
  return null;
}

async function chamarGPT4oMini(texto) {
  const url =
    `https://zone.api.br/api/ia/gpt-4o-mini` +
    `?apikey=${encodeURIComponent(ZONE_API_KEY)}` +
    `&text=${encodeURIComponent(texto)}` +
    `&prompt=${encodeURIComponent(PROMPT_GLORIA)}` +
    `&session=${encodeURIComponent(SESSION_ID)}`;

  const resposta = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36' }
  });
  const corpo = await resposta.text();
  return { status: resposta.status, body: corpo };
}

// ===== DeepSearch: parâmetro "q" =====
async function pesquisarWeb(termo) {
  const url =
    `https://zone.api.br/api/ia/deepsearch` +
    `?apikey=${encodeURIComponent(ZONE_API_KEY)}` +
    `&q=${encodeURIComponent(termo)}`;

  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36' }
    });
    const texto = await r.text();
    const dados = JSON.parse(texto);

    if (!dados?.status || !dados?.result) return '';

    let resultado = dados.result;
    if (resultado.length > 1500) {
      const metade = resultado.substring(0, 1500);
      const ultimoParagrafo = metade.lastIndexOf('\n\n');
      resultado = ultimoParagrafo > 500
        ? metade.substring(0, ultimoParagrafo)
        : metade;
      resultado += '\n\n[... resumo cortado pra economizar tokens]';
    }

    return resultado;
  } catch (e) {
    console.log('DeepSearch erro:', e.message);
    return '';
  }
}

// ===== Placar: parâmetro "search" =====
async function buscarPlacar(time) {
  const url =
    `https://zone.api.br/api/placar` +
    `?apikey=${encodeURIComponent(ZONE_API_KEY)}` +
    `&search=${encodeURIComponent(time)}`;

  try {
    const r = await fetch(url);
    const texto = await r.text();
    const dados = JSON.parse(texto);

    if (!dados?.status || !dados?.result) return '';

    const jogo = dados.result;
    const casa = jogo?.times?.casa || '?';
    const fora = jogo?.times?.fora || '?';
    const gc = jogo?.placar?.casa || '0';
    const gf = jogo?.placar?.fora || '0';
    const status = jogo?.status || '?';

    return `Placar: ${casa} ${gc} x ${gf} ${fora} — ${status}`;
  } catch (e) {
    console.log('Placar erro:', e.message);
    return '';
  }
}

async function gerarTTS(texto, voz) {
  const url =
    `https://zone.api.br/api/tts-edge` +
    `?apikey=${encodeURIComponent(ZONE_API_KEY)}` +
    `&text=${encodeURIComponent(texto)}` +
    `&voice=${encodeURIComponent(voz || 'pt-BR-FranciscaNeural')}`;

  const resposta = await fetch(url);
  const corpo = await resposta.text();
  return { status: resposta.status, body: corpo };
}

async function transcreverAudio(base64, formato) {
  const buffer = Buffer.from(base64, 'base64');
  const blob = new Blob([buffer], { type: 'audio/' + (formato || 'ogg') });

  const formData = new FormData();
  formData.append('audio', blob, 'audio.' + (formato || 'ogg'));

  const url = `https://zone.api.br/api/ia/transcrever-audio?apikey=${encodeURIComponent(ZONE_API_KEY)}`;
  const resposta = await fetch(url, { method: 'POST', body: formData });
  const corpo = await resposta.text();

  let dados = null;
  try { dados = JSON.parse(corpo); }
  catch (e) {
    const blocos = corpo.split(/\r?\n\r?\n+/);
    for (const bloco of blocos) {
      const linha = bloco.split('\n').find(l => l.trim().startsWith('data:'));
      if (!linha) continue;
      try { dados = JSON.parse(linha.replace(/^data:\s*/, '').trim()); } catch (e2) { }
    }
  }
  return { status: resposta.status, dados, corpo };
}

app.get('/', (req, res) => {
  res.json({ status: 'ok', servico: 'gloria-backend' });
});

app.post('/chat', async (req, res) => {
  try {
    const { mensagem, ferramentasAtivas, historico } = req.body || {};

    if (!mensagem || typeof mensagem !== 'string' || !mensagem.trim()) {
      return res.status(400).json({ erro: 'Campo mensagem obrigatório.' });
    }

    const texto = mensagem.trim();
    const textoComLembrete = montarTexto(texto, historico);
    const usarFerramentas = ferramentasAtivas === true;
    const palavras = contarPalavras(texto);
    const forcarPesquisa = usarFerramentas && palavras >= 3;

    console.log('Chat · ferramentas:', usarFerramentas, '· palavras:', palavras, '· pesquisar:', forcarPesquisa, '· histórico:', (historico || []).length);

    if (forcarPesquisa) {
      console.log('→ DeepSearch + Placar em paralelo');

      const [resultadoDeep, resultadoPlacar] = await Promise.all([
        pesquisarWeb(texto),
        buscarPlacar(texto)
      ]);

      const partes = [];
      if (resultadoDeep && resultadoDeep.length > 10) {
        partes.push('Pesquisa web:\n' + resultadoDeep);
      }
      if (resultadoPlacar && resultadoPlacar.length > 10) {
        partes.push('Dados de futebol:\n' + resultadoPlacar);
      }

      if (partes.length > 0) {
        const textoComResultado =
          LEMBRETE + '\n\n' +
          'Pergunta original: ' + texto + '\n\n' +
          partes.join('\n\n') + '\n\n' +
          'Responda ao usuário com base nas informações acima, de forma natural e polida, sem mencionar que usou ferramentas.';

        const r2 = await chamarGPT4oMini(textoComResultado);
        const c2 = extrairConteudo(r2.body);
        if (c2) return res.json({ resposta: c2 });

        return res.json({ resposta: partes.join('\n\n') });
      }
      console.log('→ Nenhuma ferramenta retornou nada útil');
    }

    const esperas = [0, 5000];
    let ultimo = null;
    let respostaGPT = null;

    for (let i = 0; i < esperas.length; i++) {
      if (esperas[i] > 0) await dormir(esperas[i]);
      const r = await chamarGPT4oMini(textoComLembrete);
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

    return res.json({ resposta: respostaGPT });
  } catch (erro) {
    console.error('Erro /chat:', erro);
    return res.status(500).json({ erro: 'Erro interno', detalhe: erro.message });
  }
});

app.post('/tts', async (req, res) => {
  try {
    const { texto, voz } = req.body || {};
    if (!texto || typeof texto !== 'string' || !texto.trim()) {
      return res.status(400).json({ erro: 'Campo texto obrigatório.' });
    }
    const r = await gerarTTS(texto.trim().substring(0, 500), voz);
    if (r.status !== 200) {
      return res.status(502).json({ erro: 'Zone retornou ' + r.status, detalhe: r.body.substring(0, 200) });
    }
    let dados;
    try { dados = JSON.parse(r.body); }
    catch (e) {
      return res.json({ audioBase64: Buffer.from(r.body).toString('base64'), tipo: 'audio/mpeg' });
    }
    const url = dados?.url || dados?.audio || dados?.result || dados?.audio_url;
    if (url) return res.json({ url: url });
    return res.status(502).json({ erro: 'TTS sem URL', detalhe: JSON.stringify(dados).substring(0, 200) });
  } catch (erro) {
    return res.status(500).json({ erro: 'Erro interno', detalhe: erro.message });
  }
});

app.post('/stt', async (req, res) => {
  try {
    const { audio, formato } = req.body || {};
    if (!audio || typeof audio !== 'string') {
      return res.status(400).json({ erro: 'Campo audio (base64) obrigatório.' });
    }
    const r = await transcreverAudio(audio, formato);
    if (r.status !== 200) {
      return res.status(502).json({ erro: 'Zone retornou ' + r.status, detalhe: r.corpo.substring(0, 200) });
    }
    if (!r.dados || !r.dados.text) {
      return res.status(502).json({ erro: 'STT sem texto', detalhe: JSON.stringify(r.dados).substring(0, 200) });
    }
    return res.json({ texto: r.dados.text });
  } catch (erro) {
    return res.status(500).json({ erro: 'Erro interno', detalhe: erro.message });
  }
});

app.listen(PORT, () => {
  console.log(`gloria-backend rodando na porta ${PORT}`);
});
