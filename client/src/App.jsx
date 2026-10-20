import React, { useEffect, useState } from 'react'
import { BookOpen, LayoutGrid, ListChecks, Sparkles } from 'lucide-react'
import { api } from './api.js'
import Overview from './pages/Overview.jsx'
import Words from './pages/Words.jsx'
import Quiz from './pages/Quiz.jsx'

function useRoute() {
  const [hash, setHash] = useState(window.location.hash || '#/overview')
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || '#/overview')
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  const raw = hash.replace(/^#/, '') || '/overview'
  const [pathname, qs] = raw.split('?')
  const query = new URLSearchParams(qs || '')
  return { pathname, query }
}

export function navigate(path) {
  window.location.hash = path
}

const NAV = [
  { key: '/overview', label: '学习总览', icon: LayoutGrid },
  { key: '/words', label: '背单词', icon: BookOpen },
  { key: '/quiz', label: '刷课后题', icon: ListChecks },
]

export default function App() {
  const { pathname, query } = useRoute()
  const [lessons, setLessons] = useState([])
  const [overview, setOverview] = useState(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  const lesson = Number(query.get('lesson') || 1)
  const view = NAV.some((item) => item.key === pathname) ? pathname : '/overview'

  const setLesson = (n) => {
    const next = new URLSearchParams(query)
    next.set('lesson', String(n))
    navigate(`${view}?${next.toString()}`)
  }

  async function refresh() {
    const [l, o] = await Promise.all([api.lessons(), api.overview()])
    setLessons(l)
    setOverview(o)
  }

  useEffect(() => {
    let alive = true
    api
      .init()
      .then(() => refresh())
      .catch((err) => alive && setError(err.message || '数据加载失败'))
      .finally(() => alive && setReady(true))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 2400)
    return () => clearTimeout(timer)
  }, [toast])

  if (!ready) {
    return (
      <div className="splash">
        <div className="splash-mark">五十</div>
        <p>正在装载五十课…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="splash">
        <div className="splash-mark">!</div>
        <p>{error}</p>
        <button className="primary-btn" onClick={() => window.location.reload()}>重新加载</button>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <button className="brand" onClick={() => navigate('#/overview')}>
            <span className="brand-seal">五十</span>
            <span className="brand-text">
              <strong>みんなの日本語</strong>
              <small>大家的日语 · 初级 1 · 2</small>
            </span>
          </button>
          <nav className="nav">
            {NAV.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.key}
                  className={`nav-item ${view === item.key ? 'active' : ''}`}
                  onClick={() =>
                    navigate(`${item.key}${item.key === '/words' || item.key === '/quiz' ? `?lesson=${lesson}` : ''}`)
                  }
                >
                  <Icon size={17} strokeWidth={1.8} />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </nav>
          <div className="topbar-right">
            {overview && (
              <div className="top-stats">
                <span className="top-stat">
                  <em>{overview.due}</em> 待复习
                </span>
                <span className="top-stat">
                  <em>{overview.accuracy}%</em> 正确率
                </span>
              </div>
            )}
            <div className="user-chip" title="学习进度保存在当前浏览器">
              <span className="user-dot" />
              <span>本机模式</span>
            </div>
          </div>
        </div>
      </header>

      <LessonBar lesson={lesson} setLesson={setLesson} lessons={lessons} />

      <main className="main">
        {view === '/overview' && <Overview lessons={lessons} overview={overview} onRefresh={refresh} />}
        {view === '/words' && (
          <Words lesson={lesson} lessons={lessons} onRefresh={refresh} notify={setToast} />
        )}
        {view === '/quiz' && (
          <Quiz lesson={lesson} lessons={lessons} onRefresh={refresh} notify={setToast} />
        )}
      </main>

      <footer className="footer">
        <span>
          <Sparkles size={13} /> 单词与题目覆盖第 1–50 课 · 进度保存在本机浏览器
        </span>
      </footer>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function LessonBar({ lesson, setLesson, lessons }) {
  const book = lesson <= 25 ? 1 : 2
  const list = lessons.filter((l) => l.book === book)
  const current = lessons.find((l) => l.n === lesson)
  const percent = current && current.word_count ? Math.round((current.learned / current.word_count) * 100) : 0

  return (
    <div className="lessonbar">
      <div className="lessonbar-inner">
        <div className="book-switch">
          <button className={book === 1 ? 'active' : ''} onClick={() => setLesson(1)}>
            第 1 册 <small>1–25</small>
          </button>
          <button className={book === 2 ? 'active' : ''} onClick={() => setLesson(26)}>
            第 2 册 <small>26–50</small>
          </button>
        </div>
        <div className="lesson-strip">
          {list.map((l) => (
            <button
              key={l.n}
              className={`lesson-pill ${l.n === lesson ? 'active' : ''} ${l.wrong_words ? 'has-wrong' : ''}`}
              onClick={() => setLesson(l.n)}
              title={`第${l.n}课 · ${l.word_count} 词 · ${l.question_count} 题`}
            >
              {l.n}
              {l.wrong_words > 0 && <i className="dot" />}
            </button>
          ))}
        </div>
        <div className="lesson-progress">
          <span className="lesson-title">第 {lesson} 课</span>
          <span className="muted">
            已学 {current?.learned || 0}/{current?.word_count || 0}
          </span>
          <div className="mini-bar">
            <i style={{ width: `${percent}%` }} />
          </div>
        </div>
      </div>
    </div>
  )
}
