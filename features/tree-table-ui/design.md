# 功能设计：表格式展开树（Web UI）

## 技术栈

- Vite 8 + Vue 3 + Element Plus（zh-cn）
- 后端静态托管 `web/dist/`，SPA 回退到 `index.html`

## 模块职责

- `web/src/api.js`：REST API 封装
- `web/src/App.vue`：壳 + el-menu 导航（任务树 / 属性定义 / 设置）
- `web/src/views/TreeView.vue`：el-table tree-props 展开树
  - 工具栏：搜索 + 类型/状态筛选 + 新建项目
  - 行点击 → emit('select') → App.vue 打开 NodeDrawer
  - 行操作：+ 添加子节点、+ 添加缺陷、删除（ElMessageBox 确认）
- `web/src/components/NodeDrawer.vue`：el-drawer
  - Tab 1 基本信息：名称编辑、状态切换、属性动态表单
  - Tab 2 文档：引入 DocPane
  - Tab 3 子节点：子节点列表
  - Tab 4 提交：commit 登记表单
- `web/src/components/DocPane.vue`：文档区（**Vditor**，设计文档 §5 / 决策 #12）
  - 左列文档名 el-menu，右列「预览 / 编辑」切换
  - 预览：`Vditor.preview()` 静态渲染 —— 代码块高亮+行号、表格、任务列表、mermaid、KaTeX、目录
  - 编辑：`new Vditor({ mode: 'ir' })` 即时渲染，工具栏 18 项；`blur` + 自动保存（轮询检测变化，停止输入 1.2s 落库）
  - 资源自托管：`scripts/copy-vditor.mjs` 同步 `node_modules/vditor/dist` → `web/public/vditor/dist`，`cdn='/vditor'`，不依赖外网 CDN
- `web/src/views/AttrDefsView.vue`：属性定义管理（行内编辑 + 新增弹窗）
- `web/src/views/SettingsView.vue`：配置页（端口、GitLab 地址/Token、连通性测试）

## 关键规则

- 后端 `createApp()` 不处理非 API 路由，由 `index.mjs` 添加静态托管 + SPA 回退
- Express 5 不支持 `*` 通配符路由，用 `app.use` 中间件判断 `req.path` 前缀
- `npm run build` 构建产物到 `web/dist/`
- **Vditor 资源路径规则是 `${cdn}/dist/js/...`**，故资源必须落在 `web/public/vditor/dist`（配 `cdn='/vditor'`）；`npm run build/dev` 前置 `prepare:vditor`，`npm install` 后由 `postinstall` 自动同步
- **Vditor 的 `input` 回调触发时机不稳定**（实测输入后数秒仍未回调），内容变化检测与自动保存改用 900ms 轮询；轮询必须在 `after` 回调里启动（构造后立即 `getValue()` 不可靠，会静默失效）
- **轮询间隔与防抖时长的冲突**：防抖定时器只能在「内容真正变化」时重置；若每次轮询都重置，900ms 轮询会把 1200ms 防抖无限推迟，导致永不保存