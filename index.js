// Boucle principale : deux modèles Ollama s'affrontent aux dames internationales.
import chalk from 'chalk'
import {
  initialPosition,
  legalMoves,
  applyMove,
  isGameOver,
  renderBoard,
  moveNotation,
  materialCount,
} from './engine.js'
import { chooseMove } from './agent.js'

// ====== Configuration ======
const CONFIG = {
  white: { model: process.env.WHITE_MODEL || 'llama3.2:3b' },
  black: { model: process.env.BLACK_MODEL || 'qwen2.5:3b' },
  host: process.env.OLLAMA_HOST || undefined, // par défaut http://127.0.0.1:11434
  maxMoves: 150,  // coups max avant de couper (safety)
  delayMs: 200,   // pause entre coups pour lisibilité
}
// ==========================

function header(t) {
  return chalk.bold.cyan(`\n═══ ${t} ═══`)
}

async function main() {
  console.log(header('Dames internationales : duel de LLM locaux'))
  console.log(`Blancs (o/O) : ${chalk.green(CONFIG.white.model)}`)
  console.log(`Noirs  (x/X) : ${chalk.red(CONFIG.black.model)}`)

  let state = initialPosition()
  const history = []

  for (let i = 0; i < CONFIG.maxMoves; i++) {
    const status = isGameOver(state)
    if (status.over) {
      console.log(header('Partie terminée'))
      console.log(renderBoard(state))
      if (status.winner) {
        const color = status.winner === 'w' ? chalk.green('Blancs') : chalk.red('Noirs')
        console.log(`Victoire des ${color} (${status.reason}).`)
      } else {
        console.log(`Nulle : ${status.reason}.`)
      }
      break
    }

    const legal = legalMoves(state)
    const color = state.turn
    const agent = color === 'w' ? CONFIG.white : CONFIG.black
    const tag = color === 'w' ? chalk.green('o') : chalk.red('x')

    console.log(header(`Coup ${state.moveNumber} — ${color === 'w' ? 'Blancs' : 'Noirs'} (${agent.model})`))
    console.log(renderBoard(state))

    const t0 = Date.now()
    const { move, notation, reasoning } = await chooseMove({
      model: agent.model,
      host: CONFIG.host,
      state,
      legal,
      color,
    })
    const dt = ((Date.now() - t0) / 1000).toFixed(1)

    console.log(`${tag} ${chalk.bold(notation)}  ${chalk.gray(`(${dt}s) — ${reasoning}`)}`)
    history.push({ n: state.moveNumber, color, notation, reasoning, time: dt })

    state = applyMove(state, move)
    await new Promise(r => setTimeout(r, CONFIG.delayMs))
  }

  // Si on sort par le max de coups
  if (!isGameOver(state).over) {
    console.log(header(`Arrêt après ${CONFIG.maxMoves} coups (limite de sécurité)`))
    console.log(renderBoard(state))
  }

  // Résumé matériel
  const m = materialCount(state)
  console.log(chalk.gray(`\nMatériel final : Blancs ${m.wp} pions + ${m.wk} dames, Noirs ${m.bp} pions + ${m.bk} dames`))

  // PDN-like log
  console.log(header('Notation de la partie'))
  const lines = []
  for (let i = 0; i < history.length; i += 2) {
    const w = history[i]
    const b = history[i + 1]
    const n = Math.floor(i / 2) + 1
    lines.push(`${n}. ${w.notation}${b ? '  ' + b.notation : ''}`)
  }
  console.log(lines.join('\n'))
}

main().catch(err => {
  console.error(chalk.red('Erreur fatale :'), err)
  process.exit(1)
})
