// Serveur HTTP + Server-Sent Events : sert public/index.html et
// streame les coups d'une partie LLM vs LLM au navigateur.
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  initialPosition,
  legalMoves,
  applyMove,
  isGameOver,
  moveNotation,
  materialCount,
} from './engine.js'
import { chooseMove } from './agent.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 3000

const CONFIG = {
  white: process.env.WHITE_MODEL || 'llama3.2:3b',
  black: process.env.BLACK_MODEL || 'qwen2.5:3b',
  host: process.env.OLLAMA_HOST || undefined,
  maxMoves: 150,
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
  send(res, 'state', {
    board: state.board,
    turn: state.turn,
    moveNumber: state.moveNumber,
    material: materialCount(state),
  })

  for (let i = 0; i < CONFIG.maxMoves; i++) {
    const status = isGameOver(state)
    if (status.over) {
      send(res, 'end', status)
      return
    }

    const legal = legalMoves(state)
    const color = state.turn
    const model = color === 'w' ? CONFIG.white : CONFIG.black

    send(res, 'thinking', { color, model })

    const t0 = Date.now()
    const { move, notation, reasoning } = await chooseMove({
      model,
      host: CONFIG.host,
      state,
      legal,
      color,
    })
    const time = ((Date.now() - t0) / 1000).toFixed(1)

    const from = move.path[0]
    const to = move.path[move.path.length - 1]
    const capturedCount = move.captured.length

    send(res, 'move', {
      color,
      notation,
      reasoning,
      time,
      moveNumber: state.moveNumber,
      capturedCount,
    })

    state = applyMove(state, move)

    send(res, 'state', {
      board: state.board,
      turn: state.turn,
      moveNumber: state.moveNumber,
      material: materialCount(state),
      lastMove: { from, to, captured: move.captured },
    })
  }

  send(res, 'end', { over: true, winner: null, reason: `arrêt après ${CONFIG.maxMoves} coups` })
}

server.listen(PORT, () => {
  console.log(`\n  Dames LLM — interface web`)
  console.log(`  Blancs : ${CONFIG.white}`)
  console.log(`  Noirs  : ${CONFIG.black}`)
  console.log(`  → http://localhost:${PORT}\n`)
})
