<template>
  <div class="doc-pane">
    <div class="doc-list">
      <div class="doc-list-header">
        <el-button size="small" type="primary" link @click="newDoc">+ 新增</el-button>
      </div>
      <el-menu :default-active="activeId" @select="onSelect">
        <el-menu-item v-for="d in docs" :key="d.id" :index="String(d.id)">
          <span class="doc-item-name">{{ d.name }}</span>
          <el-button link size="small" type="danger" @click.stop="removeDoc(d)">×</el-button>
        </el-menu-item>
      </el-menu>
    </div>

    <div class="doc-body">
      <div v-show="activeDoc" class="doc-toolbar">
        <el-radio-group v-model="mode" size="small">
          <el-radio-button value="preview">预览</el-radio-button>
          <el-radio-button value="edit">编辑</el-radio-button>
        </el-radio-group>
        <span class="doc-title">{{ activeDoc?.name }}</span>
        <el-tag v-if="dirty" size="small" type="warning">未保存</el-tag>
        <el-button v-if="mode === 'edit'" size="small" link type="primary" :disabled="!dirty" @click="saveNow">
          保存
        </el-button>
      </div>
      <div ref="hostRef" v-show="activeDoc" class="vd-host" />
      <el-empty v-if="!activeDoc" description="选择或新增文档" />
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
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import Vditor from 'vditor'
import 'vditor/dist/index.css'
import api from '../api.js'

// 资源自托管：scripts/copy-vditor.mjs 把 dist 同步到 web/public/vditor/dist，
// Vditor 按 `${CDN}/dist/js/...` 取 lute / highlight.js / mermaid / KaTeX，不依赖外网 CDN
const CDN = '/vditor'
const props = defineProps({ nodeId: Number })

const docs = ref([])
const activeId = ref('')
const mode = ref('preview')
const dirty = ref(false)
const nameDialog = ref(false)
const newDocName = ref('')
const hostRef = ref(null)

const activeDoc = computed(() => docs.value.find((d) => String(d.id) === activeId.value))

let vditor = null // 编辑态实例
let editingDocId = null // 编辑器当前绑定的文档 id
let saveTimer = null // 自动保存防抖
let pollTimer = null // 内容变化轮询（不依赖 Vditor 的 input 回调时机）
let saving = false

/** 渲染能力：目录 / 高亮标记 / mermaid 图 / KaTeX 公式（设计文档 §2.1） */
const MD_OPTIONS = {
  toc: true,
  mark: true,
  mermaid: true,
  math: { engine: 'KaTeX' }
}
const PREVIEW_OPTIONS = {
  cdn: CDN,
  lang: 'zh_CN',
  theme: { current: 'light' },
  hljs: { style: 'github', lineNumber: true },
  markdown: MD_OPTIONS
}

function destroyEditor() {
  clearTimeout(saveTimer)
  stopPolling()
  if (vditor) {
    try {
      vditor.destroy()
    } catch {
      /* 实例已销毁时忽略 */
    }
    vditor = null
  }
  editingDocId = null
  dirty.value = false
}

/** 按当前 mode 重建渲染：预览走静态渲染，编辑走 ir 模式实例 */
async function render() {
  const el = hostRef.value
  if (!el) return
  el.innerHTML = ''
  const doc = activeDoc.value
  if (!doc) return

  if (mode.value === 'preview') {
    await Vditor.preview(el, doc.content || '', PREVIEW_OPTIONS)
    return
  }

  vditor = new Vditor(el, {
    cdn: CDN,
    mode: 'ir',
    height: '100%',
    value: doc.content || '',
    cache: { enable: false }, // 不写 localStorage，避免与库中数据打架
    lang: 'zh_CN',
    theme: 'classic',
    icon: 'ant',
    placeholder: '支持 Markdown、代码块、表格、任务列表、mermaid、KaTeX',
    toolbar: [
      'headings', 'bold', 'italic', 'strike', '|',
      'list', 'ordered-list', 'check', '|',
      'quote', 'line', 'code', 'inline-code', '|',
      'link', 'table', '|',
      'undo', 'redo', '|',
      'edit-mode', 'outline', 'fullscreen'
    ],
    preview: {
      theme: { current: 'light' },
      hljs: { style: 'github', lineNumber: true },
      markdown: MD_OPTIONS
    },
    counter: { enable: true, type: 'markdown' },
    blur: () => saveNow(),
    // Vditor 内部异步加载 lute，构造后立即 getValue() 尚不可靠，故在 after 里才启动轮询
    after: () => {
      editingDocId = doc.id
      startPolling()
    }
  })
}

