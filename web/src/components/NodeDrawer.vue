<template>
  <el-drawer v-model="internalVisible" :title="node.path || node.name" :size="drawerWidth" @close="emit('close')" destroy-on-close>
    <template #header="{ close, titleId }">
      <div style="display:flex;align-items:center;gap:8px">
        <h4 :id="titleId" style="margin:0;flex:1;overflow:hidden;text-overflow:ellipsis">{{ node.path || node.name }}</h4>
        <el-tag size="small">{{ typeLabel(node.type) }}</el-tag>
        <el-button size="small" @click="toggleWidth">
          {{ drawerWidth === '760px' ? '加宽' : '默认' }}
        </el-button>
      </div>
    </template>

    <el-tabs v-model="tab">
      <el-tab-pane label="基本信息" name="info">
        <el-form label-width="80px" size="small">
          <el-form-item label="名称">
            <el-input v-model="editName" @blur="saveName" />
          </el-form-item>
          <el-form-item label="状态">
            <el-select v-model="editStatus" @change="saveStatus" style="width:100%">
              <el-option v-for="(l, k) in statusLabels" :key="k" :label="l" :value="k" />
            </el-select>
          </el-form-item>
          <el-form-item label="创建者">{{ node.createdBy }}</el-form-item>
          <el-form-item label="更新时间">{{ node.updatedAt }}</el-form-item>
        </el-form>

        <el-divider content-position="left">属性</el-divider>
        <el-form label-width="100px" size="small">
          <el-form-item v-for="a in attrDefs" :key="a.key" :label="a.label">
            <el-input v-if="a.dataType === 'text' || a.dataType === 'url'" v-model="attrValues[a.key]" @blur="saveAttrs" />
            <el-input v-if="a.dataType === 'textarea'" v-model="attrValues[a.key]" type="textarea" :rows="3" @blur="saveAttrs" />
            <el-input-number v-if="a.dataType === 'number'" v-model="attrValues[a.key]" :min="0" style="width:100%" @change="saveAttrs" />
            <el-date-picker v-if="a.dataType === 'date'" v-model="attrValues[a.key]" type="date" value-format="YYYY-MM-DD" style="width:100%" @change="saveAttrs" />
            <el-select v-if="a.dataType === 'select'" v-model="attrValues[a.key]" style="width:100%" @change="saveAttrs">
              <el-option v-for="o in (a.options || [])" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
          </el-form-item>
          <el-empty v-if="!attrDefs.length" description="该类型暂无属性定义" />
        </el-form>
      </el-tab-pane>

      <el-tab-pane label="文档" name="docs">
        <DocPane :node-id="node.id" />
      </el-tab-pane>

      <el-tab-pane label="子节点" name="children">
        <el-empty v-if="!children.length" description="无子节点" />
        <el-table v-else :data="children" size="small" @row-click="onChildClick">
          <el-table-column prop="name" label="名称" min-width="150" />
          <el-table-column prop="type" label="类型" width="80">
            <template #default="{ row }">{{ typeLabel(row.type) }}</template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="70" />
        </el-table>
      </el-tab-pane>

      <el-tab-pane v-if="node.type === 'group' || node.type === 'task' || node.type === 'defect'" label="提交" name="commits">
        <el-form :model="commitForm" size="small" label-width="50px">
          <el-form-item label="SHA">
            <el-input v-model="commitForm.sha" placeholder="7–40 位十六进制" />
          </el-form-item>
          <el-form-item label="仓库">
            <el-select v-model="commitForm.repo" clearable filterable style="width:100%">
              <el-option v-for="r in repos" :key="r.id" :label="r.name" :value="r.name" />
            </el-select>
          </el-form-item>
          <el-form-item label="说明">
            <el-input v-model="commitForm.note" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="addCommit">登记</el-button>
          </el-form-item>
        </el-form>
        <el-table v-if="commits.length" :data="commits" size="small" max-height="300">
          <el-table-column prop="sha" label="SHA" width="90" />
          <el-table-column prop="repo" label="仓库" width="100" />
          <el-table-column prop="note" label="说明" min-width="120" />
        </el-table>
      </el-tab-pane>
    </el-tabs>
  </el-drawer>
</template>

<script setup>
import { ref, watch } from 'vue'
import api from '../api.js'
import DocPane from './DocPane.vue'

const props = defineProps({ node: Object, visible: Boolean, initialTab: { type: String, default: 'info' } })
const emit = defineEmits(['close', 'updated'])

const internalVisible = ref(props.visible)
watch(() => props.visible, (v) => { internalVisible.value = v })

const tab = ref(props.initialTab)
const drawerWidth = ref('760px')

const editName = ref(props.node.name)
const editStatus = ref(props.node.status || 'todo')
const attrValues = ref({})
const attrDefs = ref([])
const children = ref([])
const commits = ref([])
const repos = ref([])
const statusLabels = { todo: '待开始', doing: '进行中', testing: '提测中', done: '已完成', cancelled: '已取消' }
const typeLabel = (t) => ({ project: '项目', requirement: '需求', subreq: '子需求', group: '任务组', task: '子任务', defect: '缺陷' }[t] || t)

const commitForm = ref({ sha: '', repo: '', note: '' })

function toggleWidth() {
  drawerWidth.value = drawerWidth.value === '760px' ? '70vw' : '760px'
}

async function loadDetail() {
  // 切换节点时回到请求的 tab（点「文档」列直接落在文档区）
  tab.value = props.initialTab
  const detail = await api.nodeGet(props.node.id)
  editName.value = detail.name
  editStatus.value = detail.status || 'todo'
  attrValues.value = detail.attrs || {}
  children.value = detail.children || []
  commits.value = detail.commits || []
  const allDefs = await api.attrDefs()
  attrDefs.value = allDefs.filter((d) => d.enabled !== false && d.nodeType === detail.type)
  const repoList = await api.repos()
  repos.value = repoList
}

async function saveName() {
  if (editName.value !== props.node.name) {
    await api.nodeUpdate(props.node.id, { name: editName.value })
    emit('updated')
  }
}

async function saveStatus() {
  await api.nodeUpdate(props.node.id, { status: editStatus.value })
  emit('updated')
}

async function saveAttrs() {
  await api.nodeUpdate(props.node.id, { attrs: attrValues.value })
  emit('updated')
}

async function addCommit() {
  if (!commitForm.value.sha) return
  await api.commitAdd(props.node.id, commitForm.value)
  commitForm.value = { sha: '', repo: '', note: '' }
  commits.value = await api.commitList(props.node.id)
}

function onChildClick(child) {
  emit('close')
  // 由父组件在下一个 tick 中打开该子节点
  // 简单方案：重新 emit select 但保持 drawer 关闭
}

// 切换节点时重新加载（组件实例会被复用，onMounted 不会再次触发）
watch(() => props.node?.id, loadDetail, { immediate: true })
</script>