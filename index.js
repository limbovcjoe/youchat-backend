process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const express = require('express');

const app = express();
app.use(express.json({ limit: '25mb' }));

const PORT = process.env.PORT || 3000;
const ZONE_API_KEY = process.env.ZONE_API_KEY;

if (!ZONE_API_KEY) {
  console.error('ERRO: ZONE_API_KEY não configurada.');
  process.exit(1);
}

// ================================================================
// PROMPT
// ================================================================

const PROMPT_GLORIA =
  'Você é a GlorIA, uma assistente virtual feminina, amigável, direta e inteligente. ' +
  'Você é mulher — use sempre adjetivos e concordâncias no feminino quando falar de si mesma. ' +
  'Você É a GlorIA — nunca diga que é GPT, OpenAI, DeepSeek, Claude, Anthropic, Microsoft, Google ou qualquer outra IA. ' +
  'Se perguntarem quem te criou ou quem desenvolveu o app, diga que foi Joe Reis. ' +
  'NUNCA repita seu próprio nome nas respostas, EXCETO quando o usuário perguntar diretamente quem você é ou o seu nome. ' +
  'Você tem memória da conversa — lembre do que o usuário já disse antes. ' +
  'Sobre o app: aplicativo pessoal do Joe Reis que faz duas coisas: (1) conversa com IA (você); (2) baixa vídeos e músicas do YouTube. ' +
  'Para baixar: usuário toca na aba YouTube, escolhe categoria, toca no vídeo e escolhe Baixar. ' +
  'Arquivos vão pra pasta GlorIA/Downloads do celular. Aparecem na aba Reproduzir. ' +
  'Nunca peça confirmações desnecessárias. Apenas responda. ' +
  'Nunca use certamente ou claro no começo da resposta. ' +
  'Mantenha respostas curtas quando a pergunta for simples. ' +
  'Responda em português do Brasil, com emojis quando fizer sentido. ' +
  'Se não souber algo com certeza, diga que não sabe em vez de inventar. ' +
  'FORMATAÇÃO: use markdown quando fizer sentido. Em TABELAS, use | col | col |, com separador |---|---|, sem linhas em branco no meio.';

const LEMBRETE =
  '[LEMBRETE INTERNO: Você é a GlorIA. Nunca mencione GPT, OpenAI, DeepSeek, Claude ou qualquer IA. ' +
  'Não repita seu nome a menos que perguntem diretamente. Se perguntarem quem te criou, diga Joe Reis.]';

// ================================================================
// HELPERS
// ================================================================

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

async function fetchJson(url, timeout = 10000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const r = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36' }
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    console.log('fetchJson erro:', e.message);
    return null;
  }
}

// ================================================================
// IA
// ================================================================

async function chamarGPT4oMini(texto, sessionId) {
  const url =
    `https://zone.api.br/api/ia/gpt-4o-mini` +
    `?apikey=${encodeURIComponent(ZONE_API_KEY)}` +
    `&text=${encodeURIComponent(texto)}` +
    `&prompt=${encodeURIComponent(PROMPT_GLORIA)}` +
    `&session=${encodeURIComponent(sessionId)}`;

  const resposta = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36' }
  });
  const corpo = await resposta.text();
  return { status: resposta.status, body: corpo };
}
// ================================================================
// FERRAMENTAS ZONE
// ================================================================

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
      resultado += '\n\n[... resumo cortado]';
    }
    return resultado;
  } catch (e) {
    console.log('DeepSearch erro:', e.message);
    return '';
  }
}

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
    `https://zone.api.br/api/v2/tts3` +
    `?apikey=${encodeURIComponent(ZONE_API_KEY)}` +
    `&text=${encodeURIComponent(texto)}` +
    `&voice=${encodeURIComponent(voz || 'girl5')}`;

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

// ================================================================
// GERADOR E EDITOR DE IMAGEM (Zone)
// ================================================================

async function gerarImagem(prompt) {
  try {
    console.log('Gerando imagem:', prompt);

    // 1. criar job
    const criarResp = await fetch(
      `https://zone.api.br/api/v2/nanobanana2-texto?apikey=${encodeURIComponent(ZONE_API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt, aspect_ratio: '1:1' })
      }
    );
    const criarDados = await criarResp.json();
    const jobId = criarDados?.job_id;
    if (!jobId) {
      console.log('Imagem sem job_id:', JSON.stringify(criarDados).substring(0, 200));
      return null;
    }

    // 2. polling (até 60s)
    for (let i = 0; i < 15; i++) {
      await dormir(4000);
      const statusResp = await fetch(
        `https://zone.api.br/api/v1/nanobanana2/status?apikey=${encodeURIComponent(ZONE_API_KEY)}&job_id=${jobId}`
      );
      const statusDados = await statusResp.json();

      if (statusDados?.estado === 'done') {
        const url = statusDados?.result_url;
        if (url) return url.replace('http://', 'https://');
      }
      if (statusDados?.estado === 'failed' || statusDados?.estado === 'error') {
        console.log('Imagem falhou');
        return null;
      }
    }
    console.log('Imagem timeout');
    return null;
  } catch (e) {
    console.log('Erro gerarImagem:', e.message);
    return null;
  }
}

