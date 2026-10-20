async function request(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  if (!res.ok) throw new Error(data?.error || `请求失败 (${res.status})`)
  return data
}

export const api = {
  me: () => request('/api/auth/me'),
  login: (username, password) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  register: (username, password) =>
    request('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  lessons: () => request('/api/lessons'),
  overview: () => request('/api/overview'),
  words: (lesson, filter = 'all') => request(`/api/lessons/${lesson}/words?filter=${filter}`),
  review: (wordId, rating) =>
    request(`/api/words/${wordId}/review`, { method: 'POST', body: JSON.stringify({ rating }) }),
  questions: (lesson, mode, type, limit = 30) =>
    request(`/api/quiz/questions?lesson=${lesson}&mode=${mode}&type=${type}&limit=${limit}`),
  submit: (questionId, response) =>
    request('/api/quiz/submit', { method: 'POST', body: JSON.stringify({ questionId, response }) }),
  quizStats: (lesson) => request(`/api/quiz/stats?lesson=${lesson}`),
  adminSummary: () => request('/api/admin/summary'),
  adminWords: (params) => {
    const qs = new URLSearchParams(params).toString()
    return request(`/api/admin/words?${qs}`)
  },
  adminSaveWord: (id, payload) =>
    request(`/api/admin/words/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  adminQuestions: (params) => {
    const qs = new URLSearchParams(params).toString()
    return request(`/api/admin/questions?${qs}`)
  },
  adminImport: (questions) =>
    request('/api/admin/questions/import', { method: 'POST', body: JSON.stringify({ questions }) }),
  adminDeleteQuestion: (id) => request(`/api/admin/questions/${id}`, { method: 'DELETE' }),
  adminReseed: (forceQuestions) =>
    request('/api/admin/reseed', { method: 'POST', body: JSON.stringify({ forceQuestions }) }),
}

export function speak(text) {
  if (!('speechSynthesis' in window) || !text) return false
  window.speechSynthesis.cancel()
  const utter = new SpeechSynthesisUtterance(text)
  utter.lang = 'ja-JP'
  utter.rate = 0.9
  const voices = window.speechSynthesis.getVoices()
  const jp = voices.find((v) => v.lang === 'ja-JP') || voices.find((v) => v.lang?.startsWith('ja'))
  if (jp) utter.voice = jp
  window.speechSynthesis.speak(utter)
  return true
}

export function useSpeechSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}
