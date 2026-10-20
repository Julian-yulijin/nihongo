import path from 'node:path'
import fs from 'node:fs'
import express from 'express'
import {
  db,
  seedIfEmpty,
  seedDatabase,
  createUser,
  findUserByName,
  findUserById,
  userCount,
  verifyPassword,
  createSession,
  getSession,
  deleteSession,
  now,
} from './db.js'

const root = path.resolve(import.meta.dirname, '..')
const app = express()
const PORT = Number(process.env.PORT || 3001)

app.use(express.json({ limit: '4mb' }))

const seedResult = seedIfEmpty()
console.log('[seed]', seedResult)

const SESSION_COOKIE = 'sid'

function parseCookies(header = '') {
  const out = {}
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim())
  }
  return out
}

app.use((req, res, next) => {
  const cookies = parseCookies(req.headers.cookie)
  const session = getSession(cookies[SESSION_COOKIE])
  if (session) {
    req.user = findUserById(session.user_id)
    req.sessionToken = cookies[SESSION_COOKIE]
  }
  next()
})

const requireAuth = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: '请先登录' })
  next()
}
const requireAdmin = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: '请先登录' })
  if (req.user.role !== 'admin') return res.status(403).json({ error: '需要管理员权限' })
  next()
}

function setSessionCookie(res, token, expires) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expires).toUTCString()}`
  )
}

/* ------------------------------- auth ------------------------------- */

app.post('/api/auth/register', (req, res) => {
  const username = String(req.body?.username || '').trim()
  const password = String(req.body?.password || '')
  if (!/^[\w\u4e00-\u9fa5.-]{2,24}$/.test(username)) return res.status(400).json({ error: '用户名需为 2-24 位字母、数字、下划线或中文' })
  if (password.length < 6) return res.status(400).json({ error: '密码至少 6 位' })
  if (findUserByName(username)) return res.status(409).json({ error: '用户名已存在' })
  const role = userCount() === 0 ? 'admin' : 'learner'
  const id = createUser(username, password, role)
  const { token, expires } = createSession(id)
  setSessionCookie(res, token, expires)
  res.json({ user: findUserById(id) })
})

app.post('/api/auth/login', (req, res) => {
  const username = String(req.body?.username || '').trim()
  const password = String(req.body?.password || '')
  const user = findUserByName(username)
  if (!user || !verifyPassword(password, user.salt, user.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' })
  }
  const { token, expires } = createSession(user.id)
  setSessionCookie(res, token, expires)
  res.json({ user: { id: user.id, username: user.username, role: user.role } })
})

app.post('/api/auth/logout', (req, res) => {
  deleteSession(req.sessionToken)
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
  res.json({ ok: true })
})

app.get('/api/auth/me', (req, res) => {
  res.json({ user: req.user || null })
})

/* ------------------------------ lessons ----------------------------- */

app.get('/api/lessons', requireAuth, (req, res) => {
  const uid = req.user.id
  const t = now()
  const rows = db
    .prepare(
      `SELECT l.n, l.book, l.word_count, l.question_count,
        (SELECT COUNT(*) FROM word_progress p JOIN words w ON w.id = p.word_id
          WHERE w.lesson = l.n AND p.user_id = ? AND p.streak > 0) AS learned,
        (SELECT COUNT(*) FROM word_progress p JOIN words w ON w.id = p.word_id
          WHERE w.lesson = l.n AND p.user_id = ? AND p.streak = 0 AND p.last_seen_at > 0) AS learning,
        (SELECT COUNT(*) FROM word_progress p JOIN words w ON w.id = p.word_id
          WHERE w.lesson = l.n AND p.user_id = ? AND p.due_at <= ? AND p.last_seen_at > 0) AS due,
        (SELECT COUNT(*) FROM word_progress p JOIN words w ON w.id = p.word_id
          WHERE w.lesson = l.n AND p.user_id = ? AND p.wrong_count > 0) AS wrong_words,
        (SELECT COUNT(*) FROM word_progress p JOIN words w ON w.id = p.word_id
          WHERE w.lesson = l.n AND p.user_id = ? AND p.wrong_count > 0 AND p.streak = 0) AS weak_words,
        (SELECT COUNT(*) FROM quiz_attempts a WHERE a.user_id = ? AND a.lesson = l.n) AS attempts,
        (SELECT COUNT(*) FROM quiz_attempts a WHERE a.user_id = ? AND a.lesson = l.n AND a.correct = 1) AS correct_attempts,
        (SELECT COUNT(*) FROM question_stats s JOIN questions q ON q.id = s.question_id
          WHERE s.user_id = ? AND q.lesson = l.n AND s.wrong_count > 0) AS wrong_questions,
        (SELECT COUNT(*) FROM question_stats s JOIN questions q ON q.id = s.question_id
          WHERE s.user_id = ? AND q.lesson = l.n) AS practiced_questions
       FROM lessons l ORDER BY l.n`
    )
    .all(uid, uid, uid, t, uid, uid, uid, uid, uid, uid)
  res.json({ lessons: rows })
})

app.get('/api/overview', requireAuth, (req, res) => {
  const uid = req.user.id
  const t = now()
  const due = db
    .prepare(
      `SELECT COUNT(*) AS c FROM word_progress WHERE user_id = ? AND due_at <= ? AND last_seen_at > 0`
    )
    .get(uid, t).c
  const wrongWords = db.prepare('SELECT COUNT(*) AS c FROM word_progress WHERE user_id = ? AND wrong_count > 0').get(uid).c
  const learned = db.prepare('SELECT COUNT(*) AS c FROM word_progress WHERE user_id = ? AND streak > 0').get(uid).c
  const seen = db.prepare('SELECT COUNT(*) AS c FROM word_progress WHERE user_id = ? AND last_seen_at > 0').get(uid).c
  const totalWords = db.prepare('SELECT COUNT(*) AS c FROM words').get().c
  const attempts = db.prepare('SELECT COUNT(*) AS c, SUM(correct) AS ok FROM quiz_attempts WHERE user_id = ?').get(uid)
  const wrongQuestions = db
    .prepare('SELECT COUNT(*) AS c FROM question_stats WHERE user_id = ? AND wrong_count > 0')
    .get(uid).c
  res.json({
    due,
    wrongWords,
    learned,
    seen,
    totalWords,
    answered: attempts.c || 0,
    accuracy: attempts.c ? Math.round(((attempts.ok || 0) / attempts.c) * 100) : 0,
    wrongQuestions,
  })
})

/* ------------------------------- words ------------------------------ */

app.get('/api/lessons/:lesson/words', requireAuth, (req, res) => {
  const lesson = Number(req.params.lesson)
  const filter = String(req.query.filter || 'all')
  const uid = req.user.id
  const t = now()
  let rows = db
    .prepare(
      `SELECT w.id, w.lesson, w.seq, w.kana, w.kanji, w.meaning_en, w.meaning_zh, w.pos,
        p.status, p.streak, p.lapses, p.correct_count, p.wrong_count, p.due_at, p.last_seen_at, p.last_rating
       FROM words w
       LEFT JOIN word_progress p ON p.word_id = w.id AND p.user_id = ?
       WHERE w.lesson = ? ORDER BY w.seq`
    )
    .all(uid, lesson)
  if (filter === 'due') {
    rows = rows.filter((r) => r.last_seen_at && r.due_at <= t)
  } else if (filter === 'wrong') {
    rows = rows.filter((r) => r.wrong_count > 0)
  } else if (filter === 'new') {
    rows = rows.filter((r) => !r.last_seen_at)
  }
  res.json({ lesson, words: rows.map((r) => ({ ...r, due_at: r.due_at || 0, wrong_count: r.wrong_count || 0 })) })
})

app.post('/api/words/:id/review', requireAuth, (req, res) => {
  const wordId = Number(req.params.id)
  const rating = req.body?.rating === 'again' ? 'again' : 'good'
  const uid = req.user.id
  const t = now()
  const word = db.prepare('SELECT id, lesson FROM words WHERE id = ?').get(wordId)
  if (!word) return res.status(404).json({ error: '单词不存在' })

  const prev = db.prepare('SELECT * FROM word_progress WHERE user_id = ? AND word_id = ?').get(uid, wordId) || {
    streak: 0,
    lapses: 0,
    correct_count: 0,
    wrong_count: 0,
  }

  let streak = prev.streak
  let lapses = prev.lapses
  let correct = prev.correct_count
  let wrong = prev.wrong_count
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
    const days = [1, 2, 4, 7, 15, 30, 60][Math.min(streak - 1, 6)]
    due = t + days * 24 * 60 * 60 * 1000
    status = streak >= 2 ? 'review' : 'learning'
  }

  db.prepare(
    `INSERT INTO word_progress (user_id, word_id, status, streak, lapses, correct_count, wrong_count, due_at, last_seen_at, last_rating)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, word_id) DO UPDATE SET
       status = excluded.status, streak = excluded.streak, lapses = excluded.lapses,
       correct_count = excluded.correct_count, wrong_count = excluded.wrong_count,
       due_at = excluded.due_at, last_seen_at = excluded.last_seen_at, last_rating = excluded.last_rating`
  ).run(uid, wordId, status, streak, lapses, correct, wrong, due, t, rating)

  res.json({ wordId, status, streak, lapses, correctCount: correct, wrongCount: wrong, dueAt: due, rating })
})

/* -------------------------------- quiz ------------------------------ */

app.get('/api/quiz/questions', requireAuth, (req, res) => {
  const lesson = Number(req.query.lesson || 1)
  const mode = String(req.query.mode || 'order')
  const type = String(req.query.type || 'all')
  const limit = Math.min(Number(req.query.limit || 30), 100)
  const uid = req.user.id

  let sql = `SELECT q.id, q.lesson, q.type, q.prompt, q.prompt_sub, q.options, q.ord
             FROM questions q`
  const params = []
  if (mode === 'wrong') {
    sql += ` JOIN question_stats s ON s.question_id = q.id AND s.user_id = ?`
    params.push(uid)
  }
  sql += ` WHERE q.lesson = ?`
  params.push(lesson)
  if (type === 'choice') sql += ` AND q.type = 'choice'`
  if (type === 'fill') sql += ` AND q.type = 'fill'`

  if (mode === 'wrong') sql += ` AND s.wrong_count > 0 ORDER BY s.wrong_count DESC, s.last_answer_at ASC`
  else if (mode === 'random') sql += ` ORDER BY RANDOM()`
  else sql += ` ORDER BY q.ord`

  sql += ` LIMIT ?`
  params.push(limit)

  const rows = db.prepare(sql).all(...params)
  res.json({
    lesson,
    mode,
    questions: rows.map((r) => ({ ...r, options: JSON.parse(r.options || '[]') })),
  })
})

function normalize(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[・、。，,.]/g, '')
    .trim()
}

app.post('/api/quiz/submit', requireAuth, (req, res) => {
  const questionId = String(req.body?.questionId || '')
  const response = String(req.body?.response ?? '')
  const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(questionId)
  if (!q) return res.status(404).json({ error: '题目不存在' })

  const accepted = JSON.parse(q.accepted || '[]')
  let correct = false
  if (q.type === 'choice') {
    correct = normalize(response) === normalize(q.answer) || accepted.some((a) => normalize(a) === normalize(response))
  } else {
    correct = [q.answer, ...accepted].some((a) => normalize(a) === normalize(response))
  }

  const uid = req.user.id
  const t = now()
  db.prepare(
    `INSERT INTO question_stats (user_id, question_id, correct_count, wrong_count, last_answer_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, question_id) DO UPDATE SET
       correct_count = correct_count + excluded.correct_count,
       wrong_count = wrong_count + excluded.wrong_count,
       last_answer_at = excluded.last_answer_at`
  ).run(uid, questionId, correct ? 1 : 0, correct ? 0 : 1, t)

  db.prepare(
    'INSERT INTO quiz_attempts (user_id, question_id, lesson, response, correct, answered_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(uid, questionId, q.lesson, response, correct ? 1 : 0, t)

  const stats = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM questions WHERE lesson = ?) AS total,
        (SELECT COUNT(*) FROM question_stats s JOIN questions q2 ON q2.id = s.question_id
          WHERE s.user_id = ? AND q2.lesson = ?) AS practiced,
        (SELECT COALESCE(SUM(s.correct_count), 0) FROM question_stats s JOIN questions q2 ON q2.id = s.question_id
          WHERE s.user_id = ? AND q2.lesson = ?) AS correct_answers,
        (SELECT COALESCE(SUM(s.wrong_count), 0) FROM question_stats s JOIN questions q2 ON q2.id = s.question_id
          WHERE s.user_id = ? AND q2.lesson = ?) AS wrong_answers,
        (SELECT COUNT(*) FROM question_stats s JOIN questions q2 ON q2.id = s.question_id
          WHERE s.user_id = ? AND q2.lesson = ? AND s.wrong_count > 0) AS wrong_questions`
    )
    .get(lesson(q), uid, lesson(q), uid, lesson(q), uid, lesson(q), uid, lesson(q))

  const totalAnswers = stats.correct_answers + stats.wrong_answers
  res.json({
    correct,
    answer: q.answer,
    explanation: q.explanation,
    stats: {
      ...stats,
      accuracy: totalAnswers ? Math.round((stats.correct_answers / totalAnswers) * 100) : 0,
    },
  })
})

