<template>
  <div style="padding:20px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h3 style="margin:0">属性定义</h3>
      <el-button type="primary" size="small" @click="showAdd">+ 新增</el-button>
    </div>
    <el-table :data="defs" size="small" border stripe style="width:100%">
      <el-table-column prop="nodeType" label="节点类型" width="90">
        <template #default="{ row }">{{ typeLabel(row.nodeType) }}</template>
      </el-table-column>
      <el-table-column prop="key" label="key" width="100" />
      <el-table-column prop="label" label="标签" width="120">
        <template #default="{ row }">
          <el-input v-if="editingId === row.id" v-model="editingRow.label" size="small" />
          <span v-else>{{ row.label }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="dataType" label="类型" width="90">
        <template #default="{ row }">
          <el-select v-if="editingId === row.id" v-model="editingRow.dataType" size="small" style="width:100px">
            <el-option label="文本" value="text" />
            <el-option label="多行文本" value="textarea" />
            <el-option label="数字" value="number" />
            <el-option label="日期" value="date" />
            <el-option label="选择" value="select" />
            <el-option label="链接" value="url" />
          </el-select>
          <span v-else>{{ row.dataType }}</span>
        </template>
      </el-table-column>
      <el-table-column label="必填" width="60" align="center">
        <template #default="{ row }">
          <el-switch v-model="row.required" :disabled="editingId !== row.id" size="small" @change="saveRow(row)" />
        </template>
      </el-table-column>
      <el-table-column label="启用" width="60" align="center">
        <template #default="{ row }">
          <el-switch v-model="row.enabled" :disabled="editingId !== row.id" size="small" @change="saveRow(row)" />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="120">
        <template #default="{ row }">
          <el-button v-if="editingId !== row.id" link size="small" @click="editRow(row)">编辑</el-button>
          <el-button v-if="editingId === row.id" link type="primary" size="small" @click="saveRow(row)">保存</el-button>
          <el-button v-if="editingId === row.id" link size="small" @click="editingId = null">取消</el-button>
          <el-button link type="danger" size="small" @click="removeDef(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="addDialog" title="新增属性定义" width="450px">
      <el-form label-width="100px" size="small">
        <el-form-item label="节点类型">
          <el-select v-model="addForm.nodeType" style="width:100%">
            <el-option v-for="t in typeOptions" :key="t.value" :label="t.label" :value="t.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="Key">
          <el-input v-model="addForm.key" placeholder="英文标识" />
        </el-form-item>
        <el-form-item label="标签">
          <el-input v-model="addForm.label" placeholder="显示名" />
        </el-form-item>
        <el-form-item label="数据类型">
          <el-select v-model="addForm.dataType" style="width:100%">
            <el-option label="文本" value="text" />
            <el-option label="多行文本" value="textarea" />
            <el-option label="数字" value="number" />
            <el-option label="日期" value="date" />
            <el-option label="选择" value="select" />
            <el-option label="链接" value="url" />
          </el-select>
        </el-form-item>
        <el-form-item label="选项">
          <el-input v-model="addForm.options" placeholder='select 用 JSON：[{"value":"a","label":"A"}]' :disabled="addForm.dataType !== 'select'" />
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
import { ref, onMounted } from 'vue'
import api from '../api.js'

const defs = ref([])
const editingId = ref(null)
const editingRow = ref({})
const addDialog = ref(false)
const addForm = ref({ nodeType: '', key: '', label: '', dataType: 'text', options: '' })

const typeOptions = [
  { label: '项目', value: 'project' },
  { label: '需求', value: 'requirement' },
  { label: '子需求', value: 'subreq' },
  { label: '任务组', value: 'group' },
  { label: '子任务', value: 'task' },
  { label: '缺陷', value: 'defect' }
]
const typeLabel = (t) => typeOptions.find((o) => o.value === t)?.label || t

async function loadDefs() {
  defs.value = await api.attrDefs()
}

function showAdd() { addDialog.value = true }

async function doAdd() {
  const body = { nodeType: addForm.value.nodeType, key: addForm.value.key, label: addForm.value.label, dataType: addForm.value.dataType }
  if (addForm.value.options) body.options = JSON.parse(addForm.value.options)
  await api.attrDefCreate(body)
  addDialog.value = false
  addForm.value = { nodeType: '', key: '', label: '', dataType: 'text', options: '' }
  await loadDefs()
}

function editRow(row) {
  editingRow.value = { ...row }
  editingId.value = row.id
}

async function saveRow(row) {
  const patch = editingId.value === row.id ? editingRow.value : row
  await api.attrDefUpdate(row.id, patch)
  editingId.value = null
  await loadDefs()
}

async function removeDef(row) {
  ElMessageBox.confirm(`删除属性「${row.label}」？同时删除所有节点上该属性的值`, '确认', { type: 'warning' }).then(async () => {
    await api.attrDefDelete(row.id)
    await loadDefs()
  }).catch(() => {})
}

onMounted(loadDefs)
</script>