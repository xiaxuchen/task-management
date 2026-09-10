import test from 'node:test'
import assert from 'node:assert/strict'
import { AppError, CODES, fail } from '../server/errors.mjs'

test('错误码是稳定字符串常量', () => {
  assert.equal(CODES.VALIDATION_FAILED, 'VALIDATION_FAILED')
  assert.equal(CODES.LEAF_NODE, 'LEAF_NODE')
  assert.equal(CODES.PATH_AMBIGUOUS, 'PATH_AMBIGUOUS')
  assert.equal(CODES.CONFIRM_REQUIRED, 'CONFIRM_REQUIRED')
})

test('fail() 抛出带 code 与 details 的 AppError', () => {
  assert.throws(
    () => fail(CODES.VALIDATION_FAILED, '名称必填', { field: 'name' }),
    (err) => {
      assert.ok(err instanceof AppError)
      assert.equal(err.code, 'VALIDATION_FAILED')
      assert.equal(err.message, '名称必填')
      assert.deepEqual(err.details, { field: 'name' })
      return true
    }
  )
})
