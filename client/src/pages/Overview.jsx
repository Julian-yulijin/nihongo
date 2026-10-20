import React, { useRef, useState } from 'react'
import { ArrowRight, BookOpen, Flame, RotateCcw, Target, TrendingUp } from 'lucide-react'
import { api } from '../api.js'
import { navigate } from '../App.jsx'

export default function Overview({ lessons, overview, onRefresh }) {
  const [backupMsg, setBackupMsg] = useState('')
  const fileRef = useRef(null)

  if (!lessons.length || !overview) return <div className="loading-block">正在读取学习进度…</div>

  const progress = api.progressSummary()

  function exportBackup() {
    const data = api.exportProgress()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `minna-progress-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
    setBackupMsg('备份已导出')
  }

  async function importBackup(event) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const data = JSON.parse(await file.text())
      const result = await api.importProgress(data)
      setBackupMsg(`已导入 ${result.words} 个单词、${result.questions} 道题的进度`)
      onRefresh?.()
    } catch (err) {
      setBackupMsg(err.message || '导入失败')
    } finally {
      event.target.value = ''
    }
  }

  function resetAll() {
    if (!window.confirm('确定清空本机所有学习进度？此操作不可恢复。')) return
    api.resetProgress()
    setBackupMsg('已清空本机进度')
    onRefresh?.()
  }

  const suggested = [...lessons]
    .filter((l) => l.due > 0 || l.wrong_words > 0)
    .sort((a, b) => b.due + b.wrong_words - (a.due + a.wrong_words))[0]
  const firstUntouched = lessons.find((l) => l.learned < l.word_count)
  const target = suggested || firstUntouched || lessons[0]

  const totalWords = overview.totalWords || lessons.reduce((s, l) => s + l.word_count, 0)
  const learnedPct = Math.round((overview.learned / totalWords) * 100)

  return (
    <div className="page overview">
      <section className="hero">
        <div>
          <p className="eyebrow">STUDY DASHBOARD</p>
          <h1>今天，从第 {target?.n} 课继续。</h1>
          <p className="hero-sub">
            {overview.due > 0 ? `有 ${overview.due} 个单词到了复习时间。` : '暂时没有到期的复习，先学新词吧。'}
            {overview.wrongWords > 0 ? ` 还有 ${overview.wrongWords} 个错词等你重刷。` : ''}
          </p>
          <div className="hero-actions">
            <button className="primary-btn" onClick={() => navigate(`#/words?lesson=${target?.n || 1}`)}>
              <BookOpen size={17} /> 开始背单词
            </button>
            <button className="ghost-btn" onClick={() => navigate(`#/quiz?lesson=${target?.n || 1}`)}>
              刷本课题目 <ArrowRight size={16} />
            </button>
          </div>
        </div>
        <div className="hero-seal">
          <span>{learnedPct}%</span>
          <small>总词库已学</small>
        </div>
      </section>

      <section className="stat-grid">
        <StatCard icon={BookOpen} label="已学单词" value={overview.learned} suffix={`/ ${totalWords}`} tone="indigo" />
        <StatCard icon={RotateCcw} label="待复习" value={overview.due} suffix="个" tone="amber" />
        <StatCard icon={Flame} label="错词本" value={overview.wrongWords} suffix="个" tone="rose" />
        <StatCard icon={Target} label="答题正确率" value={`${overview.accuracy}%`} suffix={`${overview.answered} 次作答`} tone="green" />
      </section>

      {[1, 2].map((book) => {
        const bookLessons = lessons.filter((l) => l.book === book)
        const bookWords = bookLessons.reduce((s, l) => s + l.word_count, 0)
        const bookLearned = bookLessons.reduce((s, l) => s + l.learned, 0)
        const pct = bookWords ? Math.round((bookLearned / bookWords) * 100) : 0
        return (
          <section className="book-panel" key={book}>
            <header className="book-head">
              <div>
                <p className="eyebrow">BOOK {book}</p>
                <h2>初级 {book === 1 ? '1' : '2'} · 第 {book === 1 ? '1–25' : '26–50'} 课</h2>
              </div>
              <div className="book-progress">
                <span><b>{bookLearned}</b> / {bookWords} 词</span>
                <div className="bar"><i style={{ width: `${pct}%` }} /></div>
                <span className="muted">{pct}%</span>
              </div>
            </header>
            <div className="lesson-grid">
              {bookLessons.map((l) => {
                const wp = l.word_count ? Math.round((l.learned / l.word_count) * 100) : 0
                const acc = l.attempts ? Math.round((l.correct_attempts / l.attempts) * 100) : null
                return (
                  <button
                    key={l.n}
                    className={`lesson-tile ${l.wrong_words ? 'warn' : ''}`}
                    onClick={() => navigate(`#/words?lesson=${l.n}`)}
                    title={`第${l.n}课：${l.word_count} 个单词 / ${l.question_count} 道题`}
                  >
                    <div className="tile-top">
                      <strong>{String(l.n).padStart(2, '0')}</strong>
                      <span className="tile-meta">{l.word_count} 词</span>
                    </div>
                    <div className="tile-bar"><i style={{ width: `${wp}%` }} /></div>
                    <div className="tile-foot">
                      <span>{wp}%</span>
                      <span className={acc === null ? 'muted' : 'acc'}>{acc === null ? '未刷题' : `${acc}%`}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}

      <section className="tip-row">
        <div className="tip-card">
          <TrendingUp size={20} />
          <div>
            <h3>间隔重复怎么安排</h3>
            <p>答“记得”后，下次复习依次为 1、2、4、7、15、30、60 天后；答“不记得”则在 10 分钟后再次出现，并计入错词本。</p>
          </div>
        </div>
        <div className="tip-card">
          <Target size={20} />
          <div>
            <h3>错题优先</h3>
            <p>刷题模式选“错题重刷”，系统按答错次数从多到少排序，先把最常错的题解决掉。</p>
          </div>
        </div>
      </section>

      <section className="backup-panel">
        <div>
          <p className="eyebrow">LOCAL DATA</p>
          <h3>本机进度备份</h3>
          <p className="muted">
            已记录 {progress.words} 个单词、{progress.questions} 道题的进度。数据只存在当前浏览器，清理浏览器数据会丢失，建议定期导出。
          </p>
          {backupMsg && <p className="backup-msg">{backupMsg}</p>}
        </div>
        <div className="backup-actions">
          <button className="ghost-btn" onClick={exportBackup}>导出备份</button>
          <button className="ghost-btn" onClick={() => fileRef.current?.click()}>导入备份</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={importBackup} />
          <button className="text-btn danger" onClick={resetAll}>清空进度</button>
        </div>
      </section>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, suffix, tone }) {
  return (
    <div className={`stat-card tone-${tone}`}>
      <span className="stat-icon"><Icon size={19} /></span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <small>{suffix}</small>
      </div>
    </div>
  )
}