async function editarImagem(prompt, base64Imagem) {
  try {
    console.log('Editando imagem:', prompt);

    const buffer = Buffer.from(base64Imagem, 'base64');
    const formData = new FormData();
    formData.append('prompt', prompt);
    formData.append('image', new Blob([buffer]), 'imagem.png');

    const resp = await fetch(
      `https://zone.api.br/api/v2/qwen-edit?apikey=${encodeURIComponent(ZONE_API_KEY)}`,
      { method: 'POST', body: formData }
    );
    const dados = await resp.json();

    if (dados?.status && dados?.imagem) {
      return dados.imagem.replace('http://', 'https://');
    }
    console.log('Editar imagem sem resultado:', JSON.stringify(dados).substring(0, 200));
    return null;
  } catch (e) {
    console.log('Erro editarImagem:', e.message);
    return null;
  }
}

// ================================================================
// FERRAMENTAS PÚBLICAS (sem chave)
// ================================================================

async function buscarHora(cidade) {
  try {
    const geo = await fetchJson(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cidade)}&count=1&language=pt`
    );
    if (!geo?.results?.length) return null;
    const { timezone, name, country } = geo.results[0];

    const hora = await fetchJson(`https://timeapi.io/api/Time/current/zone?timeZone=${timezone}`);
    if (!hora) return null;

    const hh = String(hora.hour).padStart(2, '0');
    const mm = String(hora.minute).padStart(2, '0');
    return `${name}, ${country} — ${hh}:${mm} (${timezone}) — ${hora.day}/${hora.month}/${hora.year}`;
  } catch (e) {
    console.log('Hora erro:', e.message);
    return null;
  }
}

async function buscarClima(cidade) {
  try {
    const geo = await fetchJson(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cidade)}&count=1&language=pt`
    );
    if (!geo?.results?.length) return null;
    const { latitude, longitude, name, country } = geo.results[0];

    const clima = await fetchJson(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&timezone=auto`
    );
    if (!clima?.current_weather) return null;

    const cw = clima.current_weather;
    const codigos = {
      0: 'Céu limpo', 1: 'Poucas nuvens', 2: 'Parcialmente nublado', 3: 'Nublado',
      45: 'Névoa', 48: 'Névoa', 51: 'Garoa leve', 53: 'Garoa', 55: 'Garoa forte',
      61: 'Chuva leve', 63: 'Chuva', 65: 'Chuva forte', 71: 'Neve leve', 73: 'Neve',
      75: 'Neve forte', 80: 'Pancadas', 81: 'Pancadas', 82: 'Pancadas fortes',
      95: 'Tempestade', 96: 'Tempestade com granizo', 99: 'Tempestade forte'
    };
    const desc = codigos[cw.weathercode] || 'tempo indefinido';

    return `${name}, ${country} — ${desc}, ${cw.temperature}°C, vento ${cw.windspeed} km/h`;
  } catch (e) {
    console.log('Clima erro:', e.message);
    return null;
  }
}

async function buscarCotacao(moeda) {
  try {
    const codigos = {
      'dolar': 'USD', 'dólar': 'USD', 'euro': 'EUR',
      'libra': 'GBP', 'iene': 'JPY', 'yuan': 'CNY',
      'peso': 'ARS', 'real': 'BRL'
    };
    const chave = moeda.toLowerCase();
    const de = codigos[chave] || 'USD';

    const dados = await fetchJson(
      `https://api.frankfurter.dev/v1/latest?base=${de}&symbols=BRL`
    );
    if (!dados?.rates?.BRL) return null;

    return `1 ${de} = R$ ${dados.rates.BRL.toFixed(2)} (${dados.date})`;
  } catch (e) {
    console.log('Cotação erro:', e.message);
    return null;
  }
}