const lesson = (q) => q.lesson

app.get('/api/quiz/stats', requireAuth, (req, res) => {
  const lessonN = Number(req.query.lesson || 1)
  const uid = req.user.id
  const stats = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM questions WHERE lesson = ?) AS total,
        (SELECT COUNT(*) FROM questions WHERE lesson = ? AND type = 'choice') AS choice_total,
        (SELECT COUNT(*) FROM questions WHERE lesson = ? AND type = 'fill') AS fill_total,
        (SELECT COUNT(*) FROM question_stats s JOIN questions q2 ON q2.id = s.question_id
          WHERE s.user_id = ? AND q2.lesson = ?) AS practiced,
        (SELECT COALESCE(SUM(s.correct_count), 0) FROM question_stats s JOIN questions q2 ON q2.id = s.question_id
          WHERE s.user_id = ? AND q2.lesson = ?) AS correct_answers,
        (SELECT COALESCE(SUM(s.wrong_count), 0) FROM question_stats s JOIN questions q2 ON q2.id = s.question_id
          WHERE s.user_id = ? AND q2.lesson = ?) AS wrong_answers,
        (SELECT COUNT(*) FROM question_stats s JOIN questions q2 ON q2.id = s.question_id
          WHERE s.user_id = ? AND q2.lesson = ? AND s.wrong_count > 0) AS wrong_questions`
    )
    .get(lessonN, lessonN, lessonN, uid, lessonN, uid, lessonN, uid, lessonN, uid, lessonN)
  const totalAnswers = stats.correct_answers + stats.wrong_answers
  res.json({ ...stats, accuracy: totalAnswers ? Math.round((stats.correct_answers / totalAnswers) * 100) : 0 })
})

/* ------------------------------- admin ------------------------------ */

app.get('/api/admin/words', requireAdmin, (req, res) => {
  const lesson = String(req.query.lesson || 'all')
  const q = String(req.query.q || '').trim()
  const missing = String(req.query.missing || '') === '1'
  const limit = Math.min(Number(req.query.limit || 50), 200)
  const offset = Math.max(Number(req.query.offset || 0), 0)

  const where = []
  const params = []
  if (lesson !== 'all') {
    where.push('lesson = ?')
    params.push(Number(lesson))
  }
  if (q) {
    where.push('(kana LIKE ? OR kanji LIKE ? OR meaning_zh LIKE ? OR meaning_en LIKE ?)')
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`)
  }
  if (missing) where.push("(meaning_zh = '' OR meaning_zh IS NULL)")
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : ''
  const total = db.prepare(`SELECT COUNT(*) AS c FROM words ${clause}`).get(...params).c
  const rows = db
    .prepare(`SELECT * FROM words ${clause} ORDER BY lesson, seq LIMIT ? OFFSET ?`)
    .all(...params, limit, offset)
  res.json({ total, words: rows })
})

