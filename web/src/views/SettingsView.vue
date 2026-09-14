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

    <el-divider content-position="left">提示词模板（各环节派单）</el-divider>
    <p class="branch-tip">
      变量用 <code v-pre>{{名称}}</code> 注入；缺陷流程：<b>分析根因 → 批准修复 → 按方案修复</b>（派单提示词即用以下模板）。
    </p>
    <el-form label-position="top" size="small">
      <el-form-item :label="promptLabelDefectAnalyze">
        <el-input v-model="tplDefectAnalyze" type="textarea" :autosize="{ minRows: 8 }" />
      </el-form-item>
      <el-form-item :label="promptLabelDefectDispatch">
        <el-input v-model="tplDefectDispatch" type="textarea" :autosize="{ minRows: 8 }" />
      </el-form-item>
      <el-form-item :label="promptLabelTaskDispatch">
        <el-input v-model="tplTaskDispatch" type="textarea" :autosize="{ minRows: 8 }" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="savePromptTemplates">保存模板</el-button>
        <el-button @click="loadConfig">丢弃修改</el-button>
      </el-form-item>
    </el-form>

    <el-divider content-position="left">标签分支 / Tag 配置</el-divider>
    <p class="branch-tip">
      按「标签」配置追踪目标（值可为分支名或 tag 名，如上线常用发布 tag）；仓库通过标签继承，
      追踪目标一律以上表为准。以后可扩展更多标签（如小程序 / 数据）。
    </p>
    <el-table :data="branchConfigs" size="small">
      <el-table-column label="标签" width="150">
        <template #default="{ row }">
          <el-input v-model="row.tag" size="small" placeholder="如 前端 / 后端" :disabled="!row._new" />
        </template>
      </el-table-column>
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
      <el-table-column label="操作" width="110">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="saveBranchConfig(row)">保存</el-button>
          <el-button link type="danger" size="small" @click="removeBranchConfig(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-button size="small" style="margin-top:8px" @click="addTagRow">+ 新增标签</el-button>

    <el-divider content-position="left">仓库标签</el-divider>
    <p class="branch-tip">
      为仓库打标签（逗号分隔，可多标签，取第一个有配置的标签）；分支 / Tag 追踪目标以「上表标签配置」为准。
      读取本机 git，目标有更新时请先 git fetch。
    </p>
    <el-table :data="repos" size="small">
      <el-table-column prop="name" label="仓库" width="240" />
      <el-table-column label="标签（逗号分隔）">
        <template #default="{ row }">
          <el-input v-model="row.tags" size="small" placeholder="如 后端" />
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
const branchConfigs = ref([])
const tplDefectAnalyze = ref('')
const tplDefectDispatch = ref('')
const tplTaskDispatch = ref('')
const promptLabelDefectAnalyze = '分析根因 defect_analyze（变量：{{defectId}} {{title}} {{desc}} {{locationSection}}）'
const promptLabelDefectDispatch = '按方案修复 defect_dispatch（额外：{{analysisSection}}）'
const promptLabelTaskDispatch = '任务派单 task_dispatch（变量：{{taskName}} {{prdSection}} {{docs}} {{commitsSection}} {{filesSection}}）'

async function loadRepos() {
  repos.value = await api.repos()
}

async function loadBranchConfigs() {
  branchConfigs.value = await api.branchConfigs()
}

function addTagRow() {
  branchConfigs.value.push({ tag: '', testBranch: null, preBranch: null, releaseBranch: null, _new: true })
}

async function saveBranchConfig(row) {
  if (!row.tag) {
    ElMessage.warning('请先填写标签名')
    return
  }
  const saved = await api.branchConfigSet(row.tag, {
    testBranch: row.testBranch || null,
    preBranch: row.preBranch || null,
    releaseBranch: row.releaseBranch || null
  })
  Object.assign(row, saved, { _new: false })
  ElMessage.success(`已保存标签配置：${saved.tag}`)
}

async function removeBranchConfig(row) {
  if (row._new) {
    branchConfigs.value = branchConfigs.value.filter((r) => r !== row)
    return
  }
  await api.branchConfigRemove(row.tag)
  branchConfigs.value = branchConfigs.value.filter((r) => r !== row)
  ElMessage.success(`已删除标签配置：${row.tag}`)
}

async function saveRepo(row) {
  const saved = await api.repoUpdate(row.id, { tags: row.tags || null })
  Object.assign(row, saved)
  ElMessage.success(`已保存：${row.name}`)
}

async function loadConfig() {
  const cfg = await api.configGet()
  port.value = cfg.port || 3210
  gitlabBase.value = cfg.gitlab?.base_url || ''
  gitlabToken.value = cfg.gitlab?.token || ''
  tplDefectAnalyze.value = cfg.promptTemplates?.defect_analyze || ''
  tplDefectDispatch.value = cfg.promptTemplates?.defect_dispatch || ''
  tplTaskDispatch.value = cfg.promptTemplates?.task_dispatch || ''
}

async function savePromptTemplates() {
  await api.configSet({
    promptTemplates: {
      defect_analyze: tplDefectAnalyze.value,
      defect_dispatch: tplDefectDispatch.value,
      task_dispatch: tplTaskDispatch.value
    }
  })
  ElMessage.success('提示词模板已保存（插件/派单立即生效）')
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
  loadBranchConfigs()
})
</script>

<style scoped>
.branch-tip {
  margin: 0 0 12px;
  color: #909399;
  font-size: 12px;
}
</style>
