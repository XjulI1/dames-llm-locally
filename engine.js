// Moteur de dames internationales (10x10, règles FMJD)
// Représentation : grille 10x10, (r=0 en haut, c=0 à gauche).
// Cases jouables = cases sombres = (r+c) % 2 === 0.
// Numérotation FMJD 1-50 : case 1 = (0,0), lecture gauche->droite, haut->bas.

export const EMPTY = '.'
export const WHITE = 'w'   // pion blanc
export const BLACK = 'b'   // pion noir
export const WKING = 'W'   // dame blanche
export const BKING = 'B'   // dame noire

const isWhite = p => p === WHITE || p === WKING
const isBlack = p => p === BLACK || p === BKING
const isKing  = p => p === WKING || p === BKING
const ownerOf = p => (isWhite(p) ? 'w' : isBlack(p) ? 'b' : null)
const isDark  = (r, c) => (r + c) % 2 === 0

export function initialPosition() {
  const board = Array.from({ length: 10 }, () => Array(10).fill(EMPTY))
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 10; c++)
      if (isDark(r, c)) board[r][c] = BLACK
  for (let r = 6; r < 10; r++)
    for (let c = 0; c < 10; c++)
      if (isDark(r, c)) board[r][c] = WHITE
  return { board, turn: 'w', plyNoProgress: 0, moveNumber: 1 }
}

// (r, c) -> numéro FMJD (1..50)
export function rcToNum(r, c) {
  if (!isDark(r, c)) return null
  const idx = r % 2 === 0 ? c / 2 : (c - 1) / 2
  return r * 5 + idx + 1
}

export function numToRc(n) {
  const r = Math.floor((n - 1) / 5)
  const idx = (n - 1) % 5
  const c = r % 2 === 0 ? idx * 2 : idx * 2 + 1
  return [r, c]
}

// Trouve toutes les séquences de prise maximales depuis (r0, c0).
// Une prise (kings compris) suit les règles FMJD : prise obligatoire,
// pions peuvent prendre en arrière, dames volantes, on ne repasse pas sur
// une pièce déjà capturée dans la séquence courante.
function findCaptures(board, r0, c0, piece) {
  // On efface la case de départ (la pièce « a quitté ») pour simplifier les checks.
  const b = board.map(row => row.slice())
  b[r0][c0] = EMPTY

  const sequences = []
  const dirs = [[-1,-1],[-1,1],[1,-1],[1,1]]
  const king = isKing(piece)
  const own = ownerOf(piece)

  function recurse(r, c, captured, path) {
    let extended = false
    const isCap = (rr, cc) => captured.some(([a, b]) => a === rr && b === cc)

    for (const [dr, dc] of dirs) {
      if (king) {
        // On avance jusqu'à trouver une pièce (ou sortir)
        let i = 1
        while (true) {
          const tr = r + dr * i, tc = c + dc * i
          if (tr < 0 || tr > 9 || tc < 0 || tc > 9) break
          if (b[tr][tc] === EMPTY) { i++; continue }
          // Pièce rencontrée : alliée, ou déjà prise => stop
          if (ownerOf(b[tr][tc]) === own) break
          if (isCap(tr, tc)) break
          // Ennemi pas encore pris : tenter toutes les cases d'arrivée au-delà
          let j = i + 1
          while (true) {
            const lr = r + dr * j, lc = c + dc * j
            if (lr < 0 || lr > 9 || lc < 0 || lc > 9) break
            if (b[lr][lc] !== EMPTY) break // bloqué (y compris par pièces capturées non retirées)
            extended = true
            recurse(lr, lc, [...captured, [tr, tc]], [...path, [lr, lc]])
            j++
          }
          break // une seule pièce par direction
        }
      } else {
        // Pion : saut court dans les 4 directions
        const tr = r + dr, tc = c + dc
        const lr = r + 2 * dr, lc = c + 2 * dc
        if (lr < 0 || lr > 9 || lc < 0 || lc > 9) continue
        if (b[tr][tc] === EMPTY || ownerOf(b[tr][tc]) === own) continue
        if (isCap(tr, tc)) continue
        if (b[lr][lc] !== EMPTY) continue
        extended = true
        recurse(lr, lc, [...captured, [tr, tc]], [...path, [lr, lc]])
      }
    }

    if (!extended && captured.length > 0) {
      sequences.push({ path, captured })
    }
  }

  recurse(r0, c0, [], [[r0, c0]])
  return sequences
}

