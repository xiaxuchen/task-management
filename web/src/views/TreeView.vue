<template>
  <div class="tree-wrap">
    <div class="toolbar">
      <el-input v-model="search" placeholder="搜索名称…" clearable size="small" style="width:200px;margin-right:8px" />
      <el-select v-model="typeFilter" placeholder="类型" clearable size="small" style="width:100px;margin-right:8px">
        <el-option v-for="t in typeOptions" :key="t.value" :label="t.label" :value="t.value" />
      </el-select>
      <el-select v-model="statusFilter" placeholder="状态" clearable size="small" style="width:100px;margin-right:8px">
        <el-option label="待开始" value="todo" />
        <el-option label="进行中" value="doing" />
        <el-option label="已完成" value="done" />
      </el-select>
      <el-button type="primary" size="small" @click="newProject">+ 新建项目</el-button>
      <el-button size="small" @click="refresh">刷新</el-button>
    </div>
    <el-table ref="tableRef" :data="filtered" row-key="id" :tree-props="{ children: 'children' }" border stripe size="small" style="width:100%" highlight-current-row @row-click="onRowClick" :default-expand-all="false">
      <el-table-column label="名称" min-width="300">
        <template #default="{ row }">
          <span :style="{ marginLeft: row._depth ? row._depth * 20 + 'px' : 0, fontWeight: row.type === 'project' ? 700 : 400 }">
            <el-tag v-if="row.type === 'defect'" size="small" type="danger" style="margin-right:4px">缺陷</el-tag>
            <el-tag v-else-if="row.type === 'task'" size="small" style="margin-right:4px">子任务</el-tag>
            <el-tag v-else-if="row.type === 'group'" size="small" type="warning" style="margin-right:4px">组</el-tag>
            {{ row.name }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="类型" width="80">
        <template #default="{ row }">{{ typeLabel(row.type) }}</template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)" size="small">{{ statusLabels[row.status] || row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="文档" width="60" align="center">
        <template #default="{ row }">
          <el-button v-if="row.docCount" link type="primary" size="small" @click.stop="openDocs(row)">📄{{ row.docCount }}</el-button>
        </template>
      </el-table-column>
      <el-table-column label="子节点" width="60" align="center">
        <template #default="{ row }">{{ row.childCount ?? 0 }}</template>
      </el-table-column>
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button v-if="canAddChild(row)" link type="primary" size="small" @click.stop="addChild(row)">+</el-button>
          <el-button v-if="row.type === 'task' || row.type === 'group'" link type="danger" size="small" @click.stop="addDefect(row)">+缺陷</el-button>
          <el-button link type="danger" size="small" @click.stop="delNode(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 新增子节点弹窗 -->
    <el-dialog v-model="addDialog" title="新建节点" width="400px">
      <el-form label-width="70px">
        <el-form-item label="名称">
          <el-input v-model="addName" placeholder="节点名称" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addDialog = false">取消</el-button>
        <el-button type="primary" @click="doAdd">确认</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'
import api from '../api.js'

const emit = defineEmits(['select'])
const tableRef = ref(null)
const search = ref('')
const typeFilter = ref('')
const statusFilter = ref('')
const tree = ref([])
const rawNodes = ref([])

const typeOptions = [
  { label: '项目', value: 'project' },
  { label: '需求', value: 'requirement' },
  { label: '子需求', value: 'subreq' },
  { label: '任务组', value: 'group' },
  { label: '子任务', value: 'task' },
  { label: '缺陷', value: 'defect' }
]

const statusLabels = { todo: '待开始', doing: '进行中', testing: '提测中', done: '已完成', cancelled: '已取消' }
const statusType = (s) => ({ todo: 'info', doing: 'warning', testing: '', done: 'success', cancelled: 'danger' }[s] || 'info')
const typeLabel = (t) => ({ project: '项目', requirement: '需求', subreq: '子需求', group: '任务组', task: '子任务', defect: '缺陷' }[t] || t)
const canAddChild = (n) => !['task', 'defect'].includes(n.type)
const canAddDefect = (n) => n.type === 'task' || n.type === 'group'

function markDepth(nodes, depth = 0) {
  for (const n of nodes) {
    n._depth = depth
    if (n.children?.length) markDepth(n.children, depth + 1)
  }
  return nodes
}

const filtered = computed(() => {
  let list = tree.value
  if (search.value) {
    const q = search.value.toLowerCase()
    list = deepFilter(list, (n) => n.name.toLowerCase().includes(q))
  }
  if (typeFilter.value) list = deepFilter(list, (n) => n.type === typeFilter.value)
  if (statusFilter.value) list = deepFilter(list, (n) => n.status === statusFilter.value)
  return list
})

function deepFilter(nodes, fn) {
  const out = []
  for (const n of nodes) {
    const children = n.children?.length ? deepFilter(n.children, fn) : []
    if (fn(n) || children.length) out.push({ ...n, children })
  }
  return out
}

async function loadTree() {
  const r = await api.tree()
  rawNodes.value = r.nodes || []
  tree.value = markDepth(r.nodes || [])
}

async function refresh() { await loadTree() }

// 新增
const addDialog = ref(false)
const addName = ref('')
let addParent = null

function newProject() {
  addParent = null
  addName.value = ''
  addDialog.value = true
}

function addChild(parent) {
  addParent = parent
  addName.value = ''
  addDialog.value = true
}

function addDefect(parent) {
  addParent = parent
  addName.value = ''
  addDialog.value = true
}

async function doAdd() {
  if (!addName.value.trim()) return
  const type = !addParent ? 'project' : addParent.type === 'task' || addParent.type === 'group' ? 'defect'
    : addParent.type === 'project' ? 'requirement'
    : addParent.type === 'requirement' ? 'subreq'
    : addParent.type === 'subreq' ? 'group'
    : addParent.type === 'group' ? 'group'
    : 'task'
  await api.nodeCreate({ parentId: addParent?.id || null, type, name: addName.value.trim() })
  addDialog.value = false
  await loadTree()
}

function delNode(node) {
  ElMessageBox.confirm(`确认删除「${node.path || node.name}」？将级联删除所有子节点与文档`, '确认删除', { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }).then(async () => {
    await api.nodeDelete(node.id, true)
    await loadTree()
  }).catch(() => {})
}

function onRowClick(row) {
  emit('select', row, 'info')
}

function openDocs(row) {
  emit('select', row, 'docs')
}

onMounted(loadTree)

defineExpose({ refresh: loadTree })
</script>

<style scoped>
.tree-wrap { height:100%; display:flex; flex-direction:column; }
.toolbar { padding:8px 12px; display:flex; align-items:center; background:#f5f7fa; border-bottom:1px solid #e4e7ed; }
</style>