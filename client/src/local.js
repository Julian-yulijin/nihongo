const SEED_PATH = `${import.meta.env.BASE_URL}seed.json`
const WORD_KEY = 'minna.wordProgress.v1'
const STAT_KEY = 'minna.questionStats.v1'
const DAY = 24 * 60 * 60 * 1000
const INTERVALS = [1, 2, 4, 7, 15, 30, 60]

let dataPromise = null
let words = []
let lessonMeta = []
let questions = []
const questionById = new Map()
const wordsByLesson = new Map()
const questionsByLesson = new Map()

function readStore(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

let wordProgress = readStore(WORD_KEY)
let questionStats = readStore(STAT_KEY)

function persist(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 浏览器存储已满或被禁用时，本次进度仍保留在内存中
  }
}

function persistWords() {
  persist(WORD_KEY, wordProgress)
}

function persistQuestions() {
  persist(STAT_KEY, questionStats)
}

function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffleWithSeed(arr, seedStr) {
  let h = 2166136261
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const rand = mulberry32(h >>> 0)
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function shuffle(arr) {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const displayWord = (w) => (w.kanji && w.kanji !== w.kana ? `${w.kanji}（${w.kana}）` : w.kana)

function buildQuestions(list) {
  const byLesson = new Map()
  for (const w of list) {
    if (!byLesson.has(w.lesson)) byLesson.set(w.lesson, [])
    byLesson.get(w.lesson).push(w)
  }
  const poolFor = (lesson) => {
    const pool = [...(byLesson.get(lesson) || [])]
    for (const d of [1, -1, 2, -2, 3]) {
      const arr = byLesson.get(lesson + d)
      if (arr) pool.push(...arr)
    }
    return pool
  }

  const out = []
  for (const w of list) {
    const lesson = w.lesson
    const pool = poolFor(lesson)
    const base = (w.no ?? w.seq) * 10
    const skipped = /[。？!]/.test(w.kana) || w.kana.startsWith('～') || w.kana.startsWith('―')
    const hasKanji = w.kanji && w.kanji !== w.kana && !w.kanji.includes('～')

    if (w.meaning_zh) {
      const others = pool
        .filter((x) => x.id !== w.id && x.meaning_zh && x.meaning_zh !== w.meaning_zh)
        .map((x) => x.meaning_zh)
      const unique = [...new Set(others)]
      if (unique.length >= 3) {
        const options = shuffleWithSeed([w.meaning_zh, ...unique.slice(0, 3)], 'zh' + w.id).map((text, i) => ({
          key: String.fromCharCode(65 + i),
          text,
        }))
        out.push({
          id: `w${w.id}-zh`,
          lesson,
          wordId: w.id,
          type: 'choice',
          prompt: displayWord(w),
          promptSub: '选择正确的中文意思',
          options,
          answer: w.meaning_zh,
          accepted: [w.meaning_zh],
          explanation: `「${w.kana}」${w.kanji ? `（${w.kanji}）` : ''} 意思是“${w.meaning_zh}”，词性：${w.pos}。`,
          ord: base + 1,
        })
      }
    }

    if (hasKanji && !skipped) {
      const others = pool
        .filter((x) => x.id !== w.id && x.kana && x.kana !== w.kana && x.kanji)
        .map((x) => x.kana)
      const unique = [...new Set(others)]
      if (unique.length >= 3) {
        const options = shuffleWithSeed([w.kana, ...unique.slice(0, 3)], 'kana' + w.id).map((text, i) => ({
          key: String.fromCharCode(65 + i),
          text,
        }))
        out.push({
          id: `w${w.id}-read`,
          lesson,
          wordId: w.id,
          type: 'choice',
          prompt: w.kanji,
          promptSub: '选择正确的假名读音',
          options,
          answer: w.kana,
          accepted: [w.kana],
          explanation: `「${w.kanji}」读作「${w.kana}」，意思是“${w.meaning_zh || w.meaning_en}”。`,
          ord: base + 2,
        })
      }

      out.push({
        id: `w${w.id}-fill`,
        lesson,
        wordId: w.id,
        type: 'fill',
        prompt: w.kanji,
        promptSub: `填写假名读音${w.meaning_zh ? `（中文：${w.meaning_zh}）` : ''}`,
        options: [],
        answer: w.kana,
        accepted: [w.kana, w.kana.replace(/\s/g, '')],
        explanation: `「${w.kanji}」读作「${w.kana}」${w.meaning_zh ? `，意思是“${w.meaning_zh}”` : ''}，词性：${w.pos}。`,
        ord: base + 3,
      })
    }
  }
  return out
}

export function init() {
  if (!dataPromise) {
    dataPromise = fetch(SEED_PATH)
      .then((res) => {
        if (!res.ok) throw new Error(`数据加载失败 (${res.status})`)
        return res.json()
      })
      .then((seed) => {
        words = Array.isArray(seed.words) ? seed.words : []
        lessonMeta = Array.isArray(seed.lessons) ? seed.lessons : []
        questions = buildQuestions(words)
        wordsByLesson.clear()
        questionsByLesson.clear()
        questionById.clear()
        for (const w of words) {
          if (!wordsByLesson.has(w.lesson)) wordsByLesson.set(w.lesson, [])
          wordsByLesson.get(w.lesson).push(w)
        }
        for (const q of questions) {
          questionById.set(q.id, q)
          if (!questionsByLesson.has(q.lesson)) questionsByLesson.set(q.lesson, [])
          questionsByLesson.get(q.lesson).push(q)
        }
        return seed
      })
      .catch((err) => {
        dataPromise = null
        throw err
      })
  }
  return dataPromise
}

function lessonStats(lesson) {
  const list = questionsByLesson.get(lesson) || []
  let practiced = 0
  let correctAnswers = 0
  let wrongAnswers = 0
  let wrongQuestions = 0
  for (const q of list) {
    const s = questionStats[q.id]
    if (!s) continue
    practiced += 1
    correctAnswers += s.correct_count || 0
    wrongAnswers += s.wrong_count || 0
    if ((s.wrong_count || 0) > 0) wrongQuestions += 1
  }
  const totalAnswers = correctAnswers + wrongAnswers
  return {
    total: list.length,
    choice_total: list.filter((q) => q.type === 'choice').length,
    fill_total: list.filter((q) => q.type === 'fill').length,
    practiced,
    correct_answers: correctAnswers,
    wrong_answers: wrongAnswers,
    wrong_questions: wrongQuestions,
    accuracy: totalAnswers ? Math.round((correctAnswers / totalAnswers) * 100) : 0,
  }
}

export async function getLessons() {
  await init()
  const now = Date.now()
  return lessonMeta.map((meta) => {
    const list = wordsByLesson.get(meta.n) || []
    let learned = 0
    let learning = 0
    let due = 0
    let wrongWords = 0
    let weakWords = 0
    for (const w of list) {
      const p = wordProgress[w.id]
      if (!p || !p.last_seen_at) continue
      if ((p.streak || 0) > 0) learned += 1
      else learning += 1
      if ((p.due_at || 0) <= now) due += 1
      if ((p.wrong_count || 0) > 0) {
        wrongWords += 1
        if ((p.streak || 0) === 0) weakWords += 1
      }
    }
    const qs = lessonStats(meta.n)
    return {
      n: meta.n,
      book: meta.book,
      word_count: list.length,
      question_count: qs.total,
      learned,
      learning,
      due,
      wrong_words: wrongWords,
      weak_words: weakWords,
      attempts: qs.correct_answers + qs.wrong_answers,
      correct_attempts: qs.correct_answers,
      wrong_questions: qs.wrong_questions,
      practiced_questions: qs.practiced,
    }
  })
}

export async function getOverview() {
  await init()
  const now = Date.now()
  let due = 0
  let wrongWords = 0
  let learned = 0
  let seen = 0
  for (const p of Object.values(wordProgress)) {
    if (!p || !p.last_seen_at) continue
    seen += 1
    if ((p.streak || 0) > 0) learned += 1
    if ((p.due_at || 0) <= now) due += 1
    if ((p.wrong_count || 0) > 0) wrongWords += 1
  }
  let answered = 0
  let correct = 0
  let wrongQuestions = 0
  for (const s of Object.values(questionStats)) {
    if (!s) continue
    answered += (s.correct_count || 0) + (s.wrong_count || 0)
    correct += s.correct_count || 0
    if ((s.wrong_count || 0) > 0) wrongQuestions += 1
  }
  return {
    due,
    wrongWords,
    learned,
    seen,
    totalWords: words.length,
    answered,
    accuracy: answered ? Math.round((correct / answered) * 100) : 0,
    wrongQuestions,
  }
}

export async function getWords(lesson, filter = 'all') {
  await init()
  const now = Date.now()
  const rows = (wordsByLesson.get(lesson) || []).map((w) => {
    const p = wordProgress[w.id] || {}
    return {
      id: w.id,
      lesson: w.lesson,
      seq: w.no ?? w.seq,
      kana: w.kana,
      kanji: w.kanji,
      meaning_en: w.meaning_en,
      meaning_zh: w.meaning_zh,
      pos: w.pos,
      status: p.status || null,
      streak: p.streak || 0,
      lapses: p.lapses || 0,
      correct_count: p.correct_count || 0,
      wrong_count: p.wrong_count || 0,
      due_at: p.due_at || 0,
      last_seen_at: p.last_seen_at || 0,
      last_rating: p.last_rating || null,
    }
  })
  if (filter === 'due') return { lesson: Number(lesson), words: rows.filter((r) => r.last_seen_at && r.due_at <= now) }
  if (filter === 'wrong') return { lesson: Number(lesson), words: rows.filter((r) => r.wrong_count > 0) }
  if (filter === 'new') return { lesson: Number(lesson), words: rows.filter((r) => !r.last_seen_at) }
  return { lesson: Number(lesson), words: rows }
}

export async function reviewWord(wordId, rating) {
  await init()
  const id = Number(wordId)
  const exists = words.some((w) => w.id === id)
  if (!exists) throw new Error('单词不存在')

  const t = Date.now()
  const prev = wordProgress[id] || { streak: 0, lapses: 0, correct_count: 0, wrong_count: 0 }
  let streak = prev.streak || 0
  let lapses = prev.lapses || 0
  let correct = prev.correct_count || 0
  let wrong = prev.wrong_count || 0
  let due
  let status

  if (rating === 'again') {
    streak = 0
    lapses += 1
    wrong += 1
    due = t + 10 * 60 * 1000
    status = 'learning'
  } else {
    streak += 1
    correct += 1
    due = t + INTERVALS[Math.min(streak - 1, INTERVALS.length - 1)] * DAY
    status = streak >= 2 ? 'review' : 'learning'
  }

  wordProgress[id] = {
    status,
    streak,
    lapses,
    correct_count: correct,
    wrong_count: wrong,
    due_at: due,
    last_seen_at: t,
    last_rating: rating,
  }
  persistWords()
  return { wordId: id, status, streak, lapses, correctCount: correct, wrongCount: wrong, dueAt: due, rating }
}

export async function getQuestions(lesson, mode = 'order', type = 'all', limit = 30) {
  await init()
  let list = (questionsByLesson.get(Number(lesson)) || []).filter((q) => {
    if (type === 'choice') return q.type === 'choice'
    if (type === 'fill') return q.type === 'fill'
    return true
  })
  if (mode === 'wrong') {
    list = list
      .filter((q) => (questionStats[q.id]?.wrong_count || 0) > 0)
      .sort((a, b) => {
        const sa = questionStats[a.id]
        const sb = questionStats[b.id]
        return (sb.wrong_count || 0) - (sa.wrong_count || 0) || (sa.last_answer_at || 0) - (sb.last_answer_at || 0)
      })
  } else if (mode === 'random') {
    list = shuffle(list)
  } else {
    list = [...list].sort((a, b) => a.ord - b.ord)
  }
  const size = Math.min(Number(limit) || 30, 100)
  return {
    lesson: Number(lesson),
    mode,
    questions: list.slice(0, size).map((q) => ({
      id: q.id,
      lesson: q.lesson,
      type: q.type,
      prompt: q.prompt,
      prompt_sub: q.promptSub,
      options: q.options,
      ord: q.ord,
    })),
  }
}

function normalize(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[・、。，,.]/g, '')
    .trim()
}

export async function submitAnswer(questionId, response) {
  await init()
  const q = questionById.get(String(questionId))
  if (!q) throw new Error('题目不存在')
  const text = String(response ?? '')
  const correct = [q.answer, ...(q.accepted || [])].some((a) => normalize(a) === normalize(text))

  const prev = questionStats[q.id] || { correct_count: 0, wrong_count: 0 }
  questionStats[q.id] = {
    correct_count: (prev.correct_count || 0) + (correct ? 1 : 0),
    wrong_count: (prev.wrong_count || 0) + (correct ? 0 : 1),
    last_answer_at: Date.now(),
  }
  persistQuestions()

  return {
    correct,
    answer: q.answer,
    explanation: q.explanation,
    stats: lessonStats(q.lesson),
  }
}

export async function getQuizStats(lesson) {
  await init()
  return lessonStats(Number(lesson))
}

export function exportProgress() {
  return {
    app: 'minna-nihongo',
    version: 1,
    exportedAt: new Date().toISOString(),
    words: wordProgress,
    questions: questionStats,
  }
}

export async function importProgress(payload) {
  await init()
  const w = payload?.words
  const q = payload?.questions
  if (!w || typeof w !== 'object' || Array.isArray(w) || !q || typeof q !== 'object' || Array.isArray(q)) {
    throw new Error('备份文件格式不正确')
  }
  wordProgress = w
  questionStats = q
  persistWords()
  persistQuestions()
  return { words: Object.keys(w).length, questions: Object.keys(q).length }
}

export function resetProgress() {
  wordProgress = {}
  questionStats = {}
  persistWords()
  persistQuestions()
}

export function progressSummary() {
  return {
    words: Object.keys(wordProgress).length,
    questions: Object.keys(questionStats).length,
  }
}
