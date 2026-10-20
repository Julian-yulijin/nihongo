import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronLeft,
  RotateCcw,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react'
import { api, speak } from '../api.js'
import { navigate } from '../App.jsx'

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'due', label: '待复习' },
  { key: 'wrong', label: '错词' },
  { key: 'new', label: '未学' },
]

const INTERVALS = [1, 2, 4, 7, 15, 30, 60]

function nextIntervalText(streak) {
  const days = INTERVALS[Math.min(streak, INTERVALS.length - 1)]
  return days >= 1 ? `${days} 天后` : '稍后'
}

function formatDue(ts) {
  if (!ts) return ''
  const diff = ts - Date.now()
  if (diff <= 0) return '现在'
  const min = Math.round(diff / 60000)
  if (min < 60) return `${min} 分钟后`
  const hours = Math.round(min / 60)
  if (hours < 24) return `${hours} 小时后`
  return `${Math.round(hours / 24)} 天后`
}

export default function Words({ lesson, lessons, onRefresh, notify }) {
  const [filter, setFilter] = useState('all')
  const [words, setWords] = useState([])
  const [deck, setDeck] = useState([])
  const [pos, setPos] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ good: 0, again: 0 })
  const [lastResult, setLastResult] = useState(null)
  const [busy, setBusy] = useState(false)

  const lessonInfo = lessons.find((l) => l.n === lesson)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.words(lesson, filter)
      setWords(res.words)
      setDeck(res.words)
      setPos(0)
      setFlipped(false)
      setStats({ good: 0, again: 0 })
      setLastResult(null)
    } finally {
      setLoading(false)
    }
  }, [lesson, filter])

  useEffect(() => {
    load()
  }, [load])

  const current = deck[pos]
  const done = !loading && deck.length > 0 && pos >= deck.length
  const progress = deck.length ? Math.min(100, Math.round((pos / deck.length) * 100)) : 0

  async function rate(rating) {
    if (!current || busy) return
    setBusy(true)
    try {
      const res = await api.review(current.id, rating)
      setLastResult({ word: current, rating, res })
      setStats((s) => ({ ...s, [rating === 'good' ? 'good' : 'again']: s[rating === 'good' ? 'good' : 'again'] + 1 }))
      notify(rating === 'good' ? `记得 · ${formatDue(res.dueAt)}复习` : '不记得 · 10 分钟后再出现')

      if (rating === 'again') {
        const copy = { ...current, wrong_count: (current.wrong_count || 0) + 1, streak: 0, due_at: res.dueAt }
        setDeck((prev) => {
          const next = [...prev]
          next[pos] = copy
          const insertAt = Math.min(pos + 4, next.length)
          next.splice(insertAt, 0, copy)
          return next
        })
      }
      setPos((p) => p + 1)
      setFlipped(false)
      onRefresh?.()
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }

  const speakCurrent = useCallback(() => {
    if (!current) return
    const text = current.kanji && current.kanji !== current.kana ? current.kanji : current.kana
    if (!speak(current.kana + (text !== current.kana ? `、${text}` : ''))) notify('当前浏览器不支持日语朗读')
  }, [current, notify])

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.code === 'Space') {
        e.preventDefault()
        setFlipped((f) => !f)
      } else if (e.key === '1' && flipped) rate('again')
      else if (e.key === '2' && flipped) rate('good')
      else if (e.key === 'ArrowLeft') setPos((p) => Math.max(0, p - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flipped, current, busy])

  const filterLabel = FILTERS.find((f) => f.key === filter)?.label || '全部'
  const counts = useMemo(
    () => ({
      total: words.length,
      wrong: words.filter((w) => w.wrong_count > 0).length,
    }),
    [words]
  )

  return (
    <div className="page words-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">VOCABULARY · LESSON {lesson}</p>
          <h1>背单词</h1>
          <p className="page-sub">
            {lessonInfo ? `第 ${lesson} 课共 ${lessonInfo.word_count} 个单词，已学 ${lessonInfo.learned} 个。` : '按课次筛选，卡片翻转看答案。'}
          </p>
        </div>
        <div className="head-actions">
          <button className="ghost-btn" onClick={() => navigate(`#/quiz?lesson=${lesson}`)}>
            去刷本课题目 <ArrowRight size={16} />
          </button>
        </div>
      </div>

      <div className="study-toolbar">
        <div className="segmented">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={filter === f.key ? 'active' : ''}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              {f.key === 'wrong' && counts.wrong > 0 && <i>{counts.wrong}</i>}
            </button>
          ))}
        </div>
        <div className="deck-meta">
          <span className="muted">
            {filterLabel} · {deck.length} 张
          </span>
          <button className="text-btn" onClick={load} title="重新抽取卡片">
            <RotateCcw size={14} /> 重置
          </button>
        </div>
      </div>

      {loading ? (
        <div className="loading-block">正在取卡片…</div>
      ) : deck.length === 0 ? (
        <div className="empty-panel">
          <BookOpen size={30} />
          <h3>{filter === 'wrong' ? '本课还没有错词' : filter === 'due' ? '本课暂无到期单词' : '这一课还没有单词'}</h3>
          <p>
            {filter === 'wrong'
              ? '答“不记得”的单词会自动进入错词本，可以在这里集中复习。'
              : filter === 'due'
              ? '所有学过的单词都还在间隔期内，先去学新词吧。'
              : '换一课看看，或到后台检查数据。'}
          </p>
          <div className="empty-actions">
            <button className="primary-btn" onClick={() => setFilter('all')}>看全部单词</button>
            <button className="ghost-btn" onClick={() => setFilter('new')}>只看未学</button>
          </div>
        </div>
      ) : done ? (
        <div className="finish-panel">
          <div className="finish-mark"><Sparkles size={26} /></div>
          <h2>这一轮完成了</h2>
          <p className="muted">第 {lesson} 课 · {filterLabel}</p>
          <div className="finish-stats">
            <div><strong>{stats.good}</strong><span>记得</span></div>
            <div><strong>{stats.again}</strong><span>不记得</span></div>
            <div><strong>{deck.length}</strong><span>本轮卡片</span></div>
          </div>
          <div className="finish-actions">
            {stats.again > 0 && (
              <button
                className="primary-btn"
                onClick={() => {
                  if (filter === 'wrong') load()
                  else setFilter('wrong')
                }}
              >
                <RotateCcw size={16} /> 复习本轮错词
              </button>
            )}
            <button className="ghost-btn" onClick={load}>再来一轮</button>
            <button className="ghost-btn" onClick={() => navigate(`#/quiz?lesson=${lesson}`)}>
              去刷题 <ArrowRight size={16} />
            </button>
          </div>
        </div>
      ) : (
        <div className="study-stage">
          <div className="study-progress">
            <div className="progress-line">
              <span>第 {Math.min(pos + 1, deck.length)} / {deck.length} 张</span>
              <span className="muted">记得 {stats.good} · 不记得 {stats.again}</span>
            </div>
            <div className="bar"><i style={{ width: `${progress}%` }} /></div>
          </div>

          <div
            className={`word-card ${flipped ? 'flipped' : ''}`}
            onClick={() => setFlipped((f) => !f)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') setFlipped((f) => !f) }}
          >
            <div className="card-head">
              <span className="card-lesson">第 {lesson} 课</span>
              <span className="pos-tag">{current.pos || '名词'}</span>
            </div>

            {!flipped ? (
              <div className="card-front">
                <p className="card-kana">{current.kana}</p>
                {current.kanji && current.kanji !== current.kana && <p className="card-kanji">{current.kanji}</p>}
                <p className="flip-hint">点击卡片或按空格，查看释义</p>
              </div>
            ) : (
              <div className="card-back">
                <p className="card-meaning">{current.meaning_zh || '（暂无中文释义）'}</p>
                {current.meaning_en && <p className="card-en">{current.meaning_en}</p>}
                <div className="card-detail">
                  <span>{current.kana}</span>
                  {current.kanji && current.kanji !== current.kana && <span>{current.kanji}</span>}
                  <span className="pos-tag subtle">{current.pos}</span>
                </div>
                <div className="srs-row">
                  <span>连续记得 {current.streak || 0} 次</span>
                  <span>累计答错 {current.wrong_count || 0} 次</span>
                  {(current.due_at || 0) > 0 && <span>下次：{formatDue(current.due_at)}</span>}
                </div>
                {lastResult?.word?.id === current.id && (
                  <p className={`card-feedback ${lastResult.rating}`}>
                    {lastResult.rating === 'good'
                      ? `很好，下次 ${formatDue(lastResult.res.dueAt)} 复习`
                      : '没关系，这张卡稍后会再出现'}
                  </p>
                )}
              </div>
            )}

            <button
              className="speak-btn"
              title="日语朗读"
              onClick={(e) => { e.stopPropagation(); speakCurrent() }}
            >
              <Volume2 size={18} />
            </button>
          </div>

          <div className="rate-row">
            <button className="rate-btn again" disabled={!flipped || busy} onClick={() => rate('again')}>
              <X size={18} />
              <span>不记得</span>
              <small>10 分钟后</small>
            </button>
            <button className="rate-btn good" disabled={!flipped || busy} onClick={() => rate('good')}>
              <Check size={18} />
              <span>记得</span>
              <small>{nextIntervalText((current.streak || 0) + 1)}</small>
            </button>
          </div>
          <p className="key-hint">空格翻转 · 1 不记得 · 2 记得 · ← 上一张</p>

          {pos > 0 && (
            <button className="back-link" onClick={() => { setPos((p) => Math.max(0, p - 1)); setFlipped(false) }}>
              <ChevronLeft size={14} /> 回到上一张
            </button>
          )}
        </div>
      )}
    </div>
  )
}
