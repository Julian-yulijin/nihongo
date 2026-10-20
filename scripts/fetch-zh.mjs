import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const vocab = JSON.parse(fs.readFileSync(path.join(root, 'data', 'vocab.json'), 'utf8'))
const mapPath = path.join(root, 'data', 'zh-map.json')
const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'))
const manualPath = path.join(root, 'data', 'zh-overrides.json')
const manual = fs.existsSync(manualPath) ? JSON.parse(fs.readFileSync(manualPath, 'utf8')) : {}

const glosses = [...new Set(vocab.cards.map((c) => c.meaning.trim()))]
const missing = glosses.filter((g) => !map[g] && !manual[g])
console.log('missing glosses:', missing.length)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function parseYoudao(json) {
  const attempts = [
    json?.fanyi?.tran,
    json?.web_trans?.['web-translation']?.[0]?.trans?.[0]?.value,
    json?.ec?.word?.[0]?.trs?.[0]?.tr?.[0]?.l?.i?.[0],
    json?.ec?.word?.[0]?.trs?.[0]?.tr?.[0]?.l?.i,
    json?.simple?.word?.[0]?.usphone,
  ]
  for (let a of attempts) {
    if (Array.isArray(a)) a = a[0]
    if (typeof a !== 'string') continue
    a = a.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
    a = a.split(/[;；,，]/)[0].trim()
    if (/[\u4e00-\u9fff]/.test(a)) return a.slice(0, 40)
  }
  return ''
}

async function translateOne(gloss) {
  const q = gloss.replace(/[∼~]/g, '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
  if (!q) return ''
  const url = 'https://dict.youdao.com/jsonapi?q=' + encodeURIComponent(q)
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
      Accept: 'application/json,text/plain,*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
    },
  })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return parseYoudao(await res.json())
}

let done = 0
let failed = 0
const queue = [...missing]
async function worker(id) {
  while (queue.length) {
    const gloss = queue.shift()
    try {
      const zh = await translateOne(gloss)
      if (zh) map[gloss] = zh
      else failed++
    } catch (e) {
      failed++
      if (failed < 8) console.log('fail', gloss, e.message)
    }
    done++
    if (done % 25 === 0) {
      console.log(`progress ${done}/${missing.length}, failed=${failed}`)
      fs.writeFileSync(mapPath, JSON.stringify(map, null, 1), 'utf8')
    }
    await sleep(140)
  }
}

await Promise.all([worker(1), worker(2), worker(3)])
fs.writeFileSync(mapPath, JSON.stringify(map, null, 1), 'utf8')
console.log(`done: ${done}, covered=${Object.keys(map).length}, failed=${failed}`)