async function buscarCripto(moeda) {
  try {
    const mapa = {
      'bitcoin': 'bitcoin', 'btc': 'bitcoin',
      'ethereum': 'ethereum', 'eth': 'ethereum',
      'solana': 'solana', 'sol': 'solana',
      'dogecoin': 'dogecoin', 'doge': 'dogecoin',
      'cardano': 'cardano', 'ada': 'cardano',
      'ripple': 'ripple', 'xrp': 'ripple'
    };
    const chave = mapa[moeda.toLowerCase()] || 'bitcoin';

    const dados = await fetchJson(
      `https://api.coingecko.com/api/v3/simple/price?ids=${chave}&vs_currencies=brl,usd&include_24hr_change=true`
    );
    if (!dados?.[chave]) return null;

    const d = dados[chave];
    const var24 = d.brl_24h_change != null ? d.brl_24h_change.toFixed(2) : '0';
    return `${chave.toUpperCase()}: R$ ${d.brl.toLocaleString('pt-BR')} (US$ ${d.usd}) — 24h: ${var24}%`;
  } catch (e) {
    console.log('Cripto erro:', e.message);
    return null;
  }
}

async function buscarNoticias(termo) {
  try {
    const dados = await fetchJson(
      `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(termo)}&mode=artlist&maxrecords=5&format=json&sort=datedesc`
    );
    if (!dados?.articles?.length) return null;

    const linhas = dados.articles.slice(0, 5).map(a =>
      `• ${a.title} (${a.domain})`
    ).join('\n');
    return `Últimas notícias sobre "${termo}":\n${linhas}`;
  } catch (e) {
    console.log('Notícias erro:', e.message);
    return null;
  }
}

async function traduzir(texto, de, para) {
  try {
    const r = await fetch('https://libretranslate.com/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: texto,
        source: de || 'auto',
        target: para || 'pt',
        format: 'text'
      })
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d?.translatedText || null;
  } catch (e) {
    console.log('Tradução erro:', e.message);
    return null;
  }
}

// ================================================================
// POKÉMON com imagem
// ================================================================

async function buscarPokemon(nome) {
  try {
    const limpo = nome.toLowerCase().trim().replace(/\s+/g, '-');
    const dados = await fetchJson(`https://pokeapi.co/api/v2/pokemon/${limpo}`);
    if (!dados) return null;

    const tipos = dados.types.map(t => t.type.name).join(' / ');
    const altura = (dados.height / 10).toFixed(1);
    const peso = (dados.weight / 10).toFixed(1);
    const id = dados.id;
    const imagem = dados.sprites?.other?.['official-artwork']?.front_default
      || dados.sprites?.front_default;

    return {
      texto: `#${id} ${dados.name} — Tipo: ${tipos} | Altura: ${altura}m | Peso: ${peso}kg`,
      imagem: imagem
    };
  } catch (e) {
    console.log('Pokémon erro:', e.message);
    return null;
  }
}

// ================================================================
// PESQUISA DE IMAGEM (opcional)
// ================================================================

async function buscarImagem(termo) {
  try {
    // usa o endpoint da Zone pra buscar imagem
    const url = `https://zone.api.br/api/search/gimage?apikey=${encodeURIComponent(ZONE_API_KEY)}&q=${encodeURIComponent(termo)}`;
    const dados = await fetchJson(url);
    if (!dados) return null;

    // estrutura pode variar; tenta pegar a primeira imagem
    const lista = dados?.result || dados?.images || dados?.data;
    if (Array.isArray(lista) && lista.length > 0) {
      const primeira = lista[0];
      return typeof primeira === 'string' ? primeira : (primeira?.url || primeira?.image);
    }
    return null;
  } catch (e) {
    console.log('Busca imagem erro:', e.message);
    return null;
  }
        }
// ================================================================
// DETECTOR DE INTENÇÃO
// ================================================================