app.patch('/api/admin/words/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id)
  const current = db.prepare('SELECT * FROM words WHERE id = ?').get(id)
  if (!current) return res.status(404).json({ error: '单词不存在' })
  const meaningZh = req.body?.meaning_zh ?? current.meaning_zh
  const pos = req.body?.pos ?? current.pos
  const kana = req.body?.kana ?? current.kana
  const kanji = req.body?.kanji ?? current.kanji
  db.prepare('UPDATE words SET meaning_zh = ?, pos = ?, kana = ?, kanji = ? WHERE id = ?').run(
    String(meaningZh).trim(),
    String(pos).trim() || '名词',
    String(kana).trim(),
    String(kanji).trim(),
    id
  )
  res.json({ word: db.prepare('SELECT * FROM words WHERE id = ?').get(id) })
})

app.get('/api/admin/questions', requireAdmin, (req, res) => {
  const lessonN = Number(req.query.lesson || 1)
  const source = String(req.query.source || 'all')
  const limit = Math.min(Number(req.query.limit || 50), 200)
  const offset = Math.max(Number(req.query.offset || 0), 0)
  const clause = source === 'all' ? 'WHERE lesson = ?' : 'WHERE lesson = ? AND source = ?'
  const params = source === 'all' ? [lessonN] : [lessonN, source]
  const total = db.prepare(`SELECT COUNT(*) AS c FROM questions ${clause}`).get(...params).c
  const rows = db
    .prepare(`SELECT * FROM questions ${clause} ORDER BY ord, id LIMIT ? OFFSET ?`)
    .all(...params, limit, offset)
  res.json({ total, questions: rows.map((r) => ({ ...r, options: JSON.parse(r.options || '[]'), accepted: JSON.parse(r.accepted || '[]') })) })
})