/**
 * 用轮询发现内容变化：Vditor 的 input 回调触发时机不稳定（实测输入后 2.8s 仍未回调），
 * 轮询 getValue() 与已存内容比对，既能准确维护「未保存」标记，也能驱动自动保存。
 */
function startPolling() {
  stopPolling()
  // 记录上一次观察到的编辑器内容：只有内容真正变化才重置防抖定时器，
  // 否则轮询（900ms）比防抖（1200ms）频，定时器会被不断重置导致永不保存
  let lastSeen = vditor ? vditor.getValue() : ''
  pollTimer = setInterval(() => {
    if (!vditor || editingDocId == null) return
    const doc = docs.value.find((d) => d.id === editingDocId)
    if (!doc) return
    const cur = vditor.getValue()
    if (cur !== lastSeen) {
      lastSeen = cur
      clearTimeout(saveTimer)
      saveTimer = setTimeout(saveNow, 1200) // 停止输入 1.2s 后落库
    }
    dirty.value = cur !== (doc.content || '')
  }, 900)
}

function stopPolling() {
  clearInterval(pollTimer)
  pollTimer = null
}

async function saveNow() {
  if (saving || !vditor || editingDocId == null) return
  clearTimeout(saveTimer)
  const doc = docs.value.find((d) => d.id === editingDocId)
  if (!doc) return
  const content = vditor.getValue()
  if (content === (doc.content || '')) {
    dirty.value = false
    return
  }
  saving = true
  try {
    await api.docUpdate(doc.id, { content })
    doc.content = content
    dirty.value = vditor.getValue() !== content // 保存期间又有改动则保持未保存
  } finally {
    saving = false
  }
}

async function loadDocs() {
  docs.value = await api.docList(props.nodeId)
}

function onSelect(id) {
  activeId.value = id
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
    mode.value = 'edit'
    activeId.value = String(d.id)
  } catch (e) {
    ElMessage.error(e.message)
  }
  nameDialog.value = false
}

async function removeDoc(doc) {
  try {
    await ElMessageBox.confirm(`删除文档「${doc.name}」？`, '确认删除', { type: 'warning' })
  } catch {
    return
  }
  await api.docDelete(doc.id)
  docs.value = docs.value.filter((d) => d.id !== doc.id)
  if (activeId.value === String(doc.id)) {
    activeId.value = docs.value[0] ? String(docs.value[0].id) : ''
  }
}

// 切换节点：重载文档列表并定位到第一份
watch(
  () => props.nodeId,
  async () => {
    if (mode.value === 'edit') await saveNow()
    destroyEditor()
    activeId.value = ''
    await loadDocs()
    const next = docs.value.length ? String(docs.value[0].id) : ''
    if (next === activeId.value) {
      await nextTick()
      await render()
    } else {
      activeId.value = next
    }
  }
)

// 切换文档
watch(activeId, async (id, oldId) => {
  if (mode.value === 'edit' && oldId) await saveNow()
  destroyEditor()
  await nextTick()
  if (id) await render()
})

// 切换预览 / 编辑
watch(mode, async (m, oldMode) => {
  if (oldMode === 'edit') await saveNow()
  destroyEditor()
  await nextTick()
  await render()
})

onMounted(async () => {
  await loadDocs()
  activeId.value = docs.value.length ? String(docs.value[0].id) : ''
  await nextTick()
  await render()
})

onBeforeUnmount(() => destroyEditor())
</script>

<style scoped>
.doc-pane {
  display: flex;
  height: 100%;
  min-height: 420px;
}
.doc-list {
  width: 160px;
  border-right: 1px solid #e4e7ed;
  overflow-y: auto;
  flex-shrink: 0;
}
.doc-list-header {
  padding: 4px 8px;
  border-bottom: 1px solid #e4e7ed;
}
.doc-item-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}
.doc-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.doc-toolbar {
  padding: 4px 8px;
  border-bottom: 1px solid #e4e7ed;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.doc-title {
  color: #909399;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vd-host {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
/* 静态预览留白，避免贴边（Vditor.preview 会把 vditor-reset 类加到 .vd-host 同一元素上） */
.vd-host.vditor-reset {
  padding: 16px 24px;
}
</style>