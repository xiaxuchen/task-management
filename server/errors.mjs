/** 稳定错误码：AI 依赖它做自纠，改动需同步设计文档 §9 */
export const CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  PARENT_TYPE_INVALID: 'PARENT_TYPE_INVALID',
  LEAF_NODE: 'LEAF_NODE',
  CYCLE_DETECTED: 'CYCLE_DETECTED',
  NOT_FOUND: 'NOT_FOUND',
  PATH_NOT_FOUND: 'PATH_NOT_FOUND',
  PATH_AMBIGUOUS: 'PATH_AMBIGUOUS',
  DOC_NAME_EXISTS: 'DOC_NAME_EXISTS',
  CONFIRM_REQUIRED: 'CONFIRM_REQUIRED'
}

export class AppError extends Error {
  constructor(code, message, details) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.details = details
  }
}

export function fail(code, message, details) {
  throw new AppError(code, message, details)
}
