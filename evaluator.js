// Évaluateur de position et recherche 1-ply.
// Transforme les LLM en joueurs "expérimentés" en leur évitant
// les calculs tactiques qu'ils ne savent pas faire.
import {
  EMPTY, WHITE, BLACK, WKING, BKING,
  legalMoves, applyMove, moveNotation, rcToNum,
} from './engine.js'

const PAWN = 100
const KING = 320

// Bonus positionnels (petits par rapport au matériel)
const ADVANCE_BONUS = 4         // par rangée vers la promotion
const CENTER_BONUS = 3          // pièce dans la zone centrale
const BACK_RANK_BONUS = 6       // pion gardant sa dernière rangée
const EDGE_PENALTY = 2          // pion collé aux colonnes a ou j

// ===== Évaluation statique (point de vue "Blancs positif") =====
export function evaluate(state) {
  let score = 0
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 10; c++) {
      const p = state.board[r][c]
      if (p === EMPTY) continue
      const onEdge = (c === 0 || c === 9)
      const inCenter = r >= 3 && r <= 6 && c >= 2 && c <= 7

      if (p === WHITE) {
        score += PAWN + (9 - r) * ADVANCE_BONUS
        if (inCenter) score += CENTER_BONUS
        if (r === 9) score += BACK_RANK_BONUS
        if (onEdge) score -= EDGE_PENALTY
      } else if (p === BLACK) {
        score -= PAWN + r * ADVANCE_BONUS
        if (inCenter) score -= CENTER_BONUS
        if (r === 0) score -= BACK_RANK_BONUS
        if (onEdge) score += EDGE_PENALTY
      } else if (p === WKING) {
        score += KING
        if (inCenter) score += CENTER_BONUS * 2
      } else if (p === BKING) {
        score -= KING
        if (inCenter) score -= CENTER_BONUS * 2
      }
    }
  }
  return score
}

// Compte matériel (pour affichage)
export function countMaterial(state) {
  let wp = 0, wk = 0, bp = 0, bk = 0
  for (const row of state.board) for (const p of row) {
    if (p === WHITE) wp++
    else if (p === WKING) wk++
    else if (p === BLACK) bp++
    else if (p === BKING) bk++
  }
  return { wp, wk, bp, bk, wTotal: wp + wk, bTotal: bp + bk }
}

export function gamePhase(state) {
  const m = countMaterial(state)
  const total = m.wTotal + m.bTotal
  if (total >= 32) return 'ouverture'
  if (total >= 14) return 'milieu'
  return 'finale'
}

// ===== Recherche 1-ply avec minimax =====
// Pour chaque coup légal, simule, puis évalue la meilleure réponse adverse.
// Retourne la liste triée (meilleur en premier du point de vue du joueur actif).
export function rankMoves(state, legal) {
  const weAreWhite = state.turn === 'w'
  const sign = weAreWhite ? 1 : -1

  const ranked = legal.map(move => {
    const after = applyMove(state, move)
    const oppLegal = legalMoves(after)

    if (oppLegal.length === 0) {
      // Adversaire sans coup = victoire immédiate
      return {
        move,
        notation: moveNotation(move),
        score: 99999 * sign,
        immediateGain: move.captured.length,
        bestReply: null,
        bestReplyCaptures: 0,
        verdict: 'victoire immédiate',
      }
    }

    // L'adversaire cherche à minimiser (pour nous)
    let bestOppScore = weAreWhite ? Infinity : -Infinity
    let bestOppMove = null
    for (const oppMove of oppLegal) {
      const afterOpp = applyMove(after, oppMove)
      const s = evaluate(afterOpp)
      const better = weAreWhite ? (s < bestOppScore) : (s > bestOppScore)
      if (better) {
        bestOppScore = s
        bestOppMove = oppMove
      }
    }

    return {
      move,
      notation: moveNotation(move),
      score: bestOppScore,
      immediateGain: move.captured.length,
      bestReply: bestOppMove ? moveNotation(bestOppMove) : null,
      bestReplyCaptures: bestOppMove ? bestOppMove.captured.length : 0,
    }
  })

  // Tri : meilleur score pour nous en premier
  ranked.sort((a, b) => weAreWhite ? b.score - a.score : a.score - b.score)

  // Annoter le verdict relatif au meilleur coup
  const best = ranked[0]?.score ?? 0
  for (const m of ranked) {
    if (m.verdict) continue
    const delta = (m.score - best) * sign // négatif = moins bien
    if (delta >= -5) m.verdict = 'excellent'
    else if (delta >= -30) m.verdict = 'solide'
    else if (delta >= -100) m.verdict = 'discutable'
    else m.verdict = 'mauvais (perte probable)'
  }

  return ranked
}

// ===== Menaces immédiates contre le joueur au trait =====
// "Si je passe mon tour, que peut capturer l'adversaire ?"
export function detectThreats(state) {
  const passed = { ...state, turn: state.turn === 'w' ? 'b' : 'w' }
  const oppMoves = legalMoves(passed)
  const captures = oppMoves.filter(m => m.captured.length > 0)
  const targetSet = new Set()
  for (const m of captures) {
    for (const [r, c] of m.captured) targetSet.add(rcToNum(r, c))
  }
  const targets = [...targetSet].sort((a, b) => a - b)
  const worst = captures.reduce((max, m) => Math.max(max, m.captured.length), 0)
  return { captures, targets, worst }
}

// ===== Captures disponibles pour nous =====
export function detectOpportunities(state) {
  const moves = legalMoves(state)
  const caps = moves.filter(m => m.captured.length > 0)
  const maxLen = caps.reduce((max, m) => Math.max(max, m.captured.length), 0)
  return { captures: caps, maxLen }
}
