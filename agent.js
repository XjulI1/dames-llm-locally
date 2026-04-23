// Agent LLM enrichi : le modèle reçoit une analyse tactique pré-calculée
// (menaces, opportunités, top 5 des coups évalués à 1-ply) et ne doit plus
// que choisir parmi des options annotées + exprimer son raisonnement.
import ollama from 'ollama'
import { moveNotation, parseMove, renderBoard } from './engine.js'
import {
  rankMoves, detectThreats, detectOpportunities,
  countMaterial, gamePhase, evaluate,
} from './evaluator.js'
import { formatLessonsForPrompt } from './memory.js'

const PRINCIPLES = `PRINCIPES GÉNÉRAUX DES DAMES INTERNATIONALES :
- La prise est obligatoire et c'est la rafle la plus longue qui doit être jouée.
- Un pion avancé vaut plus : pousse tes pions vers la promotion quand c'est sûr.
- Garde tes pions de dernière rangée le plus longtemps possible : ils empêchent l'adversaire de promouvoir.
- Contrôle le centre : les cases centrales offrent plus de mobilité.
- Évite d'abandonner un pion sans compensation (rafle plus grosse, promotion, position gagnante).
- Les dames sont très puissantes (~3 pions) : les chasser ou les cloisonner.
- En finale avec dame contre pions : tu dois activement bloquer la promotion adverse.`

function systemPrompt(color) {
  const name = color === 'w' ? 'Blancs' : 'Noirs'
  const lessons = formatLessonsForPrompt(color)
  return `Tu es un joueur aguerri de dames internationales (règles FMJD, plateau 10×10).
Tu joues les ${name}. Tu raisonnes comme un joueur qui a des centaines de parties derrière lui.

${PRINCIPLES}

${lessons}

À chaque coup, une analyse tactique pré-calculée t'est fournie (menaces, opportunités, coups candidats évalués par recherche 1-coup-à-l'avance).
Tu dois :
1. Lire l'analyse.
2. Préférer les coups étiquetés "excellent" ou "solide", sauf si tu vois une raison tactique précise de jouer autre chose.
3. Répondre STRICTEMENT avec un JSON valide de la forme :
{"thinking": "<2-4 phrases de raisonnement>", "move": "<notation>", "confidence": "low|medium|high"}
Le champ "move" doit être EXACTEMENT l'une des notations listées dans "Coups légaux".`
}

function buildUserPrompt(state, legal, ranked, threats, opportunities, previousError = null) {
  const mat = countMaterial(state)
  const phase = gamePhase(state)
  const staticScore = evaluate(state)
  const color = state.turn
  const us = color === 'w' ? 'Blancs' : 'Noirs'

  const threatLines = threats.captures.length === 0
    ? 'Aucune menace directe contre tes pièces.'
    : `Si tu ne joues pas, l'adversaire peut capturer : ${threats.captures
        .map(c => moveNotation(c))
        .slice(0, 6)
        .join(', ')}${threats.captures.length > 6 ? '...' : ''}\n` +
      `Pièces tiennes menacées (cases) : ${threats.targets.join(', ')}\n` +
      `Rafle adverse max : ${threats.worst} pièce(s).`

  const oppLines = opportunities.captures.length === 0
    ? 'Aucune prise disponible ce tour (mais prise obligatoire si ton coup la crée pour l\'adversaire, attention).'
    : `Tu as ${opportunities.captures.length} coup(s) de prise disponible(s), rafle max ${opportunities.maxLen} pièce(s). ` +
      `(Rappel : la prise la plus longue est obligatoire.)`

  const candidates = ranked.slice(0, 6).map((r, i) => {
    const gain = r.immediateGain > 0 ? ` prend ${r.immediateGain}` : ''
    const reply = r.bestReply ? ` — meilleure riposte adverse : ${r.bestReply}${r.bestReplyCaptures ? ' (prend ' + r.bestReplyCaptures + ')' : ''}` : ''
    return `${i + 1}. ${r.notation.padEnd(16)}  [${r.verdict}]  score=${r.score > 0 ? '+' : ''}${r.score}${gain}${reply}`
  }).join('\n')

  const errBlock = previousError
    ? `\n[!] Ta dernière réponse était invalide : ${previousError}\nCorrige-toi et renvoie un JSON valide avec un coup de la liste.\n`
    : ''

  return `Position actuelle (phase : ${phase}) :
${renderBoard(state)}

MATÉRIEL : Blancs ${mat.wp}p + ${mat.wk}D   vs   Noirs ${mat.bp}p + ${mat.bk}D
ÉVALUATION STATIQUE : ${staticScore > 0 ? '+' : ''}${staticScore} (positif = avantage Blancs)

MENACES CONTRE TOI (${us}) :
${threatLines}

TES OPPORTUNITÉS :
${oppLines}

COUPS CANDIDATS PRÉ-ÉVALUÉS (meilleur en tête, recherche 1-ply) :
${candidates}

Coups légaux (liste complète) :
${legal.map(moveNotation).join(', ')}
${errBlock}
Choisis maintenant. Réponds uniquement avec le JSON requis.`
}

