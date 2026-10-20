import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const dataDir = path.join(root, 'data')
const vocab = JSON.parse(fs.readFileSync(path.join(dataDir, 'vocab.json'), 'utf8'))
const zhMap = JSON.parse(fs.readFileSync(path.join(dataDir, 'zh-map.json'), 'utf8'))
const overrides = JSON.parse(fs.readFileSync(path.join(dataDir, 'zh-overrides.json'), 'utf8'))
const posPath = path.join(dataDir, 'pos-overrides.json')
const posOverrides = fs.existsSync(posPath) ? JSON.parse(fs.readFileSync(posPath, 'utf8')) : {}

const NA_ADJ = new Set(['きれい', '元気', '静か', '有名', '便利', '好き', '嫌い', '上手', '下手', '大変', '大丈夫', '同じ', 'いろいろ', '簡単', '暇', '賑やか', '親切', '立派', '丈夫', '結構', '素敵', '無理', '大切', '必要', '十分', '自由', '残念', '楽', '不安', '幸せ', '熱心', '丁寧', '急', '変', '得意', '苦手', '豊か', '安全', '危険', '新鮮', '確か', '盛ん', '適当', '特別', '真剣', '駄目', 'いや', '嫌', 'ge', 'きらい'])
const I_ADJ = new Set(['おいしい', 'いそがしい', 'たのしい', 'うれしい', 'かなしい', 'こわい', 'ねむい', 'ほしい', 'つまらない', 'やさしい', 'むずかしい', 'あたらしい', 'ふるい', 'おおきい', 'ちいさい', 'あつい', 'さむい', 'つめたい', 'あたたかい', 'すずしい', 'おもい', 'かるい', 'ながい', 'みじかい', 'はやい', 'おそい', 'とおい', 'ちかい', 'ひろい', 'せまい', 'たかい', 'やすい', 'いい', 'よい', 'わるい', 'おもしろい', 'うつくしい', 'きたない', 'いたい', 'あさい', 'ふかい', 'あまい', 'からい', 'にがい', 'すっぱい', 'やわらかい', 'かたい', 'うるさい', 'すごい', 'ひどい', 'くわしい', 'めずらしい', 'おかしい', 'あぶない', 'うまい', 'まずい', 'かわいい', 'こまかい', 'つよい', 'よわい', 'ふとん'])

const cleanZh = (raw) => {
  if (!raw) return ''
  const s = String(raw).replace(/\\n/g, '\n')
  for (const line of s.split(/\n/)) {
    const l = line
      .replace(/\[[^\]]{1,8}\]/g, '')
      .replace(/^[a-zA-Z]+\.\s*/, '')
      .replace(/\([^)]*\)/g, '')
      .trim()
    if (!/[\u4e00-\u9fff]/.test(l)) continue
    const pieces = []
    for (const part of l.split(/[,;；，、]/)) {
      const p = part.replace(/\[[^\]]*\]/g, '').trim()
      if (p && /[\u4e00-\u9fff]/.test(p) && !pieces.includes(p)) pieces.push(p)
    }
    if (pieces.length) return pieces.slice(0, 3).join('；')
  }
  return ''
}

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim()
const zhByGloss = new Map()
for (const [k, v] of Object.entries({ ...zhMap, ...overrides })) zhByGloss.set(norm(k), v)

const detectPos = (kana, kanji) => {
  const rawK = kana.replace(/\s/g, '')
  const rawJ = (kanji || '').replace(/\s/g, '')
  if (posOverrides[kana] || posOverrides[kanji || '']) return posOverrides[kana] || posOverrides[kanji]
  if (/\[な\]|［な］|\[ナ\]/.test(rawJ) || /\[な\]|［な］/.test(rawK)) return '形容动词'
  if (rawK.endsWith('ます')) return '动词'
  const k = rawK
    .replace(/[\[［][^\]］]*[\]］]/g, '')
    .replace(/[～~]/g, '')
    .replace(/な$/, '')
  if (NA_ADJ.has(k)) return '形容动词'
  if (I_ADJ.has(k) || rawK.endsWith('しい')) return '形容词'
  if (rawJ && rawJ.endsWith('い') && /[\u4e00-\u9fff]/.test(rawJ) && rawK.endsWith('い')) return '形容词'
  if (/[。？!]/.test(kana) || /[。？!]/.test(kanji || '')) return '寒暄语'
  if (rawK.startsWith('～') || rawK.startsWith('~') || rawK.startsWith('―') || rawK.startsWith('-')) return '接尾词'
  return '名词'
}

const cards = vocab.cards
const counters = {}
const cleanField = (s) =>
  String(s || '')
    .replace(/\s+/g, ' ')
    .replace(/[\[［][なナ][\]］]/g, '')
    .replace(/\s*[ⅠⅡ]$/g, '')
    .trim()

const words = cards.map((c) => {
  const gloss = c.meaning.trim()
  const zh = (zhByGloss.get(norm(gloss)) || '').trim()
  counters[c.lesson] = (counters[c.lesson] || 0) + 1
  const no = counters[c.lesson]
  return {
    id: c.lesson * 1000 + no,
    lesson: c.lesson,
    no,
    kanji: cleanField(c.kanji),
    kana: cleanField(c.kana),
    meaning_en: gloss,
    meaning_zh: cleanZh(zh),
    pos: detectPos(c.kana || '', c.kanji || ''),
  }
})

const lessons = Array.from({ length: 50 }, (_, i) => ({
  n: i + 1,
  book: i < 25 ? 1 : 2,
  count: words.filter((w) => w.lesson === i + 1).length,
}))

const out = { generatedAt: new Date().toISOString(), lessons, words }
fs.writeFileSync(path.join(dataDir, 'seed.json'), JSON.stringify(out), 'utf8')

const withZh = words.filter((w) => w.meaning_zh).length
console.log(`words=${words.length}, withZh=${withZh} (${((withZh / words.length) * 100).toFixed(1)}%)`)
console.log('lessons:', lessons.map((l) => `${l.n}:${l.count}`).join(' '))
const posCount = {}
for (const w of words) posCount[w.pos] = (posCount[w.pos] || 0) + 1
console.log('pos:', posCount)
console.log('\nsample:')
for (const w of words.filter((_, i) => i % 173 === 0).slice(0, 12)) console.log(w.lesson, w.kana, w.kanji, '|', w.meaning_zh, '|', w.pos)
