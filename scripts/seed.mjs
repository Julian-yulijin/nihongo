import { seedIfEmpty } from '../server/db.js'

const result = seedIfEmpty()
if (result.seeded) {
  console.log(`已导入 ${result.words} 个单词、${result.questions} 道自动生成的题目。`)
} else {
  console.log(`数据库中已有 ${result.words} 个单词，跳过导入。`)
}
