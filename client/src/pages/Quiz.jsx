import React, { useCallback, useEffect, useState } from 'react'
import {
  ArrowRight,
  Check,
  ChevronRight,
  ListChecks,
  Loader2,
  RotateCcw,
  Shuffle,
  Target,
  X,
} from 'lucide-react'
import { api } from '../api.js'
import { navigate } from '../App.jsx'

const MODES = [
  { key: 'order', label: '顺序刷', icon: ListChecks },
  { key: 'random', label: '随机刷', icon: Shuffle },
  { key: 'wrong', label: '错题重刷', icon: RotateCcw },
]

const TYPES = [
  { key: 'all', label: '全部题型' },
  { key: 'choice', label: '选择题' },
  { key: 'fill', label: '填空题' },
]

const LIMITS = [10, 20, 30, 50]

export default function Quiz({ lesson, lessons, onRefresh, notify }) {
  const [mode, setMode] = useState('order')
  const [type, setType] = useState('all')
  const [limit, setLimit] = useState(20)
  const [questions, setQuestions] = useState([])
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState('')
  const [fillValue, setFillValue] = useState('')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [session, setSession] = useState({ answered: 0, correct: 0, wrongList: [] })
  const [stats, setStats] = useState(null)

  const lessonInfo = lessons.find((l) => l.n === lesson)

  const loadStats = useCallback(async () => {
    try {
      setStats(await api.quizStats(lesson))
    } catch {
      setStats(null)
    }
  }, [lesson])

  const loadQuestions = useCallback(async () => {
    setLoading(true)
    setResult(null)
    setSelected('')
    setFillValue('')
    setIndex(0)
    setSession({ answered: 0, correct: 0, wrongList: [] })
    try {
      const res = await api.questions(lesson, mode, type, limit)
      setQuestions(res.questions)
    } catch (err) {
      notify(err.message)
      setQuestions([])
    } finally {
      setLoading(false)
    }
  }, [lesson, mode, type, limit, notify])

  useEffect(() => {
    loadStats()
  }, [loadStats])

  useEffect(() => {
    loadQuestions()
  }, [loadQuestions])

  const current = questions[index]
  const finished = !loading && questions.length > 0 && index >= questions.length
  const progress = questions.length ? Math.min(100, Math.round((index / questions.length) * 100)) : 0

  async function submitAnswer(value) {
    if (!current || result || busy) return
    const response = String(value ?? '').trim()
    if (!response) return
    setBusy(true)
    try {
      const res = await api.submit(current.id, response)
      setResult({ ...res, response })
      setSession((s) => ({
        answered: s.answered + 1,
        correct: s.correct + (res.correct ? 1 : 0),
        wrongList: res.correct ? s.wrongList : [...s.wrongList, { ...current, response, answer: res.answer }],
      }))
      if (res.stats) setStats(res.stats)
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }

  function choose(option) {
    if (result) return
    setSelected(option.key)
    submitAnswer(option.text)
  }

  function next() {
    if (!result) return
    if (index + 1 >= questions.length) {
      onRefresh?.()
    }
    setResult(null)
    setSelected('')
    setFillValue('')
    setIndex((i) => i + 1)
  }

  function restart() {
    loadQuestions()
    loadStats()
    onRefresh?.()
  }

  const accuracy = session.answered ? Math.round((session.correct / session.answered) * 100) : 0

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (!current || current.type !== 'choice' || result) return
      const n = Number(e.key)
      if (n >= 1 && n <= current.options.length) choose(current.options[n - 1])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, result, busy])

  return (
    <div className="page quiz-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">PRACTICE · LESSON {lesson}</p>
          <h1>刷课后题</h1>
          <p className="page-sub">
            {lessonInfo
              ? `第 ${lesson} 课共 ${lessonInfo.question_count} 道题，已练 ${lessonInfo.practiced_questions || 0} 道。`
              : '按课次刷题，答完立即判分。'}
          </p>
        </div>
        <div className="head-actions">
          <button className="ghost-btn" onClick={() => navigate(`#/words?lesson=${lesson}`)}>
            去背本课单词 <ArrowRight size={16} />
          </button>
        </div>
      </div>

      <div className="quiz-toolbar">
        <div className="segmented">
          {MODES.map((m) => {
            const Icon = m.icon
            return (
              <button key={m.key} className={mode === m.key ? 'active' : ''} onClick={() => setMode(m.key)}>
                <Icon size={14} /> {m.label}
              </button>
            )
          })}
        </div>
        <div className="toolbar-right">
          <div className="segmented small">
            {TYPES.map((t) => (
              <button key={t.key} className={type === t.key ? 'active' : ''} onClick={() => setType(t.key)}>
                {t.label}
              </button>
            ))}
          </div>
          <select className="select" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            {LIMITS.map((n) => <option key={n} value={n}>每轮 {n} 题</option>)}
          </select>
        </div>
      </div>

      {stats && (
        <div className="quiz-stat-strip">
          <div className="qs-item">
            <span>本课累计正确率</span>
            <strong>{stats.accuracy}%</strong>
          </div>
          <div className="qs-item">
            <span>已练题目</span>
            <strong>{stats.practiced} <small>/ {stats.total}</small></strong>
          </div>
          <div className="qs-item">
            <span>累计作答</span>
            <strong>{stats.correct_answers + stats.wrong_answers} <small>次</small></strong>
          </div>
          <div className="qs-item warn">
            <span>错题数</span>
            <strong>{stats.wrong_questions}</strong>
          </div>
          <div className="qs-item">
            <span>本轮</span>
            <strong>{session.correct} <small>/ {session.answered}</small></strong>
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading-block"><Loader2 className="spin" size={18} /> 正在组题…</div>
      ) : questions.length === 0 ? (
        <div className="empty-panel">
          <ListChecks size={30} />
          <h3>{mode === 'wrong' ? '本课暂时没有错题' : '没有符合条件的题目'}</h3>
          <p>
            {mode === 'wrong'
              ? '先按顺序或随机刷一轮，答错的题会自动收集到这里，错得多的排前面。'
              : '试试切换题型，或换一课再刷。'}
          </p>
          <div className="empty-actions">
            <button className="primary-btn" onClick={() => { setMode('order'); setType('all') }}>顺序刷全部</button>
            <button className="ghost-btn" onClick={() => navigate(`#/words?lesson=${lesson}`)}>去背单词</button>
          </div>
        </div>
      ) : finished ? (
        <div className="finish-panel">
          <div className="finish-mark"><Target size={26} /></div>
          <h2>本轮完成 · {accuracy}%</h2>
          <p className="muted">第 {lesson} 课 · {MODES.find((m) => m.key === mode)?.label} · {TYPES.find((t) => t.key === type)?.label}</p>
          <div className="finish-stats">
            <div><strong>{session.correct}</strong><span>答对</span></div>
            <div><strong>{session.answered - session.correct}</strong><span>答错</span></div>
            <div><strong>{session.answered}</strong><span>本轮题数</span></div>
          </div>
          {session.wrongList.length > 0 && (
            <div className="review-list">
              <h3>本轮错题</h3>
              {session.wrongList.map((w, i) => (
                <div className="review-item" key={`${w.id}-${i}`}>
                  <div>
                    <strong>{w.prompt}</strong>
                    <span className="muted">{w.prompt_sub}</span>
                  </div>
                  <div className="review-answer">
                    <span className="bad">你的：{w.response}</span>
                    <span className="good">正确：{w.answer}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="finish-actions">
            {session.answered - session.correct > 0 && (
              <button
                className="primary-btn"
                onClick={() => {
                  if (mode === 'wrong') restart()
                  else setMode('wrong')
                }}
              >
                <RotateCcw size={16} /> 错题重刷
              </button>
            )}
            <button className="ghost-btn" onClick={restart}>再来一轮</button>
            <button className="ghost-btn" onClick={() => navigate(`#/words?lesson=${lesson}`)}>去背单词</button>
          </div>
        </div>
      ) : (
        <div className="quiz-stage">
          <div className="study-progress">
            <div className="progress-line">
              <span>第 {index + 1} / {questions.length} 题</span>
              <span className="muted">本轮答对 {session.correct} / {session.answered}</span>
            </div>
            <div className="bar"><i style={{ width: `${progress}%` }} /></div>
          </div>

          <div className={`question-card ${result ? (result.correct ? 'ok' : 'bad') : ''}`}>
            <div className="q-head">
              <span className="q-type">{current.type === 'fill' ? '填空题' : '选择题'}</span>
              <span className="pos-tag subtle">第 {lesson} 课</span>
            </div>
            <p className="q-prompt">{current.prompt}</p>
            <p className="q-sub">{current.prompt_sub}</p>

            {current.type === 'fill' ? (
              <div className="fill-row">
                <input
                  className="fill-input"
                  value={fillValue}
                  disabled={!!result}
                  placeholder="输入假名读音"
                  onChange={(e) => setFillValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitAnswer(fillValue) }}
                  autoFocus
                />
                <button className="primary-btn" disabled={!!result || !fillValue.trim() || busy} onClick={() => submitAnswer(fillValue)}>
                  提交
                </button>
              </div>
            ) : (
              <div className="option-list">
                {current.options.map((opt) => {
                  const isCorrect = result && opt.text === result.answer
                  const isPicked = selected === opt.key
                  const cls = result
                    ? isCorrect
                      ? 'correct'
                      : isPicked
                      ? 'wrong'
                      : 'dim'
                    : ''
                  return (
                    <button key={opt.key} className={`option-btn ${cls}`} disabled={!!result} onClick={() => choose(opt)}>
                      <span className="opt-key">{opt.key}</span>
                      <span className="opt-text">{opt.text}</span>
                      {isCorrect && <Check size={17} />}
                      {isPicked && !isCorrect && <X size={17} />}
                    </button>
                  )
                })}
              </div>
            )}

            {result && (
              <div className={`feedback ${result.correct ? 'ok' : 'bad'}`}>
                <div className="feedback-head">
                  {result.correct ? <Check size={18} /> : <X size={18} />}
                  <strong>{result.correct ? '回答正确' : '回答错误'}</strong>
                  {!result.correct && <span className="feedback-answer">正确答案：{result.answer}</span>}
                </div>
                {result.explanation && <p>{result.explanation}</p>}
              </div>
            )}
          </div>

          <div className="quiz-actions">
            {!result ? (
              <span className="key-hint">{current.type === 'fill' ? '输入后按 Enter 提交' : '点击选项或按 1–4 作答，立即判分'}</span>
            ) : (
              <button className="primary-btn" onClick={next}>
                {index + 1 >= questions.length ? '查看本轮结果' : '下一题'} <ChevronRight size={17} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
