import React, { useState } from 'react'
import { ArrowRight, BookOpenCheck, Database, Layers } from 'lucide-react'
import { api } from '../api.js'

export default function Login({ onAuth }) {
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const fn = mode === 'login' ? api.login : api.register
      const res = await fn(username.trim(), password)
      onAuth(res.user)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-visual">
        <div className="login-vert">
          <span>み</span><span>ん</span><span>な</span><span>の</span><span>日</span><span>本</span><span>語</span>
        </div>
        <div className="login-copy">
          <p className="eyebrow">MINNA NO NIHONGO · 50 LESSONS</p>
          <h1>
            五十课，
            <br />
            一课一课地学。
          </h1>
          <p className="login-desc">
            覆盖《大家的日语》初级 1、2 册全部 50 课的单词卡片与课后练习。记得住、错得少，进度跟着账号走。
          </p>
          <div className="login-features">
            <span><BookOpenCheck size={16} /> 50 课 · 2156 个单词</span>
            <span><Layers size={16} /> 选择题 + 填空题</span>
            <span><Database size={16} /> 进度保存到数据库</span>
          </div>
        </div>
      </div>

      <div className="login-panel">
        <div className="login-card">
          <div className="login-tabs">
            <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>登录</button>
            <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>注册</button>
          </div>
          <h2>{mode === 'login' ? '继续上次的进度' : '创建学习账号'}</h2>
          <p className="muted login-hint">
            {mode === 'login' ? '换设备时，用同一账号登录即可恢复学习进度。' : '第一个注册的账号会自动成为管理员，可补录释义和导入题库。'}
          </p>
          <form onSubmit={submit}>
            <label>
              用户名
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="2–24 位字母、数字或中文"
                autoComplete="username"
                required
              />
            </label>
            <label>
              密码
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 6 位"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
              />
            </label>
            {error && <div className="form-error">{error}</div>}
            <button className="primary-btn wide" disabled={busy}>
              {busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并开始'}
              {!busy && <ArrowRight size={17} />}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
