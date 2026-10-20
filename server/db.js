import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const root = path.resolve(import.meta.dirname, '..')
export const DATA_DIR = path.join(root, 'data')
const dbPath = process.env.DB_PATH || path.join(DATA_DIR, 'app.db')

fs.mkdirSync(DATA_DIR, { recursive: true })
fs.mkdirSync(path.dirname(dbPath), { recursive: true })
export const db = new DatabaseSync(dbPath)

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS lessons (
  n INTEGER PRIMARY KEY,
  book INTEGER NOT NULL,
  word_count INTEGER NOT NULL DEFAULT 0,
  question_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'learner',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS words (
  id INTEGER PRIMARY KEY,
  lesson INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  kana TEXT NOT NULL,
  kanji TEXT NOT NULL DEFAULT '',
  meaning_en TEXT NOT NULL DEFAULT '',
  meaning_zh TEXT NOT NULL DEFAULT '',
  pos TEXT NOT NULL DEFAULT '名词'
);
CREATE INDEX IF NOT EXISTS idx_words_lesson ON words(lesson);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  lesson INTEGER NOT NULL,
  word_id INTEGER,
  type TEXT NOT NULL,
  prompt TEXT NOT NULL,
  prompt_sub TEXT NOT NULL DEFAULT '',
  options TEXT NOT NULL DEFAULT '[]',
  answer TEXT NOT NULL,
  accepted TEXT NOT NULL DEFAULT '[]',
  explanation TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'auto',
  ord INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_questions_lesson ON questions(lesson, ord);

CREATE TABLE IF NOT EXISTS word_progress (
  user_id INTEGER NOT NULL,
  word_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'learning',
  streak INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  wrong_count INTEGER NOT NULL DEFAULT 0,
  due_at INTEGER NOT NULL DEFAULT 0,
  last_seen_at INTEGER NOT NULL DEFAULT 0,
  last_rating TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, word_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_progress_due ON word_progress(user_id, due_at);

CREATE TABLE IF NOT EXISTS question_stats (
  user_id INTEGER NOT NULL,
  question_id TEXT NOT NULL,
  correct_count INTEGER NOT NULL DEFAULT 0,
  wrong_count INTEGER NOT NULL DEFAULT 0,
  last_answer_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, question_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  question_id TEXT NOT NULL,
  lesson INTEGER NOT NULL,
  response TEXT NOT NULL DEFAULT '',
  correct INTEGER NOT NULL DEFAULT 0,
  answered_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts_user_lesson ON quiz_attempts(user_id, lesson);
`)

const now = () => Date.now()

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return { salt, hash }
}

export function verifyPassword(password, salt, hash) {
  const candidate = crypto.scryptSync(password, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected)
}

export function createUser(username, password, role = 'learner') {
  const { salt, hash } = hashPassword(password)
  const stmt = db.prepare('INSERT INTO users (username, password_hash, salt, role, created_at) VALUES (?, ?, ?, ?, ?)')
  const info = stmt.run(username, hash, salt, role, now())
  return Number(info.lastInsertRowid)
}

export function findUserByName(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username)
}

export function findUserById(id) {
  return db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(id)
}

export function userCount() {
  return db.prepare('SELECT COUNT(*) AS c FROM users').get().c
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex')
  const created = now()
  const expires = created + 30 * 24 * 60 * 60 * 1000
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(token, userId, created, expires)
  return { token, expires }
}

export function getSession(token) {
  if (!token) return null
  const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token)
  if (!row) return null
  if (row.expires_at < now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
    return null
  }
  return row
}

export function deleteSession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

export function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM words').get().c
  if (count > 0) return { seeded: false, words: count }
  return seedDatabase()
}

export function seedDatabase({ forceQuestions = false } = {}) {
  const seedPath = path.join(DATA_DIR, 'seed.json')
  if (!fs.existsSync(seedPath)) throw new Error('缺少 data/seed.json，请先运行 npm run data:seed')
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'))

  db.exec('BEGIN')
  try {
    db.exec("DELETE FROM questions WHERE source = 'auto'")
    if (forceQuestions) db.exec('DELETE FROM questions')
    db.exec('DELETE FROM words')
    db.exec('DELETE FROM lessons')

    const insertLesson = db.prepare('INSERT INTO lessons (n, book, word_count, question_count) VALUES (?, ?, 0, 0)')
    for (const l of seed.lessons) insertLesson.run(l.n, l.book)

    const insertWord = db.prepare(
      'INSERT INTO words (id, lesson, seq, kana, kanji, meaning_en, meaning_zh, pos) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    for (const w of seed.words) {
      insertWord.run(w.id, w.lesson, w.no, w.kana, w.kanji || '', w.meaning_en || '', w.meaning_zh || '', w.pos || '名词')
    }

    const questions = buildQuestions(seed.words)
    const insertQ = db.prepare(
      `INSERT OR REPLACE INTO questions (id, lesson, word_id, type, prompt, prompt_sub, options, answer, accepted, explanation, source, ord, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'auto', ?, ?)`
    )
    const t = now()
    for (const q of questions) {
      insertQ.run(q.id, q.lesson, q.wordId, q.type, q.prompt, q.promptSub, JSON.stringify(q.options), q.answer, JSON.stringify(q.accepted), q.explanation, q.ord, t)
    }

    refreshLessonCounts()
    db.exec('COMMIT')
    return { seeded: true, words: seed.words.length, questions: questions.length }
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export function refreshLessonCounts() {
  db.exec(`
    UPDATE lessons SET
      word_count = (SELECT COUNT(*) FROM words WHERE words.lesson = lessons.n),
      question_count = (SELECT COUNT(*) FROM questions WHERE questions.lesson = lessons.n)
  `)
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

const displayWord = (w) => (w.kanji && w.kanji !== w.kana ? `${w.kanji}（${w.kana}）` : w.kana)

export function buildQuestions(words) {
  const byLesson = new Map()
  for (const w of words) {
    if (!byLesson.has(w.lesson)) byLesson.set(w.lesson, [])
    byLesson.get(w.lesson).push(w)
  }
  const all = (lesson) => {
    const pool = [...(byLesson.get(lesson) || [])]
    for (const d of [1, -1, 2, -2, 3]) {
      const arr = byLesson.get(lesson + d)
      if (arr) pool.push(...arr)
    }
    return pool
  }
  const out = []
  for (const w of words) {
    const lesson = w.lesson
    const pool = all(lesson)
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

export { displayWord, now }
