<template>
  <div style="padding:20px;max-width:920px">
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

    <el-divider content-position="left">仓库分支 / Tag 追踪</el-divider>
    <p class="branch-tip">
      为每个仓库配置「测试 / 预发 / 上线」的追踪目标，值可以是分支名或 tag 名（如上线常用发布 tag），
      提交列表会检测各提交是否已合入 / 包含在该目标中（读取本机 git，目标有更新时请先 git fetch）。
    </p>
    <el-table :data="repos" size="small">
      <el-table-column prop="name" label="仓库" width="170" />
      <el-table-column label="测试分支 / Tag">
        <template #default="{ row }">
          <el-input v-model="row.testBranch" size="small" placeholder="如 develop" />
        </template>
      </el-table-column>
      <el-table-column label="预发分支 / Tag">
        <template #default="{ row }">
          <el-input v-model="row.preBranch" size="small" placeholder="如 pre" />
        </template>
      </el-table-column>
      <el-table-column label="上线分支 / Tag">
        <template #default="{ row }">
          <el-input v-model="row.releaseBranch" size="small" placeholder="如 master 或 v1.2.0" />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="80">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="saveRepo(row)">保存</el-button>
        </template>
      </el-table-column>
    </el-table>
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
const repos = ref([])

async function loadRepos() {
  repos.value = await api.repos()
}

async function saveRepo(row) {
  const saved = await api.repoUpdate(row.id, {
    testBranch: row.testBranch || null,
    preBranch: row.preBranch || null,
    releaseBranch: row.releaseBranch || null
  })
  Object.assign(row, saved)
  ElMessage.success(`已保存：${row.name}`)
}

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

onMounted(() => {
  loadConfig()
  loadRepos()
})
</script>

<style scoped>
.branch-tip {
  margin: 0 0 12px;
  color: #909399;
  font-size: 12px;
}
</style>