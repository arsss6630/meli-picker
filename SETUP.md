# 部署指南

## 第一步：注册 API 服务

### 1. ScraperAPI（抓取美客多数据）

1. 访问 https://www.scraperapi.com/
2. 注册账号（免费 5000 次/月）
3. 复制 API Key

### 2. 智谱AI（已有）

- 使用现有 Key: 在 image-gen 项目中

## 第二步：创建 D1 数据库

```bash
cd /Users/lei/Desktop/game-sites-project/meli-picker/worker

# 创建数据库
wrangler d1 create meli-picker-db

# 输出示例:
# ✅ Successfully created database 'meli-picker-db'
# database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

# 复制 database_id 到 wrangler.toml
```

执行 schema：
```bash
wrangler d1 execute meli-picker-db --file=schema.sql
```

## 第三步：配置 Secrets

```bash
# 设置智谱 API Key
wrangler secret put ZHIPU_API_KEY
# 输入: 你的智谱API Key

# 设置 ScraperAPI Key
wrangler secret put SCRAPER_API_KEY
# 输入: 你的ScraperAPI Key
```

## 第四步：修改 Worker 代码

编辑 `worker/index.js`，将顶部的占位符替换：

```javascript
const ZHIPU_API_KEY = 'YOUR_ZHIPU_API_KEY';    // 删除这行（使用 secret）
const SCRAPER_API_KEY = 'YOUR_SCRAPER_API_KEY'; // 删除这行（使用 secret）
```

改为从环境变量读取：

```javascript
// 在 fetch 函数内部获取
const ZHIPU_API_KEY = env.ZHIPU_API_KEY;
const SCRAPER_API_KEY = env.SCRAPER_API_KEY;
```

## 第五步：部署 Worker

```bash
cd /Users/lei/Desktop/game-sites-project/meli-picker/worker
wrangler deploy
```

## 第六步：部署前端

### 方法A：Cloudflare Pages（推荐）

1. GitHub 创建仓库 `meli-picker`
2. 推送代码
3. Cloudflare Dashboard → Pages → 创建项目 → 连接 Git
4. 构建设置：
   - 构建命令：留空
   - 构建输出目录：`frontend`
5. 添加自定义域名 `pick.8ai.chat`

### 方法B：直接上传

```bash
cd /Users/lei/Desktop/game-sites-project/meli-picker/frontend
wrangler pages deploy . --project-name=meli-picker
```

## 第七步：配置路由

在 Cloudflare Dashboard → Workers → meli-picker-api：
- 添加路由：`api.8ai.chat/pick/*` → Zone: 8ai.chat

## 本地测试

```bash
# 启动前端预览
cd /Users/lei/Desktop/game-sites-project/meli-picker/frontend
python3 -m http.server 8080
# 访问 http://localhost:8080

# 本地运行 Worker
cd /Users/lei/Desktop/game-sites-project/meli-picker/worker
wrangler dev
# API 地址 http://localhost:8787/pick/analyze
```

## 费用估算

| 服务 | 免费额度 | 超出费用 |
|------|----------|----------|
| ScraperAPI | 5000次/月 | $0.001/次 |
| 智谱AI GLM-4-Flash | 无限 | 免费 |
| Cloudflare Workers | 10万次/天 | $0.50/百万次 |
| Cloudflare D1 | 5GB | $0.75/GB |
| Cloudflare Pages | 无限 | 免费 |

**MVP阶段月成本：$0**（免费额度内）

## 验证部署

```bash
# 测试 API
curl -X POST https://api.8ai.chat/pick/analyze \
  -H "Content-Type: application/json" \
  -d '{"keyword":"phone case","site":"MLM"}'

# 测试健康检查
curl https://api.8ai.chat/pick/health
```

## 常见问题

### Q: ScraperAPI 返回错误？
A: 检查 API Key 是否正确，免费额度是否用完

### Q: AI 分析返回默认值？
A: 智谱 API 可能超时，检查网络和 Key

### Q: 前端无法连接 API？
A: 检查 CORS 配置，确认 API 路由正确
