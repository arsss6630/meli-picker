# 美客多AI选品助手 (Meli Picker)

AI驱动的美客多选品工具，一键分析市场竞争、发现蓝海机会、匹配1688货源。

## 功能特性

- 🔍 **市场分析**：商品数量、价格区间、竞争程度
- 🌊 **蓝海挖掘**：AI识别低竞争细分品类
- 📦 **货源匹配**：自动匹配1688同款（开发中）
- 🌍 **多站点**：支持墨西哥/巴西/阿根廷/智利/哥伦比亚

## 技术栈

- **前端**：Vue 3 + Tailwind CSS（单文件，CDN引入）
- **后端**：Cloudflare Workers
- **数据库**：Cloudflare D1
- **AI**：智谱 GLM-4-Flash（免费）
- **爬虫**：ScraperAPI

## 快速部署

### 1. 创建 D1 数据库

```bash
cd worker
wrangler d1 create meli-picker-db
# 复制输出的 database_id 到 wrangler.toml

wrangler d1 execute meli-picker-db --file=schema.sql
```

### 2. 配置 API Key

```bash
# 智谱AI Key (https://open.bigmodel.cn)
wrangler secret put ZHIPU_API_KEY

# ScraperAPI Key (https://www.scraperapi.com)
wrangler secret put SCRAPER_API_KEY
```

### 3. 部署 Worker

```bash
cd worker
wrangler deploy
```

### 4. 部署前端

```bash
# 方法1: Cloudflare Pages (推荐)
# 在 Cloudflare Dashboard 创建 Pages 项目
# 连接 GitHub 仓库，设置构建目录为 frontend

# 方法2: 直接上传
cd frontend
wrangler pages deploy . --project-name=meli-picker
```

### 5. 配置自定义域名

在 Cloudflare Dashboard:
- Worker 添加路由: `api.8ai.chat/pick/*`
- Pages 添加域名: `pick.8ai.chat`

## API 接口

### POST /pick/analyze

分析品类市场数据

```json
// Request
{
  "keyword": "phone case",
  "site": "MLM"
}

// Response
{
  "keyword": "phone case",
  "site": "MLM",
  "market": {
    "total_results": 25000,
    "price_min": 15,
    "price_max": 350,
    "price_median": 85
  },
  "analysis": {
    "competition_score": 7,
    "recommendation": "观望",
    "sub_niches": ["phone case leather", "phone case minimal"],
    "differentiation_tips": ["增加本地化包装"]
  }
}
```

### POST /pick/source

匹配1688货源（开发中）

```json
// Request
{
  "keyword": "手机壳"
}
```

### GET /pick/health

健康检查

## 站点代码

| 代码 | 国家 |
|------|------|
| MLM | 🇲🇽 墨西哥 |
| MLB | 🇧🇷 巴西 |
| MLA | 🇦🇷 阿根廷 |
| MLC | 🇨🇱 智利 |
| MCO | 🇨🇴 哥伦比亚 |

## 目录结构

```
meli-picker/
├── worker/
│   ├── index.js          # Worker 主代码
│   ├── wrangler.toml     # Cloudflare 配置
│   └── schema.sql        # D1 数据库结构
├── frontend/
│   └── index.html        # 前端单页应用
└── README.md
```

## 下一步开发

- [ ] 接入真实 ScraperAPI
- [ ] 1688 货源匹配功能
- [ ] 用户登录 + 付费订阅
- [ ] 历史记录 + 收藏功能
- [ ] 批量分析 + 导出Excel

## 相关链接

- [美客多开放平台](https://developers.mercadolibre.com.mx/)
- [ScraperAPI](https://www.scraperapi.com/)
- [智谱AI开放平台](https://open.bigmodel.cn/)

---

Created: 2025-12-26