app.post('/api/admin/questions/import', requireAdmin, (req, res) => {
  const list = Array.isArray(req.body) ? req.body : req.body?.questions
  if (!Array.isArray(list) || list.length === 0) return res.status(400).json({ error: '请提供题目数组' })
  const inserted = []
  const errors = []
  const t = now()
  const insert = db.prepare(
    `INSERT OR REPLACE INTO questions (id, lesson, word_id, type, prompt, prompt_sub, options, answer, accepted, explanation, source, ord, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)`
  )
  db.exec('BEGIN')
  try {
    list.forEach((item, i) => {
      const lessonN = Number(item.lesson)
      const type = item.type === 'fill' ? 'fill' : 'choice'
      const prompt = String(item.prompt || '').trim()
      const answer = String(item.answer || '').trim()
      if (!lessonN || lessonN < 1 || lessonN > 50) return errors.push({ index: i, error: 'lesson 需为 1-50' })
      if (!prompt) return errors.push({ index: i, error: 'prompt 不能为空' })
      if (!answer) return errors.push({ index: i, error: 'answer 不能为空' })
      let options = item.options || []
      if (type === 'choice') {
        options = options.map((o, k) =>
          typeof o === 'string' ? { key: String.fromCharCode(65 + k), text: o } : { key: o.key || String.fromCharCode(65 + k), text: String(o.text || '') }
        )
        if (options.length < 2) return errors.push({ index: i, error: '选择题至少需要 2 个选项' })
      }
      const id = String(item.id || `manual-${lessonN}-${t}-${i}`)
      const accepted = Array.isArray(item.accepted) ? item.accepted.map(String) : [answer]
      insert.run(
        id,
        lessonN,
        item.wordId ?? null,
        type,
        prompt,
        String(item.promptSub || item.prompt_sub || '').trim(),
        JSON.stringify(options),
        answer,
        JSON.stringify(accepted),
        String(item.explanation || '').trim(),
        1_000_000 + i,
        t
      )
      inserted.push(id)
    })
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    return res.status(500).json({ error: '导入失败：' + e.message })
  }
  refreshCounts()
  res.json({ imported: inserted.length, errors })
})

