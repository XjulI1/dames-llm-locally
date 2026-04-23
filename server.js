// Serveur HTTP + Server-Sent Events.
// Diffuse l'état du plateau, la pensée du modèle, l'analyse tactique,
// et déclenche une réflexion post-partie pour alimenter la mémoire.
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  initialPosition, legalMoves, applyMove, isGameOver,
  materialCount,
} from './engine.js'
import { chooseMove, postGameReflection } from './agent.js'
import { addLesson } from './memory.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 3000

const CONFIG = {
  white: process.env.WHITE_MODEL || 'llama3.2:3b',
  black: process.env.BLACK_MODEL || 'qwen2.5:3b',
  host: process.env.OLLAMA_HOST || undefined,
  maxMoves: 200,
  reflect: process.env.REFLECT !== '0',
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'))
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(html)
    return
  }
  if (req.url === '/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    try {
      await runMatch(res)
    } catch (e) {
      send(res, 'error', { message: e.message })
    } finally {
      res.end()
    }
    return
  }
  res.writeHead(404)
  res.end('Not found')
})

function send(res, type, data = {}) {
  res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`)
}

async function runMatch(res) {
  send(res, 'init', { white: CONFIG.white, black: CONFIG.black })

  let state = initialPosition()
  const history = []

  send(res, 'state', {
    board: state.board,
    turn: state.turn,
    moveNumber: state.moveNumber,
    material: materialCount(state),
  })

  let finalStatus = null

  for (let i = 0; i < CONFIG.maxMoves; i++) {
    const status = isGameOver(state)
    if (status.over) { finalStatus = status; break }

    const legal = legalMoves(state)
    const color = state.turn
    const model = color === 'w' ? CONFIG.white : CONFIG.black

    send(res, 'thinking', { color, model })

    const t0 = Date.now()
    const result = await chooseMove({
      model, host: CONFIG.host, state, legal, color,
    })
    const time = ((Date.now() - t0) / 1000).toFixed(1)

    const from = result.move.path[0]
    const to = result.move.path[result.move.path.length - 1]

    send(res, 'move', {
      color,
      notation: result.notation,
      thinking: result.thinking,
      confidence: result.confidence,
      source: result.source,
      analysis: result.analysis,
      time,
      moveNumber: state.moveNumber,
      capturedCount: result.move.captured.length,
    })

    history.push({
      moveNumber: state.moveNumber,
      color,
      notation: result.notation,
      thinking: result.thinking,
      source: result.source,
    })

    state = applyMove(state, result.move)

    send(res, 'state', {
      board: state.board,
      turn: state.turn,
      moveNumber: state.moveNumber,
      material: materialCount(state),
      lastMove: { from, to, captured: result.move.captured },
    })
  }

  finalStatus = finalStatus || { over: true, winner: null, reason: `arrêt après ${CONFIG.maxMoves} coups` }
  send(res, 'end', finalStatus)

  // Phase de réflexion post-partie : chaque modèle tire une leçon
  if (CONFIG.reflect) {
    send(res, 'reflecting', {})
    for (const color of ['w', 'b']) {
      const model = color === 'w' ? CONFIG.white : CONFIG.black
      const result = finalStatus.winner === color ? 'win'
                   : finalStatus.winner === null ? 'draw'
                   : 'loss'
      try {
        const lesson = await postGameReflection({
          model, host: CONFIG.host, color, result, history, finalState: state,
        })
        if (lesson) {
          addLesson({ color, model, result, lesson })
          send(res, 'lesson', { color, model, result, lesson })
        }
      } catch (e) {
        console.error('post-game reflection error:', e.message)
      }
    }
  }
}

server.listen(PORT, () => {
  console.log(`\n  Dames LLM — interface web (mode "joueur expérimenté")`)
  console.log(`  Blancs : ${CONFIG.white}`)
  console.log(`  Noirs  : ${CONFIG.black}`)
  console.log(`  Mémoire : ${CONFIG.reflect ? 'activée' : 'désactivée'}`)
  console.log(`  → http://localhost:${PORT}\n`)
})
