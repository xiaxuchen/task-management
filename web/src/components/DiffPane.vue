<template>
  <el-dialog
    :model-value="visible"
    width="92%"
    top="4vh"
    append-to-body
    destroy-on-close
    class="diff-dialog"
    @update:model-value="$emit('update:visible', $event)"
  >
    <template #header>
      <div class="diff-header">
        <span class="diff-title">提交 Diff</span>
        <span v-if="commit" class="diff-meta">{{ commit.repo }} · {{ commit.sha }}</span>
        <span v-if="data && data.subject" class="diff-subject">{{ data.subject }}</span>
      </div>
    </template>
    <div v-loading="loading" class="diff-body">
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <template v-else-if="data">
        <div class="diff-toolbar">
          <span class="file-summary">
            {{ data.files.length }} 个文件
            <template v-if="data.author"> · {{ data.author }}</template>
            <template v-if="data.date"> · {{ data.date }}</template>
          </span>
          <el-radio-group v-model="viewMode" size="small" @change="renderCurrent">
            <el-radio-button value="unified">统一</el-radio-button>
            <el-radio-button value="split">分栏</el-radio-button>
          </el-radio-group>
        </div>
        <div class="diff-main">
          <div class="diff-files">
            <div
              v-for="f in data.files"
              :key="f.path"
              class="diff-file-item"
              :class="{ active: f.path === currentPath }"
              @click="selectFile(f.path)"
            >
              <span class="file-path" :title="f.path">{{ f.path }}</span>
              <span class="file-stat">
                <span class="add">+{{ f.additions }}</span>
                <span class="del">-{{ f.deletions }}</span>
              </span>
            </div>
          </div>
          <div class="diff-view">
            <div v-if="!currentFile" class="diff-empty">无文件变更</div>
            <div v-else-if="currentFile.binary" class="diff-empty">二进制文件，不显示 diff</div>
            <div v-else ref="host" class="cm-host"></div>
          </div>
        </div>
      </template>
    </div>
  </el-dialog>
</template>

<script setup>
import { ref, computed, nextTick, watch } from 'vue'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { MergeView, unifiedMergeView } from '@codemirror/merge'
import api from '../api.js'

const props = defineProps({ visible: Boolean, commit: Object })
defineEmits(['update:visible'])

const loading = ref(false)
const error = ref('')
const data = ref(null)
const currentPath = ref('')
const viewMode = ref('unified')
const host = ref(null)
let view = null // EditorView | MergeView 实例

const currentFile = computed(
  () => (data.value ? data.value.files.find((f) => f.path === currentPath.value) : null) || null
)

const READ_ONLY = [EditorState.readOnly.of(true), EditorView.editable.of(false)]

async function load() {
  if (!props.commit) return
  loading.value = true
  error.value = ''
  data.value = null
  try {
    data.value = await api.commitDiff(props.commit.id)
    currentPath.value = data.value.files[0]?.path || ''
  } catch (e) {
    error.value = e && e.message ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function destroyView() {
  if (view) {
    view.destroy()
    view = null
  }
}

async function renderCurrent() {
  destroyView()
  const f = currentFile.value
  if (!f || f.binary) return
  if (!host.value) {
    // el-dialog 经 transition 插入，首次触发时容器可能尚未就绪，稍等重试
    await new Promise((resolve) => setTimeout(resolve, 80))
  }
  await nextTick()
  if (!host.value) return
  host.value.innerHTML = ''
  if (viewMode.value === 'split') {
    view = new MergeView({
      a: { doc: f.old, extensions: [basicSetup, READ_ONLY] },
      b: { doc: f.new, extensions: [basicSetup, READ_ONLY] },
      parent: host.value,
      collapseUnchanged: { margin: 3, minSize: 4 },
      highlightChanges: true,
      gutter: true
    })
  } else {
    view = new EditorView({
      doc: f.new,
      extensions: [
        basicSetup,
        READ_ONLY,
        unifiedMergeView({
          original: f.old,
          collapseUnchanged: { margin: 3, minSize: 4 },
          gutter: true,
          mergeControls: false,
          allowInlineDiffs: true
        })
      ],
      parent: host.value
    })
  }
}

function selectFile(path) {
  currentPath.value = path
  renderCurrent()
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      load().then(() => renderCurrent())
    } else {
      destroyView()
    }
  },
  { flush: 'post' }
)
</script>

<style scoped>
.diff-header {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding-right: 32px;
}
.diff-title {
  font-weight: 600;
}
.diff-meta {
  color: #909399;
  font-size: 12px;
}
.diff-subject {
  color: #606266;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.diff-body {
  min-height: 200px;
}
.diff-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.file-summary {
  color: #909399;
  font-size: 12px;
}
.diff-main {
  display: flex;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  overflow: hidden;
}
.diff-files {
  width: 260px;
  flex-shrink: 0;
  border-right: 1px solid #e4e7ed;
  overflow-y: auto;
  max-height: 72vh;
}
.diff-file-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 12px;
  border-bottom: 1px solid #f2f3f5;
}
.diff-file-item:hover {
  background: #f5f7fa;
}
.diff-file-item.active {
  background: #ecf5ff;
}
.file-path {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-stat {
  flex-shrink: 0;
}
.file-stat .add {
  color: #67c23a;
}
.file-stat .del {
  color: #f56c6c;
  margin-left: 4px;
}
.diff-view {
  flex: 1;
  min-width: 0;
}
.diff-empty {
  padding: 40px;
  text-align: center;
  color: #909399;
}
.cm-host {
  height: 72vh;
  overflow: auto;
}
</style>