app.delete('/api/admin/questions/:id', requireAdmin, (req, res) => {
  const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(req.params.id)
  if (!q) return res.status(404).json({ error: '题目不存在' })
  if (q.source !== 'manual') return res.status(400).json({ error: '只能删除手动导入的题目' })
  db.prepare('DELETE FROM questions WHERE id = ?').run(req.params.id)
  refreshCounts()
  res.json({ ok: true })
})

function refreshCounts() {
  db.exec(`
    UPDATE lessons SET
      word_count = (SELECT COUNT(*) FROM words WHERE words.lesson = lessons.n),
      question_count = (SELECT COUNT(*) FROM questions WHERE questions.lesson = lessons.n)
  `)
}

app.get('/api/admin/summary', requireAdmin, (req, res) => {
  const missing = db.prepare("SELECT COUNT(*) AS c FROM words WHERE meaning_zh = '' OR meaning_zh IS NULL").get().c
  const auto = db.prepare("SELECT COUNT(*) AS c FROM questions WHERE source = 'auto'").get().c
  const manual = db.prepare("SELECT COUNT(*) AS c FROM questions WHERE source = 'manual'").get().c
  const users = db.prepare('SELECT COUNT(*) AS c FROM users').get().c
  res.json({ missingZh: missing, autoQuestions: auto, manualQuestions: manual, users })
})

app.post('/api/admin/reseed', requireAdmin, (req, res) => {
  const result = seedDatabase({ forceQuestions: req.body?.forceQuestions === true })
  res.json(result)
})

/* ------------------------------- static ----------------------------- */

app.get('/api/health', (req, res) => {
  const words = db.prepare('SELECT COUNT(*) AS c FROM words').get().c
  const questions = db.prepare('SELECT COUNT(*) AS c FROM questions').get().c
  res.json({ ok: true, words, questions, uptime: Math.round(process.uptime()) })
})

const dist = path.join(root, 'client', 'dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not Found' })
    res.sendFile(path.join(dist, 'index.html'))
  })
} else {
  app.get('/', (req, res) => res.send('前端尚未构建，请运行 npm run build，或使用 npm run dev 启动开发服务器。'))
}

app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ error: err.message || '服务器错误' })
})

app.listen(PORT, () => {
  console.log(`Minna no Nihongo app server: http://localhost:${PORT}`)
})
