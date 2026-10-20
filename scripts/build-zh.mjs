import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const root = path.resolve(import.meta.dirname, '..')
const dictPath = process.env.ECDICT_PATH || path.join(os.tmpdir(), 'ecdict.csv')
const vocabPath = path.join(root, 'data', 'vocab.json')
const outPath = path.join(root, 'data', 'zh-map.json')

function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows
}

const cleanTranslation = (raw) => {
  if (!raw) return ''
  const lines = raw.split(/\r?\n/)
  const parts = []
  for (const line of lines) {
    if (!/[\u4e00-\u9fff]/.test(line)) continue
    const zh = line
      .replace(/^[a-z]+\.\s*/i, '')
      .replace(/\([^)]*[\u4e00-\u9fff][^)]*\)/g, '')
      .trim()
    if (!zh) continue
    for (const part of zh.split(/[,;；，]/)) {
      const p = part.trim()
      if (p && /[\u4e00-\u9fff]/.test(p)) parts.push(p)
    }
    if (parts.length) break
  }
  return parts.slice(0, 4).join('；')
}

console.log('reading dictionary...')
const csv = fs.readFileSync(dictPath, 'utf8')
const rows = parseCsv(csv)
const header = rows.shift()
const idxWord = header.indexOf('word')
const idxTrans = header.indexOf('translation')
const dict = new Map()
for (const r of rows) {
  const w = (r[idxWord] || '').trim().toLowerCase()
  if (!w || dict.has(w)) continue
  const zh = cleanTranslation(r[idxTrans])
  if (zh) dict.set(w, zh)
}
console.log('dictionary entries:', dict.size)

const vocab = JSON.parse(fs.readFileSync(vocabPath, 'utf8'))
const glosses = [...new Set(vocab.cards.map((c) => c.meaning.trim()))]
const manualPath = path.join(root, 'data', 'zh-overrides.json')
const manual = fs.existsSync(manualPath) ? JSON.parse(fs.readFileSync(manualPath, 'utf8')) : {}

const splitGloss = (g) =>
  g
    .replace(/[～~]/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .split(/\s*[/,;]\s*/)
    .filter(Boolean)

function lookup(gloss) {
  const key = gloss.trim().toLowerCase()
  if (manual[key]) return manual[key]
  const full = key.replace(/[～~]/g, '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim()
  if (dict.has(full)) return dict.get(full)
  const noTo = full.replace(/^to\s+/, '')
  if (dict.has(noTo)) return dict.get(noTo)
  const segs = splitGloss(gloss)
  const found = []
  for (const s of segs) {
    const s2 = s.replace(/^to\s+/, '')
    if (dict.has(s)) found.push(dict.get(s))
    else if (dict.has(s2)) found.push(dict.get(s2))
  }
  if (found.length) return [...new Set(found)].slice(0, 3).join('；')
  return ''
}

const map = {}
let hit = 0
for (const g of glosses) {
  const zh = lookup(g)
  if (zh) { map[g] = zh; hit++ }
}
fs.writeFileSync(outPath, JSON.stringify(map, null, 1), 'utf8')
console.log(`glosses: ${glosses.length}, covered: ${hit} (${((hit / glosses.length) * 100).toFixed(1)}%)`)
console.log('missing sample:', glosses.filter((g) => !map[g]).slice(0, 40))
