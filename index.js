// Mode terminal : deux modèles Ollama s'affrontent avec analyse tactique enrichie.
import chalk from 'chalk'
import {
  initialPosition, legalMoves, applyMove, isGameOver,
  renderBoard, materialCount,
} from './engine.js'
import { chooseMove, postGameReflection } from './agent.js'
import { addLesson } from './memory.js'

const CONFIG = {
  white: { model: process.env.WHITE_MODEL || 'llama3.2:3b' },
  black: { model: process.env.BLACK_MODEL || 'qwen2.5:3b' },
  host: process.env.OLLAMA_HOST || undefined,
  maxMoves: 200,
  reflect: process.env.REFLECT !== '0',
}

const h = t => chalk.bold.cyan(`\n═══ ${t} ═══`)

async function main() {
  console.log(h('Dames internationales — duel LLM (mode expérimenté)'))
  console.log(`Blancs : ${chalk.green(CONFIG.white.model)}`)
  console.log(`Noirs  : ${chalk.red(CONFIG.black.model)}`)

  let state = initialPosition()
  const history = []
  let finalStatus = null

  for (let i = 0; i < CONFIG.maxMoves; i++) {
    const status = isGameOver(state)
    if (status.over) { finalStatus = status; break }

    const legal = legalMoves(state)
    const color = state.turn
    const agent = color === 'w' ? CONFIG.white : CONFIG.black
    const tag = color === 'w' ? chalk.green('o') : chalk.red('x')

    console.log(h(`Coup ${state.moveNumber} — ${color === 'w' ? 'Blancs' : 'Noirs'} (${agent.model})`))
    console.log(renderBoard(state))

    const t0 = Date.now()
    const result = await chooseMove({
      model: agent.model, host: CONFIG.host, state, legal, color,
    })
    const dt = ((Date.now() - t0) / 1000).toFixed(1)

    const top = result.analysis.topCandidates.slice(0, 3).map(c => `${c.notation}(${c.verdict})`).join(' | ')
    console.log(chalk.gray(`  analyse : top → ${top}`))
    if (result.analysis.threats.count > 0) {
      console.log(chalk.yellow(`  menaces : ${result.analysis.threats.count} prise(s) adverse possible(s), cases ${result.analysis.threats.targets.join(',')}`))
    }
    const srcTag = result.source === 'evaluator' ? chalk.red(' [fallback]') : ''
    console.log(`${tag} ${chalk.bold(result.notation)} (${dt}s, conf: ${result.confidence})${srcTag}`)
    console.log(chalk.gray(`  → « ${result.thinking} »`))

    history.push({
      moveNumber: state.moveNumber,
      color,
      notation: result.notation,
      thinking: result.thinking,
      source: result.source,
    })

    state = applyMove(state, result.move)
  }

  finalStatus = finalStatus || { over: true, winner: null, reason: `arrêt après ${CONFIG.maxMoves} coups` }

  console.log(h('Partie terminée'))
  console.log(renderBoard(state))
  if (finalStatus.winner) {
    const color = finalStatus.winner === 'w' ? chalk.green('Blancs') : chalk.red('Noirs')
    console.log(`Victoire des ${color} (${finalStatus.reason}).`)
  } else {
    console.log(`Nulle : ${finalStatus.reason}.`)
  }

  const m = materialCount(state)
  console.log(chalk.gray(`Matériel final : Blancs ${m.wp}p + ${m.wk}D, Noirs ${m.bp}p + ${m.bk}D`))

  // Réflexion post-partie → mémoire
  if (CONFIG.reflect) {
    console.log(h('Réflexions post-partie'))
    for (const color of ['w', 'b']) {
      const model = color === 'w' ? CONFIG.white.model : CONFIG.black.model
      const result = finalStatus.winner === color ? 'win'
                   : finalStatus.winner === null ? 'draw'
                   : 'loss'
      const lesson = await postGameReflection({
        model, host: CONFIG.host, color, result, history, finalState: state,
      })
      if (lesson) {
        addLesson({ color, model, result, lesson })
        console.log(`${color === 'w' ? chalk.green('Blancs') : chalk.red('Noirs')} (${result}) : "${lesson}"`)
      }
    }
  }

  console.log(h('Notation de la partie'))
  const lines = []
  for (let i = 0; i < history.length; i += 2) {
    const w = history[i], b = history[i + 1]
    lines.push(`${Math.floor(i / 2) + 1}. ${w.notation}${b ? '  ' + b.notation : ''}`)
  }
  console.log(lines.join('\n'))
}

main().catch(e => { console.error(chalk.red('Erreur :'), e); process.exit(1) })