export function legalMoves(state) {
  const { board, turn } = state
  const allCaptures = []
  const quietMoves = []

  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 10; c++) {
      const p = board[r][c]
      if (p === EMPTY || ownerOf(p) !== turn) continue
      const caps = findCaptures(board, r, c, p)
      allCaptures.push(...caps)
      if (caps.length === 0) {
        if (isKing(p)) {
          for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
            let i = 1
            while (true) {
              const tr = r + dr * i, tc = c + dc * i
              if (tr < 0 || tr > 9 || tc < 0 || tc > 9) break
              if (board[tr][tc] !== EMPTY) break
              quietMoves.push({ path: [[r, c], [tr, tc]], captured: [] })
              i++
            }
          }
        } else {
          const forward = turn === 'w' ? -1 : 1
          for (const dc of [-1, 1]) {
            const tr = r + forward, tc = c + dc
            if (tr < 0 || tr > 9 || tc < 0 || tc > 9) continue
            if (board[tr][tc] !== EMPTY) continue
            quietMoves.push({ path: [[r, c], [tr, tc]], captured: [] })
          }
        }
      }
    }
  }

  if (allCaptures.length > 0) {
    // Règle de la prise maximale : ne garder que les séquences les plus longues
    const max = Math.max(...allCaptures.map(s => s.captured.length))
    return allCaptures.filter(s => s.captured.length === max)
  }
  return quietMoves
}

export function applyMove(state, move) {
  const newBoard = state.board.map(row => row.slice())
  const [fr, fc] = move.path[0]
  const [tr, tc] = move.path[move.path.length - 1]
  const piece = newBoard[fr][fc]
  newBoard[fr][fc] = EMPTY
  for (const [cr, cc] of move.captured) newBoard[cr][cc] = EMPTY
  // Promotion : un pion atteignant la dernière rangée devient dame
  let finalPiece = piece
  if (piece === WHITE && tr === 0) finalPiece = WKING
  if (piece === BLACK && tr === 9) finalPiece = BKING
  newBoard[tr][tc] = finalPiece

  // Compteur de parties nulles : 25 coups de dames sans prise ni mouvement de pion
  let ply = state.plyNoProgress
  if (move.captured.length > 0 || piece === WHITE || piece === BLACK) ply = 0
  else ply = ply + 1

  return {
    board: newBoard,
    turn: state.turn === 'w' ? 'b' : 'w',
    plyNoProgress: ply,
    moveNumber: state.turn === 'b' ? state.moveNumber + 1 : state.moveNumber,
  }
}

export function isGameOver(state) {
  const moves = legalMoves(state)
  if (moves.length === 0) {
    return { over: true, winner: state.turn === 'w' ? 'b' : 'w', reason: 'pas de coup légal' }
  }
  if (state.plyNoProgress >= 50) {
    return { over: true, winner: null, reason: 'nulle (25 coups sans progression)' }
  }
  return { over: false }
}

// Notation FMJD : "32-28" pour un coup simple, "32x21x30" pour une rafle
export function moveNotation(move) {
  const nums = move.path.map(([r, c]) => rcToNum(r, c))
  const sep = move.captured.length > 0 ? 'x' : '-'
  return nums.join(sep)
}

export function parseMove(notation, legal) {
  const clean = notation.replace(/\s+/g, '').trim()
  return legal.find(m => moveNotation(m) === clean) || null
}

// Rendu ASCII simple avec numéros FMJD visibles
export function renderBoard(state, useColor = false) {
  const { board, turn } = state
  const glyph = {
    [EMPTY]: ' . ',
    [WHITE]: ' o ',
    [BLACK]: ' x ',
    [WKING]: ' O ',
    [BKING]: ' X ',
  }
  const lines = []
  lines.push('     a  b  c  d  e  f  g  h  i  j')
  for (let r = 0; r < 10; r++) {
    const label = String(10 - r).padStart(2)
    const cells = []
    for (let c = 0; c < 10; c++) {
      if (!isDark(r, c)) cells.push('   ')
      else cells.push(glyph[board[r][c]])
    }
    // Ajoute les numéros FMJD de la rangée à droite
    const nums = []
    for (let c = 0; c < 10; c++) if (isDark(r, c)) nums.push(rcToNum(r, c))
    lines.push(`${label}  ${cells.join('')}   [${nums.join(',')}]`)
  }
  lines.push('')
  lines.push(`Trait aux ${turn === 'w' ? 'Blancs (o/O)' : 'Noirs (x/X)'}`)
  return lines.join('\n')
}

// Comptes de pièces pour affichage
export function materialCount(state) {
  let wp = 0, wk = 0, bp = 0, bk = 0
  for (const row of state.board) for (const p of row) {
    if (p === WHITE) wp++
    else if (p === WKING) wk++
    else if (p === BLACK) bp++
    else if (p === BKING) bk++
  }
  return { wp, wk, bp, bk }
}
