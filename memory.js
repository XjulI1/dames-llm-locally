// Mémoire persistante : leçons tirées des parties précédentes.
// À la fin de chaque partie, chaque modèle peut écrire 1-2 leçons.
// Au début de la partie suivante, les N dernières leçons sont
// réinjectées dans le system prompt.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MEMORY_FILE = path.join(__dirname, 'memory.json')
const MAX_KEEP = 40   // on garde les 40 dernières leçons max
const INJECT_N = 10   // on en injecte 10 dans le prompt

function load() {
  try {
    const raw = fs.readFileSync(MEMORY_FILE, 'utf8')
    const data = JSON.parse(raw)
    return Array.isArray(data.lessons) ? data.lessons : []
  } catch {
    return []
  }
}

function save(lessons) {
  const trimmed = lessons.slice(-MAX_KEEP)
  fs.writeFileSync(MEMORY_FILE, JSON.stringify({ lessons: trimmed }, null, 2))
}

export function recentLessons(forColor) {
  const all = load()
  // On filtre par couleur (même camp = leçons les plus pertinentes)
  // puis on prend les plus récentes
  const own = all.filter(l => l.color === forColor).slice(-INJECT_N)
  const other = all.filter(l => l.color !== forColor).slice(-Math.floor(INJECT_N / 2))
  return { own, other }
}

export function addLesson({ color, model, result, lesson }) {
  const all = load()
  all.push({
    ts: new Date().toISOString(),
    color,
    model,
    result,          // 'win' | 'loss' | 'draw'
    lesson: String(lesson).slice(0, 300),
  })
  save(all)
}

export function formatLessonsForPrompt(forColor) {
  const { own, other } = recentLessons(forColor)
  if (own.length === 0 && other.length === 0) return ''
  const lines = ['EXPÉRIENCE ACCUMULÉE (parties précédentes) :']
  for (const l of own) {
    lines.push(`- [${l.result} avec les ${l.color === 'w' ? 'Blancs' : 'Noirs'}] ${l.lesson}`)
  }
  for (const l of other) {
    lines.push(`- [vu côté adverse] ${l.lesson}`)
  }
  return lines.join('\n')
}