export async function chooseMove({ model, host, state, legal, color, retries = 3 }) {
  const client = host ? new ollama.Ollama({ host }) : ollama
  const ranked = rankMoves(state, legal)
  const threats = detectThreats(state)
  const opportunities = detectOpportunities(state)

  // Métadonnées pour le frontend / logs
  const analysis = {
    phase: gamePhase(state),
    staticScore: evaluate(state),
    topCandidates: ranked.slice(0, 5).map(r => ({
      notation: r.notation,
      score: r.score,
      verdict: r.verdict,
      immediateGain: r.immediateGain,
      bestReply: r.bestReply,
    })),
    threats: {
      count: threats.captures.length,
      worst: threats.worst,
      targets: threats.targets,
    },
    opportunities: {
      count: opportunities.captures.length,
      maxLen: opportunities.maxLen,
    },
  }

  let lastErr = null
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await client.chat({
        model,
        messages: [
          { role: 'system', content: systemPrompt(color) },
          { role: 'user', content: buildUserPrompt(state, legal, ranked, threats, opportunities, lastErr) },
        ],
        format: 'json',
        options: { temperature: 0.4 + attempt * 0.2 },
      })
      const raw = res.message?.content ?? ''
      const parsed = safeParse(raw)
      if (!parsed) { lastErr = 'JSON non parsable'; continue }
      if (typeof parsed.move !== 'string') { lastErr = 'champ "move" manquant ou non-string'; continue }
      const found = parseMove(parsed.move, legal)
      if (!found) {
        lastErr = `coup "${parsed.move}" absent de la liste légale`
        continue
      }
      return {
        move: found,
        notation: moveNotation(found),
        thinking: String(parsed.thinking || '').slice(0, 400),
        confidence: String(parsed.confidence || 'medium'),
        source: 'model',
        analysis,
      }
    } catch (err) {
      lastErr = err.message
      console.error(`[${model}] Ollama erreur (tentative ${attempt + 1}) :`, err.message)
    }
  }

  // Fallback : on prend le meilleur coup selon la recherche 1-ply (pas du random)
  const best = ranked[0]
  return {
    move: best.move,
    notation: best.notation,
    thinking: `(fallback évaluateur — le modèle n'a pas répondu correctement : ${lastErr})`,
    confidence: 'low',
    source: 'evaluator',
    analysis,
  }
}

// Demande au modèle de résumer ce qu'il a appris en fin de partie.
export async function postGameReflection({ model, host, color, result, history, finalState }) {
  const client = host ? new ollama.Ollama({ host }) : ollama
  const colorName = color === 'w' ? 'Blancs' : 'Noirs'
  const resultText = result === 'win' ? 'gagné' : result === 'loss' ? 'perdu' : 'fait nulle'

  const hist = history
    .filter(h => h.color === color)
    .slice(-20)
    .map(h => `${h.moveNumber}. ${h.notation} — ${h.thinking || ''}`)
    .join('\n')

  const prompt = `Tu viens de ${resultText} une partie de dames internationales avec les ${colorName}.
Voici tes derniers coups et pensées :
${hist}

Position finale :
${renderBoard(finalState)}

En une ou deux phrases (max 250 caractères), quelle leçon retiens-tu pour les prochaines parties ?
Réponds STRICTEMENT en JSON : {"lesson": "<ta leçon, concise et actionnable>"}`

  try {
    const res = await client.chat({
      model,
      messages: [{ role: 'user', content: prompt }],
      format: 'json',
      options: { temperature: 0.5 },
    })
    const parsed = safeParse(res.message?.content ?? '')
    if (parsed && typeof parsed.lesson === 'string' && parsed.lesson.trim()) {
      return parsed.lesson.trim().slice(0, 300)
    }
  } catch (e) {
    console.error(`[${model}] réflexion post-partie échouée :`, e.message)
  }
  return null
}

function safeParse(s) {
  if (!s) return null
  try { return JSON.parse(s) } catch {}
  const m = s.match(/\{[\s\S]*\}/)
  if (m) { try { return JSON.parse(m[0]) } catch {} }
  return null
}
