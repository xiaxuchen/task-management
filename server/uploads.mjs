import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { CODES, AppError } from './errors.mjs'
import { UPLOAD_DIR } from './config.mjs'

/**
 * 图片上传共享核心：HTTP / CLI / MCP 三个入口都调用这里，避免各写一套校验。
 * 无 store 依赖——上传产物是磁盘文件 + 可被 Markdown 引用的 URL，不是业务数据。
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

/** 允许的图片类型：扩展名 ↔ MIME ↔ 魔数前缀（交叉校验，改名不能绕过） */
const MAGIC_TYPES = [
  { ext: 'png', mime: 'image/png', magic: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
  { ext: 'jpg', mime: 'image/jpeg', magic: Buffer.from([0xff, 0xd8, 0xff]) },
  { ext: 'gif', mime: 'image/gif', magic: Buffer.from('GIF8', 'ascii') }
]

const ALLOWED_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp']
const ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const EXT_ALIASES = { jpeg: 'jpg' }

function isWebp(buf) {
  return (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  )
}

/** 从文件字节识别真实图片类型；识别不出返回 null */
function sniffType(buf) {
  if (isWebp(buf)) return { ext: 'webp', mime: 'image/webp' }
  for (const t of MAGIC_TYPES) {
    if (buf.length >= t.magic.length && buf.subarray(0, t.magic.length).equals(t.magic)) {
      return { ext: t.ext, mime: t.mime }
    }
  }
  return null
}

function invalidType(message) {
  return new AppError(CODES.UPLOAD_INVALID_TYPE, message, {
    allowed: ALLOWED_EXTS,
    maxBytes: MAX_UPLOAD_BYTES
  })
}

/**
 * 解析入参：`{ name, data }`，data 既支持裸 base64，也支持 data URL。
 * 返回 `{ ext, mime, buffer }`；任何不合规都抛稳定错误码。
 */
export function decodeUpload({ name, data } = {}) {
  if (typeof name !== 'string' || !name.trim()) {
    throw new AppError(CODES.VALIDATION_FAILED, '上传需要图片文件名 name')
  }
  if (typeof data !== 'string' || !data.trim()) {
    throw new AppError(CODES.VALIDATION_FAILED, '上传需要图片内容 data（base64 或 data URL）')
  }

  const extFromName = (path.extname(name.trim()).slice(1) || '').toLowerCase()
  if (!extFromName || !ALLOWED_EXTS.includes(extFromName)) {
    throw invalidType(`不支持的图片格式：${name}（仅允许 ${ALLOWED_EXTS.join(' / ')}）`)
  }

  let base64 = data
  let declaredMime = null
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(data)
  if (m) {
    declaredMime = m[1].toLowerCase()
    base64 = m[2]
    if (!ALLOWED_MIMES.includes(declaredMime)) {
      throw invalidType(`不支持的图片类型：${declaredMime}（仅允许 ${ALLOWED_MIMES.join(' / ')}）`)
    }
  }

  const cleaned = base64.replace(/\s/g, '')
  if (!cleaned || !/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) {
    throw new AppError(CODES.VALIDATION_FAILED, 'data 不是合法的 base64 图片内容')
  }
  const buffer = Buffer.from(cleaned, 'base64')

  if (buffer.length === 0) {
    throw new AppError(CODES.VALIDATION_FAILED, '图片内容为空')
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new AppError(
      CODES.UPLOAD_TOO_LARGE,
      `图片超过 ${MAX_UPLOAD_BYTES / 1024 / 1024} MB 上限（实际 ${(buffer.length / 1024 / 1024).toFixed(2)} MB）`,
      { maxBytes: MAX_UPLOAD_BYTES, actualBytes: buffer.length }
    )
  }

  const sniffed = sniffType(buffer)
  if (!sniffed) {
    throw invalidType('文件内容不是受支持的图片（png / jpg / gif / webp）')
  }
  // 声明的扩展名与真实类型必须一致，落盘扩展名一律以真实类型为准
  const normalizedExt = EXT_ALIASES[extFromName] || extFromName
  if (normalizedExt !== sniffed.ext) {
    throw invalidType(`文件扩展名（.${extFromName}）与内容不符，实际为 .${sniffed.ext}`)
  }
  if (declaredMime && declaredMime !== sniffed.mime) {
    throw invalidType(`data URL 声明的类型（${declaredMime}）与内容不符，实际为 ${sniffed.mime}`)
  }

  return { ext: sniffed.ext, mime: sniffed.mime, buffer }
}

/**
 * 校验并落盘，返回 `{ url, name, size, mime }`。
 * 落盘名 `<时间戳>-<随机>.<真实扩展名>`：不可预测、不覆盖既有文件。
 */
export function saveUpload({ name, data, dir = UPLOAD_DIR } = {}) {
  const { ext, mime, buffer } = decodeUpload({ name, data })
  fs.mkdirSync(dir, { recursive: true })
  const stored = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`
  fs.writeFileSync(path.join(dir, stored), buffer)
  return { url: `/uploads/${stored}`, name: stored, size: buffer.length, mime, alt: markdownAlt(name) }
}

/**
 * 把上传的文件名收敛成可直接放进 Markdown 图片语法 `![alt](url)` 的 alt 文本。
 *
 * 关键字符是 `]`：它会把 alt 段提前截断，`![br]eak.png](/uploads/x.png)` 会被解析成纯文本，
 * 表现为「落库内容看着正常、预览却是裂图」，用户无从判断原因。`\` 必须先转义，
 * 否则会与后加的转义反斜杠相互吃掉。由服务端统一产出，避免前端各写一份。
 */
export function markdownAlt(text) {
  return String(text ?? '').replace(/\\/g, '\\\\').replace(/\]/g, '\\]').replace(/\[/g, '\\[')
}
