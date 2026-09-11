<template>
  <div class="doc-pane">
    <div class="doc-list">
      <div class="doc-list-header">
        <el-button size="small" type="primary" link @click="newDoc">+ 新增</el-button>
      </div>
      <el-menu :default-active="activeId" @select="onSelect">
        <el-menu-item v-for="d in docs" :key="d.id" :index="String(d.id)">
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis">{{ d.name }}</span>
          <el-button link size="small" type="danger" @click.stop="removeDoc(d)">×</el-button>
        </el-menu-item>
      </el-menu>
    </div>
    <div class="doc-body">
      <div v-if="activeDoc" class="doc-toolbar">
        <el-button :type="editing ? 'default' : 'primary'" size="small" @click="editing = false">预览</el-button>
        <el-button :type="editing ? 'primary' : 'default'" size="small" @click="editing = true">编辑</el-button>
        <span style="margin-left:8px;color:#999;font-size:12px">{{ activeDoc.name }}</span>
      </div>
      <div v-if="activeDoc && !editing" class="markdown-body" v-html="rendered" />
      <div v-if="activeDoc && editing" style="height:calc(100% - 36px)">
        <textarea v-model="editContent" style="width:100%;height:100%;border:1px solid #dcdfe6;border-radius:4px;padding:8px;font-family:monospace;resize:none" @blur="saveDoc" />
      </div>
      <el-empty v-if="!activeDoc && !editing" description="选择或新增文档" />
    </div>

    <el-dialog v-model="nameDialog" title="文档名称" width="300px">
      <el-input v-model="newDocName" placeholder="文档名" @keyup.enter="doCreate" />
      <template #footer>
        <el-button @click="nameDialog = false">取消</el-button>
        <el-button type="primary" @click="doCreate">确认</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import api from '../api.js'

const props = defineProps({ nodeId: Number })
const docs = ref([])
const activeId = ref('')
const editing = ref(false)
const editContent = ref('')
const nameDialog = ref(false)
const newDocName = ref('')

const activeDoc = computed(() => docs.value.find((d) => String(d.id) === activeId.value))
const rendered = computed(() => {
  if (!activeDoc.value?.content) return '<p style="color:#999">（空）</p>'
  return simpleMd(activeDoc.value.content)
})

function simpleMd(text) {
  let html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[hul])/gm, '<p>')
    .replace(/(<p>)\s*<\/p>/g, '')
  return '<div>' + html + '</div>'
}

async function loadDocs() {
  docs.value = await api.docList(props.nodeId)
  if (docs.value.length && !activeId.value) activeId.value = String(docs.value[0].id)
}

function onSelect(id) {
  activeId.value = id
  editing.value = false
  if (activeDoc.value) editContent.value = activeDoc.value.content || ''
}

function newDoc() {
  newDocName.value = ''
  nameDialog.value = true
}

async function doCreate() {
  if (!newDocName.value.trim()) return
  try {
    const d = await api.docCreate(props.nodeId, { name: newDocName.value.trim() })
    docs.value.push(d)
    activeId.value = String(d.id)
    editContent.value = ''
    editing.value = true
  } catch (e) {
    ElMessage.error(e.message)
  }
  nameDialog.value = false
}

async function saveDoc() {
  if (!activeDoc.value) return
  await api.docUpdate(activeDoc.value.id, { content: editContent.value })
  activeDoc.value.content = editContent.value
}

async function removeDoc(doc) {
  await api.docDelete(doc.id)
  docs.value = docs.value.filter((d) => d.id !== doc.id)
  if (activeId.value === String(doc.id)) {
    activeId.value = docs.value[0] ? String(docs.value[0].id) : ''
  }
}

watch(() => props.nodeId, () => { activeId.value = ''; loadDocs() })
onMounted(loadDocs)
</script>

<style scoped>
.doc-pane { display:flex; height:100%; }
.doc-list { width:160px; border-right:1px solid #e4e7ed; overflow-y:auto; }
.doc-list-header { padding:4px 8px; border-bottom:1px solid #e4e7ed; }
.doc-body { flex:1; display:flex; flex-direction:column; overflow:auto; }
.doc-toolbar { padding:4px 8px; border-bottom:1px solid #e4e7ed; }
.markdown-body { padding:12px; overflow:auto; flex:1; }
.markdown-body :deep(h1) { font-size:18px; }
.markdown-body :deep(h2) { font-size:16px; }
.markdown-body :deep(h3) { font-size:14px; }
.markdown-body :deep(code) { background:#f0f0f0; padding:1px 4px; border-radius:3px; }
</style>