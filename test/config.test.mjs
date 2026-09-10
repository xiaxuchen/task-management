import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tempHome } from './helpers.mjs'

test('loadConfig 首次生成默认配置且权限 600', async () => {
  const tmp = await tempHome()
  const { loadConfig, CONFIG_PATH, DEFAULT_CONFIG } = tmp.config
  const cfg = loadConfig()
  assert.equal(cfg.port, DEFAULT_CONFIG.port)
  assert.equal(cfg.docPresets.defect.length, 2)
  assert.ok(fs.existsSync(CONFIG_PATH))
  const mode = fs.statSync(CONFIG_PATH).mode & 0o777
  assert.equal(mode, 0o600)
  tmp.cleanup()
})

test('saveConfig 局部合并并落盘，loadConfig 能读回', async () => {
  const tmp = await tempHome()
  const { loadConfig, saveConfig } = tmp.config
  loadConfig()
  saveConfig({ port: 3222, gitlab: { base_url: 'http://gitlab.xiaopeng.local:18080', token: 'abc' } })
  const cfg = loadConfig()
  assert.equal(cfg.port, 3222)
  assert.equal(cfg.gitlab.base_url, 'http://gitlab.xiaopeng.local:18080')
  assert.equal(cfg.gitlab.token, 'abc')
  tmp.cleanup()
})

test('maskToken 不泄露 token 原文', async () => {
  const tmp = await tempHome()
  const { loadConfig, saveConfig, maskToken } = tmp.config
  loadConfig()
  saveConfig({ gitlab: { token: 'secret-token' } })
  const masked = maskToken(loadConfig())
  assert.notEqual(masked.gitlab.token, 'secret-token')
  assert.equal(masked.gitlab.token, '****')
  tmp.cleanup()
})
