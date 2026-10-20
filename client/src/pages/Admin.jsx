import React, { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Download,
  FileText,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Upload,
} from 'lucide-react'
import { api } from '../api.js'

const TABS = [
  { key: 'words', label: '释义补录', icon: FileText },
  { key: 'import', label: '题库导入', icon: Upload },
  { key: 'questions', label: '题目管理', icon: Database },
]

const POS_OPTIONS = ['名词', '动词', '形容词', '形容动词', '寒暄语', '接尾词', '副词', '连词', '其他']

const IMPORT_SAMPLE = `[
  {
    "lesson": 1,
    "type": "choice",
    "prompt": "私は学生です。",
    "promptSub": "选择正确的中文意思",
    "options": ["我是学生", "你是学生", "他是学生", "她是学生"],
    "answer": "我是学生",
    "explanation": "「私は学生です」意为“我是学生”。"
  },
  {
    "lesson": 1,
    "type": "fill",
    "prompt": "学生",
    "promptSub": "填写假名读音",
    "answer": "がくせい",
    "accepted": ["がくせい"],
    "explanation": "「学生」读作「がくせい」。"
  }
]`

export default function Admin({ lessons, notify, onRefresh }) {
  const [tab, setTab] = useState('words')
  const [summary, setSummary] = useState(null)

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await api.adminSummary())
    } catch (err) {
      notify(err.message)
    }
  }, [notify])

  useEffect(() => {
    loadSummary()
  }, [loadSummary])

  return (
    <div className="page admin-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">CONTENT ADMIN</p>
          <h1>后台管理</h1>
          <p className="page-sub">补录中文释义、导入真实课后题、查看题库状态。</p>
        </div>
        <div className="head-actions">
          <button
            className="ghost-btn"
            onClick={async () => {
              if (!window.confirm('重建所有单词与自动生成的题目？手动导入的题目会保留。')) return
              try {
                const res = await api.adminReseed(false)
                notify(`已重建：${res.words} 个单词 / ${res.questions} 道自动题`)
                loadSummary()
                onRefresh?.()
              } catch (err) {
                notify(err.message)
              }
            }}
          >
            <RefreshCw size={15} /> 重建数据
          </button>
        </div>
      </div>

      {summary && (
        <div className="admin-summary">
          <div><span>单词总数</span><strong>2156</strong></div>
          <div><span>待补中文释义</span><strong className={summary.missingZh ? 'warn-text' : ''}>{summary.missingZh}</strong></div>
          <div><span>自动生成题</span><strong>{summary.autoQuestions}</strong></div>
          <div><span>手动导入题</span><strong>{summary.manualQuestions}</strong></div>
          <div><span>账号数</span><strong>{summary.users}</strong></div>
        </div>
      )}

      <div className="segmented admin-tabs">
        {TABS.map((t) => {
          const Icon = t.icon
          return (
            <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
              <Icon size={15} /> {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'words' && <WordEditor lessons={lessons} notify={notify} onChanged={loadSummary} />}
      {tab === 'import' && <QuestionImporter lessons={lessons} notify={notify} onChanged={loadSummary} onRefresh={onRefresh} />}
      {tab === 'questions' && <QuestionManager lessons={lessons} notify={notify} onChanged={loadSummary} />}
    </div>
  )
}

function WordEditor({ lessons, notify, onChanged }) {
  const [lesson, setLesson] = useState('all')
  const [q, setQ] = useState('')
  const [missing, setMissing] = useState(false)
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState({ total: 0, words: [] })
  const [loading, setLoading] = useState(true)
  const [edits, setEdits] = useState({})
  const [saving, setSaving] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.adminWords({ lesson, q, missing: missing ? 1 : 0, limit: 50, offset })
      setData(res)
      setEdits({})
    } catch (err) {
      notify(err.message)
    } finally {
      setLoading(false)
    }
  }, [lesson, q, missing, offset, notify])

  useEffect(() => {
    load()
  }, [load])

  function edit(id, field, value) {
    setEdits((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), [field]: value } }))
  }

  async function save(word) {
    const patch = edits[word.id] || {}
    setSaving(word.id)
    try {
      const res = await api.adminSaveWord(word.id, {
        meaning_zh: patch.meaning_zh ?? word.meaning_zh,
        pos: patch.pos ?? word.pos,
      })
      setData((d) => ({ ...d, words: d.words.map((w) => (w.id === word.id ? res.word : w)) }))
      setEdits((prev) => {
        const next = { ...prev }
        delete next[word.id]
        return next
      })
      notify(`已保存：${res.word.kanji || res.word.kana}`)
      onChanged?.()
    } catch (err) {
      notify(err.message)
    } finally {
      setSaving('')
    }
  }

  return (
    <div className="admin-panel">
      <div className="admin-filter">
        <select className="select" value={lesson} onChange={(e) => { setLesson(e.target.value); setOffset(0) }}>
          <option value="all">全部课次</option>
          {lessons.map((l) => <option key={l.n} value={l.n}>第 {l.n} 课</option>)}
        </select>
        <div className="search-box">
          <Search size={15} />
          <input
            value={q}
            placeholder="搜索假名 / 汉字 / 释义"
            onChange={(e) => { setQ(e.target.value); setOffset(0) }}
          />
        </div>
        <label className="check-label">
          <input type="checkbox" checked={missing} onChange={(e) => { setMissing(e.target.checked); setOffset(0) }} />
          只看缺中文释义
        </label>
        <span className="muted">共 {data.total} 条</span>
      </div>

      {loading ? (
        <div className="loading-block">正在读取单词…</div>
      ) : data.words.length === 0 ? (
        <div className="empty-panel slim"><p>没有符合条件的单词。</p></div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>课次</th>
                <th>假名</th>
                <th>汉字</th>
                <th>英文释义</th>
                <th style={{ width: 220 }}>中文释义</th>
                <th style={{ width: 110 }}>词性</th>
                <th style={{ width: 70 }}></th>
              </tr>
            </thead>
            <tbody>
              {data.words.map((w) => {
                const patch = edits[w.id] || {}
                const dirty = Object.keys(patch).length > 0
                return (
                  <tr key={w.id} className={dirty ? 'dirty' : ''}>
                    <td className="mono">{w.lesson}</td>
                    <td>{w.kana}</td>
                    <td>{w.kanji}</td>
                    <td className="muted ellipsis" title={w.meaning_en}>{w.meaning_en}</td>
                    <td>
                      <input
                        className="cell-input"
                        value={patch.meaning_zh ?? w.meaning_zh}
                        placeholder="补录中文释义"
                        onChange={(e) => edit(w.id, 'meaning_zh', e.target.value)}
                      />
                    </td>
                    <td>
                      <select
                        className="cell-input"
                        value={patch.pos ?? w.pos}
                        onChange={(e) => edit(w.id, 'pos', e.target.value)}
                      >
                        {[...new Set([w.pos, ...POS_OPTIONS])].map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </td>
                    <td>
                      <button className="icon-btn" disabled={!dirty || saving === w.id} onClick={() => save(w)} title="保存">
                        <Save size={15} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Pager total={data.total} offset={offset} setOffset={setOffset} />
    </div>
  )
}

function QuestionImporter({ lessons, notify, onChanged, onRefresh }) {
  const [text, setText] = useState('')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      notify('JSON 格式有误，请检查')
      return
    }
    const list = Array.isArray(parsed) ? parsed : parsed.questions
    if (!Array.isArray(list) || !list.length) {
      notify('请提供题目数组')
      return
    }
    setBusy(true)
    try {
      const res = await api.adminImport(list)
      setResult(res)
      notify(`已导入 ${res.imported} 道题`)
      onChanged?.()
      onRefresh?.()
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="admin-panel">
      <div className="import-head">
        <div>
          <h2>导入真实课后题</h2>
          <p className="muted">
            粘贴 JSON 数组。选择题需提供 options；填空题提供 answer，可选 accepted 接受多个写法。缺少的字段会自动补默认值。
          </p>
        </div>
        <button className="ghost-btn" onClick={() => setText(IMPORT_SAMPLE)}>
          <Download size={15} /> 填入示例
        </button>
      </div>

      <div className="field-row">
        <label className="field">
          课次范围
          <span className="muted">在 JSON 中为每道题指定 lesson（1–50）</span>
        </label>
        <div className="lesson-mini-list">
          {lessons.map((l) => <span key={l.n} className="mini-tag">第{l.n}课</span>)}
        </div>
      </div>

      <textarea
        className="code-area"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={IMPORT_SAMPLE}
        spellCheck={false}
      />

      <div className="import-actions">
        <button className="primary-btn" disabled={busy || !text.trim()} onClick={submit}>
          <Upload size={16} /> {busy ? '导入中…' : '导入题目'}
        </button>
        <button className="ghost-btn" onClick={() => { setText(''); setResult(null) }}>清空</button>
      </div>

      {result && (
        <div className="import-result">
          <div className="ok-line"><CheckCircle2 size={16} /> 成功导入 {result.imported} 道题</div>
          {result.errors?.length > 0 && (
            <div className="err-list">
              <p><AlertCircle size={15} /> {result.errors.length} 条未导入：</p>
              {result.errors.map((e, i) => (
                <div key={i} className="err-item">第 {e.index + 1} 项：{e.error}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function QuestionManager({ lessons, notify, onChanged }) {
  const [lesson, setLesson] = useState(1)
  const [source, setSource] = useState('all')
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState({ total: 0, questions: [] })
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await api.adminQuestions({ lesson, source, limit: 50, offset }))
    } catch (err) {
      notify(err.message)
    } finally {
      setLoading(false)
    }
  }, [lesson, source, offset, notify])

  useEffect(() => {
    load()
  }, [load])

  async function remove(q) {
    if (!window.confirm('删除这道手动导入的题目？')) return
    try {
      await api.adminDeleteQuestion(q.id)
      notify('已删除')
      load()
      onChanged?.()
    } catch (err) {
      notify(err.message)
    }
  }

  return (
    <div className="admin-panel">
      <div className="admin-filter">
        <select className="select" value={lesson} onChange={(e) => { setLesson(Number(e.target.value)); setOffset(0) }}>
          {lessons.map((l) => <option key={l.n} value={l.n}>第 {l.n} 课</option>)}
        </select>
        <div className="segmented small">
          {[
            { key: 'all', label: '全部' },
            { key: 'auto', label: '自动生成' },
            { key: 'manual', label: '手动导入' },
          ].map((s) => (
            <button key={s.key} className={source === s.key ? 'active' : ''} onClick={() => { setSource(s.key); setOffset(0) }}>
              {s.label}
            </button>
          ))}
        </div>
        <span className="muted">共 {data.total} 道</span>
      </div>

      {loading ? (
        <div className="loading-block">正在读取题目…</div>
      ) : data.questions.length === 0 ? (
        <div className="empty-panel slim"><p>本课没有符合条件的题目。</p></div>
      ) : (
        <div className="question-admin-list">
          {data.questions.map((q) => (
            <div className="q-admin-item" key={q.id}>
              <div className="q-admin-main">
                <div className="q-admin-head">
                  <span className={`q-type ${q.type}`}>{q.type === 'fill' ? '填空' : '选择'}</span>
                  <span className="muted">{q.source === 'manual' ? '手动导入' : '自动生成'}</span>
                  <span className="mono muted">{q.id}</span>
                </div>
                <p className="q-admin-prompt">{q.prompt}</p>
                {q.prompt_sub && <p className="q-admin-sub">{q.prompt_sub}</p>}
                {q.type === 'choice' && (
                  <div className="q-admin-options">
                    {q.options.map((o) => (
                      <span key={o.key} className={o.text === q.answer ? 'right' : ''}>{o.key}. {o.text}</span>
                    ))}
                  </div>
                )}
                <p className="q-admin-answer">答案：{q.answer}</p>
              </div>
              {q.source === 'manual' && (
                <button className="icon-btn danger" title="删除" onClick={() => remove(q)}>
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <Pager total={data.total} offset={offset} setOffset={setOffset} />
    </div>
  )
}

function Pager({ total, offset, setOffset }) {
  if (total <= 50) return null
  return (
    <div className="pager">
      <button className="ghost-btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>
        上一页
      </button>
      <span className="muted">{offset + 1}–{Math.min(offset + 50, total)} / {total}</span>
      <button className="ghost-btn" disabled={offset + 50 >= total} onClick={() => setOffset(offset + 50)}>
        下一页
      </button>
    </div>
  )
}
