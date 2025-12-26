-- 美客多AI选品助手 数据库 Schema
-- 创建命令: wrangler d1 execute meli-picker-db --file=schema.sql

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  openid TEXT UNIQUE,              -- 微信 openid
  nickname TEXT,
  avatar TEXT,
  free_quota INTEGER DEFAULT 3,    -- 免费查询次数
  is_vip INTEGER DEFAULT 0,        -- 是否VIP
  vip_expire_at TEXT,              -- VIP过期时间
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 查询记录表
CREATE TABLE IF NOT EXISTS queries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  keyword TEXT NOT NULL,
  site TEXT DEFAULT 'MLM',         -- 站点代码 MLM=墨西哥 MLB=巴西
  result_json TEXT,                -- 完整结果JSON
  competition_score INTEGER,       -- 竞争评分 1-10
  recommendation TEXT,             -- 推荐/观望/避开
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 缓存表（减少API调用）
CREATE TABLE IF NOT EXISTS cache (
  keyword TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  expire_at TEXT NOT NULL
);

-- 收藏表
CREATE TABLE IF NOT EXISTS favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  keyword TEXT NOT NULL,
  site TEXT DEFAULT 'MLM',
  notes TEXT,                      -- 用户备注
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE(user_id, keyword, site)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_queries_user ON queries(user_id);
CREATE INDEX IF NOT EXISTS idx_queries_keyword ON queries(keyword);
CREATE INDEX IF NOT EXISTS idx_cache_expire ON cache(expire_at);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);

-- 清理过期缓存的触发器（可选）
-- 每次插入新缓存时清理过期数据
CREATE TRIGGER IF NOT EXISTS cleanup_expired_cache
AFTER INSERT ON cache
BEGIN
  DELETE FROM cache WHERE expire_at < datetime('now');
END;
