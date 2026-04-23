// Wrapper Ollama : demande au modèle un coup légal, avec retries.
import ollama from 'ollama'
import { moveNotation, parseMove, renderBoard } from './engine.js'

const SYSTEM_PROMPT = (color) => `Tu joues aux dames internationales (variante FMJD, plateau 10x10).
Tu incarnes les ${color === 'w' ? 'Blancs (pions o, dames O)' : 'Noirs (pions x, dames X)'}.
Règles rapides :
- Les pions avancent d'une case en diagonale vers le camp adverse.
- Les pions peuvent capturer en sautant par-dessus une pièce adverse (en avant OU en arrière) pour atterrir sur la case suivante vide.
- Les dames se déplacent de n'importe quelle distance en diagonale, et capturent à distance (dames volantes).
- La prise est obligatoire, et c'est toujours la rafle la plus longue qui doit être jouée.
- Un pion atteignant la dernière rangée devient dame.

Tu dois répondre STRICTEMENT avec un JSON valide de la forme :
{"move": "<notation>", "reasoning": "<une phrase brève>"}
La notation doit être EXACTEMENT l'une des notations fournies dans la liste des coups légaux.`

function buildPrompt(state, legal) {
  const moveList = legal.map(m => moveNotation(m))
  return `Voici le plateau actuel (o = pion blanc, O = dame blanche, x = pion noir, X = dame noire) :

${renderBoard(state)}

Coups légaux disponibles (notation FMJD) :
${moveList.join(', ')}

Choisis UN coup dans cette liste. Réponds uniquement avec le JSON demandé.`
}

export async function chooseMove({ model, host, state, legal, color, retries = 3 }) {
  const moveStrs = legal.map(m => moveNotation(m))
  const client = host ? new ollama.Ollama({ host }) : ollama

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await client.chat({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT(color) },
          { role: 'user', content: buildPrompt(state, legal) },
        ],
        format: 'json',
        options: { temperature: 0.6 + attempt * 0.2 },
      })
      const raw = res.message?.content ?? ''
      const parsed = safeParse(raw)
      if (parsed && typeof parsed.move === 'string') {
        const found = parseMove(parsed.move, legal)
        if (found) {
          return {
            move: found,
            notation: moveNotation(found),
            reasoning: String(parsed.reasoning || '').slice(0, 200),
            raw,
          }
        }
      }
    } catch (err) {
      console.error(`[${model}] erreur Ollama (tentative ${attempt + 1}) :`, err.message)
    }
  }

  // Fallback : coup aléatoire parmi les coups légaux pour que la partie continue
  const idx = Math.floor(Math.random() * legal.length)
  return {
    move: legal[idx],
    notation: moveStrs[idx],
    reasoning: '(fallback aléatoire : le modèle n\'a pas renvoyé de coup valide)',
    raw: null,
  }
}

function safeParse(s) {
  try { return JSON.parse(s) } catch {}
  // Certains modèles enveloppent dans du markdown : extraire le premier { ... }
  const m = s.match(/\{[\s\S]*\}/)
  if (m) { try { return JSON.parse(m[0]) } catch {} }
  return null
}
