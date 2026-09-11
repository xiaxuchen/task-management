<template>
  <div style="padding:20px;max-width:600px">
    <h3>设置</h3>
    <el-form label-width="120px" size="small">
      <el-form-item label="端口">
        <el-input-number v-model="port" :min="1024" :max="65535" />
      </el-form-item>
      <el-form-item label="GitLab 地址">
        <el-input v-model="gitlabBase" placeholder="https://gitlab.example.com" />
      </el-form-item>
      <el-form-item label="Token">
        <el-input v-model="gitlabToken" type="password" show-password />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="saveConfig">保存</el-button>
        <el-button @click="testGitlab" :loading="testing">测试连接</el-button>
      </el-form-item>
    </el-form>
    <el-alert v-if="testResult" :title="testResult" :type="testOk ? 'success' : 'error'" show-icon style="margin-top:12px" />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../api.js'

const port = ref(3210)
const gitlabBase = ref('')
const gitlabToken = ref('')
const testing = ref(false)
const testResult = ref('')
const testOk = ref(false)

async function loadConfig() {
  const cfg = await api.configGet()
  port.value = cfg.port || 3210
  gitlabBase.value = cfg.gitlab?.base_url || ''
  gitlabToken.value = cfg.gitlab?.token || ''
}

async function saveConfig() {
  await api.configSet({ port: port.value, gitlab: { base_url: gitlabBase.value, token: gitlabToken.value } })
  ElMessage.success('已保存')
}

async function testGitlab() {
  testing.value = true
  testResult.value = ''
  try {
    const r = await api.configGitlabTest()
    testResult.value = `连接成功：${r.user.name}（@${r.user.username}）`
    testOk.value = true
  } catch (e) {
    testResult.value = e.message
    testOk.value = false
  }
  testing.value = false
}

onMounted(loadConfig)
</script>