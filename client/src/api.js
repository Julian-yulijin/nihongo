import * as local from './local.js'

export const api = {
  init: () => local.init(),
  lessons: () => local.getLessons(),
  overview: () => local.getOverview(),
  words: (lesson, filter = 'all') => local.getWords(lesson, filter),
  review: (wordId, rating) => local.reviewWord(wordId, rating),
  questions: (lesson, mode, type, limit = 30) => local.getQuestions(lesson, mode, type, limit),
  submit: (questionId, response) => local.submitAnswer(questionId, response),
  quizStats: (lesson) => local.getQuizStats(lesson),
  exportProgress: () => local.exportProgress(),
  importProgress: (payload) => local.importProgress(payload),
  resetProgress: () => local.resetProgress(),
  progressSummary: () => local.progressSummary(),
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