function detectarFerramenta(texto) {
  const t = texto.toLowerCase();

  // ===== GERAR IMAGEM =====
  const matchGerarImg = t.match(/(?:gera|cria|desenha|faz|manda)\s+(?:uma\s+)?(?:imagem|foto|desenho|figura)\s+(?:de\s+|do\s+|da\s+)?(.+)/i);
  if (matchGerarImg) return { tipo: 'gerar_imagem', arg: matchGerarImg[1].trim() };

  const matchImg2 = t.match(/^(?:imagem|desenho|foto)\s+(?:de\s+|do\s+|da\s+)(.+)/i);
  if (matchImg2) return { tipo: 'gerar_imagem', arg: matchImg2[1].trim() };

  // ===== BUSCAR IMAGEM (não gerar, só procurar) =====
  const matchBuscarImg = t.match(/(?:busca|procura|pesquisa|acha)\s+(?:uma\s+)?(?:imagem|foto|desenho)\s+(?:de\s+|do\s+|da\s+)?(.+)/i);
  if (matchBuscarImg) return { tipo: 'buscar_imagem', arg: matchBuscarImg[1].trim() };

  // ===== TRADUZIR =====
  const matchTrad = t.match(/traduz(?:ir)?\s+(?:para\s+(\w+)\s+)?[":]?\s*(.+)/i);
  if (matchTrad) {
    return { tipo: 'traduzir', arg: matchTrad[2].trim(), lang: matchTrad[1] };
  }

  // ===== HORA =====
  const matchHora = t.match(/que horas (?:s[ãa]o|é) (?:em|no|na|de)\s+([a-záàâãéêíóôõúç\s]+)/i);
  if (matchHora) return { tipo: 'hora', arg: matchHora[1].trim() };

  // ===== CLIMA =====
  const matchClima = t.match(/(?:clima|tempo|temperatura)\s+(?:em|no|na|de)\s+([a-záàâãéêíóôõúç\s]+)/i);
  if (matchClima) return { tipo: 'clima', arg: matchClima[1].trim() };

  // ===== CRIPTO =====
  const matchCripto = t.match(/(?:pre[çc]o|cota[çc][ãa]o|valor)\s+(?:do|da|de)\s+(bitcoin|btc|ethereum|eth|solana|sol|dogecoin|doge|cardano|ada|ripple|xrp)/i);
  if (matchCripto) return { tipo: 'cripto', arg: matchCripto[1] };

  if (/(?:bitcoin|btc|ethereum|solana|dogecoin|cripto)/i.test(t) && /(?:pre[çc]o|cota|valor|quanto)/i.test(t)) {
    const m = t.match(/(bitcoin|btc|ethereum|eth|solana|sol|dogecoin|doge|cardano|ada|ripple|xrp)/i);
    if (m) return { tipo: 'cripto', arg: m[1] };
  }

  // ===== COTAÇÃO FIDUCIÁRIA =====
  const matchCot = t.match(/(?:cota[çc][ãa]o|valor|pre[çc]o)\s+(?:do|da)\s+(d[óo]lar|euro|libra|iene|yuan|peso)/i);
  if (matchCot) return { tipo: 'cotacao', arg: matchCot[1] };

  // ===== NOTÍCIAS =====
  const matchNot = t.match(/(?:not[íi]cias|novidades)\s+(?:sobre|de|do|da)\s+([a-záàâãéêíóôõúç0-9\s]+)/i);
  if (matchNot) return { tipo: 'noticias', arg: matchNot[1].trim() };

  // ===== POKÉMON =====
  const matchPoke = t.match(/pok[eé]mon\s+([a-záàâãéêíóôõúç\s]+)/i);
  if (matchPoke) {
    const nome = matchPoke[1].trim().split(/\s+/)[0];
    if (nome.length >= 3) return { tipo: 'pokemon', arg: nome };
  }
  // se for 1 palavra isolada (até 15 chars), tenta pokémon
  if (contarPalavras(texto) === 1 && t.length <= 15 && /^[a-záàâãéêíóôõúç]{3,15}$/i.test(texto.trim())) {
    return { tipo: 'pokemon', arg: texto.trim() };
  }

  // ===== PLACAR =====
  const matchPlacar = t.match(/(?:jogo|resultado|placar)\s+(?:do|da|de)\s+([a-záàâãéêíóôõúç\s]+)/i);
  if (matchPlacar) return { tipo: 'placar', arg: matchPlacar[1].trim() };

  return null;
}

// ================================================================
// EXECUTA A FERRAMENTA
// ================================================================

async function executarFerramenta(ferramenta) {
  try {
    switch (ferramenta.tipo) {
      case 'gerar_imagem': {
        const url = await gerarImagem(ferramenta.arg);
        if (url) {
          return {
            texto: `Aqui está a imagem que você pediu! 🎨`,
            imagem: url
          };
        }
        return { texto: 'Não consegui gerar a imagem agora. Tenta de novo em alguns segundos.', imagem: null };
      }

      case 'buscar_imagem': {
        const url = await buscarImagem(ferramenta.arg);
        if (url) {
          return {
            texto: `Encontrei essa imagem de "${ferramenta.arg}" pra você! 📸`,
            imagem: url
          };
        }
        return { texto: 'Não encontrei imagem sobre isso.', imagem: null };
      }

      case 'traduzir': {
        const texto = await traduzir(ferramenta.arg, 'auto', ferramenta.lang || 'pt');
        if (texto) return { texto: `Tradução: ${texto}`, imagem: null };
        return { texto: 'Não consegui traduzir agora.', imagem: null };
      }

      case 'hora': {
        const r = await buscarHora(ferramenta.arg);
        if (r) return { texto: r, imagem: null };
        return null;
      }

      case 'clima': {
        const r = await buscarClima(ferramenta.arg);
        if (r) return { texto: r, imagem: null };
        return null;
      }

      case 'cotacao': {
        const r = await buscarCotacao(ferramenta.arg);
        if (r) return { texto: r, imagem: null };
        return null;
      }

      case 'cripto': {
        const r = await buscarCripto(ferramenta.arg);
        if (r) return { texto: r, imagem: null };
        return null;
      }

      case 'noticias': {
        const r = await buscarNoticias(ferramenta.arg);
        if (r) return { texto: r, imagem: null };
        return null;
      }

      case 'pokemon': {
        const r = await buscarPokemon(ferramenta.arg);
        if (r) return { texto: r.texto, imagem: r.imagem };
        return null;
      }

      case 'placar': {
        const r = await buscarPlacar(ferramenta.arg);
        if (r) return { texto: r, imagem: null };
        return null;
      }

      default:
        return null;
    }
  } catch (e) {
    console.log('Erro executarFerramenta:', e.message);
    return null;
  }
}

// ================================================================
// ROTAS
// ================================================================

app.get('/', (req, res) => {
  res.json({ status: 'ok', servico: 'gloria-backend' });
});

app.post('/chat', async (req, res) => {
  try {
    const { mensagem, ferramentasAtivas, historico, chatId } = req.body || {};

    if (!mensagem || typeof mensagem !== 'string' || !mensagem.trim()) {
      return res.status(400).json({ erro: 'Campo mensagem obrigatório.' });
    }

    const texto = mensagem.trim();
    const sessionId = (chatId && typeof chatId === 'string' && chatId.length > 0)
      ? 'gloria-' + chatId
      : 'gloria-default';

    // ===== 1. TENTA DETECTAR FERRAMENTA =====
    const ferramenta = detectarFerramenta(texto);

    if (ferramenta) {
      console.log('Ferramenta detectada:', ferramenta.tipo, '·', ferramenta.arg);

      const resultado = await executarFerramenta(ferramenta);

      if (resultado) {
        // Se for imagem, devolve direto sem passar por IA
        if (resultado.imagem && !resultado.texto.includes('Não consegui')) {
          return res.json({
            resposta: resultado.texto,
            imagem: resultado.imagem
          });
        }

        // Senão, deixa IA formatar
        const textoComResultado =
          LEMBRETE + '\n\n' +
          'Pergunta original: ' + texto + '\n\n' +
          'Informação obtida:\n' + resultado.texto + '\n\n' +
          'Responda ao usuário de forma natural e amigável com base nessa informação. ' +
          'Não mencione "ferramenta", "API" ou "sistema". Apenas responda.';

        const r2 = await chamarGPT4oMini(textoComResultado, sessionId);
        const c2 = extrairConteudo(r2.body);
        if (c2) return res.json({ resposta: c2, imagem: resultado.imagem || null });

        return res.json({ resposta: resultado.texto, imagem: resultado.imagem || null });
      }
    }

    // ===== 2. FLUXO NORMAL =====
    const textoComLembrete = montarTexto(texto, historico);
    const usarFerramentas = ferramentasAtivas === true;
    const palavras = contarPalavras(texto);
    const forcarPesquisa = usarFerramentas && palavras >= 3;

    if (forcarPesquisa) {
      console.log('→ DeepSearch forçado');

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
          'Responda de forma natural e polida, sem mencionar ferramentas.';

        const r2 = await chamarGPT4oMini(textoComResultado, sessionId);
        const c2 = extrairConteudo(r2.body);
        if (c2) return res.json({ resposta: c2, imagem: null });

        return res.json({ resposta: partes.join('\n\n'), imagem: null });
      }
    }

    // IA padrão
    const esperas = [0, 5000];
    let ultimo = null;
    let respostaGPT = null;

    for (let i = 0; i < esperas.length; i++) {
      if (esperas[i] > 0) await dormir(esperas[i]);
      const r = await chamarGPT4oMini(textoComLembrete, sessionId);
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

    return res.json({ resposta: respostaGPT, imagem: null });
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

    const url = dados?.audio_url || dados?.url || dados?.audio || dados?.result;
    if (url) return res.json({ url: url });

    return res.status(502).json({ erro: 'TTS sem URL', detalhe: JSON.stringify(dados).substring(0, 200) });
  } catch (erro) {
    console.error('Erro /tts:', erro);
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
