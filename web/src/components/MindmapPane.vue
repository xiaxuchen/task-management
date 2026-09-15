<template>
  <div class="mindmap-pane">
    <div class="mindmap-toolbar">
      <el-radio-group v-model="scope" size="small" @change="load">
        <el-radio-button value="self">仅本节点</el-radio-button>
        <el-radio-button value="subtree">含子树</el-radio-button>
      </el-radio-group>
      <span class="mindmap-stats">
        节点 {{ data.totals?.nodes ?? 0 }} · 连接 {{ data.totals?.edges ?? 0 }} · 深度 {{ data.totals?.depth ?? 0 }}
        <template v-if="data.totals?.truncated"> · 已截断 {{ data.totals.truncated }}</template>
      </span>
      <el-button size="small" :disabled="!data.mermaid" @click="copy">复制 mermaid</el-button>
    </div>
    <el-alert
      v-if="data.totals && data.totals.nodes <= 1"
      type="info"
      :closable="false"
      title="该范围只有本节点；切到「含子树」可俯瞰整棵需求树"
      style="margin-bottom:10px"
    />
    <div v-show="data.mermaid" ref="hostRef" class="mindmap-host" />
    <el-empty v-if="!data.mermaid" description="暂无导图" />
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import Vditor from 'vditor'
import 'vditor/dist/index.css'
import api from '../api.js'

const props = defineProps({ nodeId: { type: Number, required: true } })

// Vditor 按 `${CDN}/dist/js/...` 取 lute / mermaid，不依赖外网 CDN（与 DocPane 一致）
const CDN = '/vditor'
const RENDER_OPTIONS = {
  cdn: CDN,
  lang: 'zh_CN',
  theme: { current: 'light' },
  hljs: { style: 'github' },
  markdown: { toc: false, mark: false, mermaid: true, math: { engine: 'KaTeX' } }
}

const scope = ref('subtree')
const data = ref({})
const hostRef = ref(null)

async function load() {
  try {
    data.value = await api.mindmap(props.nodeId, scope.value)
  } catch (e) {
    data.value = {}
    ElMessage.error(e.message)
    return
  }
  await render()
}

/** 用一段 ```mermaid 代码块喂 Vditor.preview，复用站点既有的 mermaid 渲染链路 */
async function render() {
  const el = hostRef.value
  if (!el) return
  el.innerHTML = ''
  if (!data.value.mermaid) return
  await nextTick()
  await Vditor.preview(el, '```mermaid\n' + data.value.mermaid + '\n```\n', RENDER_OPTIONS)
}

async function copy() {
  try {
    await navigator.clipboard.writeText(data.value.mermaid)
    ElMessage.success('已复制 mermaid')
  } catch {
    ElMessage.error('复制失败，请手动选取')
  }
}

onMounted(load)
watch(() => props.nodeId, load)
onBeforeUnmount(() => {
  if (hostRef.value) hostRef.value.innerHTML = ''
})
</script>

<style scoped>
.mindmap-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.mindmap-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.mindmap-stats {
  flex: 1;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.mindmap-host {
  flex: 1;
  min-height: 240px;
  overflow: auto;
}
</style>
