/**
 * 美客多AI选品助手 - API Worker
 * 域名: api.8ai.chat/pick
 *
 * 环境变量 (wrangler secret):
 * - ZHIPU_API_KEY: 智谱AI Key
 * - SCRAPER_API_KEY: ScraperAPI Key
 */

// CORS 头
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env, ctx) {
    // 处理 CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // 路由
      if (path === '/pick/analyze') {
        return await handleAnalyze(request, env);
      } else if (path === '/pick/source') {
        return await handleSource(request, env);
      } else if (path === '/pick/health') {
        return jsonResponse({ status: 'ok', time: new Date().toISOString() });
      } else {
        return jsonResponse({ error: 'Not Found' }, 404);
      }
    } catch (error) {
      console.error('Error:', error);
      return jsonResponse({ error: error.message }, 500);
    }
  },
};

/**
 * 市场分析 + AI蓝海机会
 * POST /pick/analyze
 * Body: { keyword: "phone case", site: "MLM" }
 */
async function handleAnalyze(request, env) {
  const { keyword, site = 'MLM' } = await request.json();

  if (!keyword) {
    return jsonResponse({ error: 'keyword is required' }, 400);
  }

  // 1. 先检查缓存
  const cacheKey = `meli:${site}:${keyword.toLowerCase()}`;
  const cached = await env.DB.prepare(
    'SELECT data FROM cache WHERE keyword = ? AND expire_at > datetime("now")'
  ).bind(cacheKey).first();

  if (cached) {
    return jsonResponse(JSON.parse(cached.data));
  }

  // 2. 抓取美客多数据
  const meliData = await fetchMeliData(keyword, site, env);

  // 3. AI 分析
  const aiAnalysis = await analyzeWithAI(keyword, meliData, env);

  // 4. 组装结果
  const result = {
    keyword,
    site,
    market: meliData,
    analysis: aiAnalysis,
    timestamp: new Date().toISOString(),
  };

  // 5. 缓存结果（24小时）
  await env.DB.prepare(
    'INSERT OR REPLACE INTO cache (keyword, data, expire_at) VALUES (?, ?, datetime("now", "+24 hours"))'
  ).bind(cacheKey, JSON.stringify(result)).run();

  return jsonResponse(result);
}

/**
 * 1688货源匹配
 * POST /pick/source
 * Body: { keyword: "手机壳", image_url?: "..." }
 */
async function handleSource(request, env) {
  const { keyword, image_url } = await request.json();

  if (!keyword && !image_url) {
    return jsonResponse({ error: 'keyword or image_url is required' }, 400);
  }

  // 模拟1688数据（后续接入真实API）
  const sources = await fetch1688Data(keyword);

  return jsonResponse({
    keyword,
    sources,
    timestamp: new Date().toISOString(),
  });
}

/**
 * 抓取美客多商品数据
 */
async function fetchMeliData(keyword, site, env) {
  // 美客多站点映射
  const siteMap = {
    'MLM': 'mercadolibre.com.mx', // 墨西哥
    'MLB': 'mercadolibre.com.br', // 巴西
    'MLA': 'mercadolibre.com.ar', // 阿根廷
    'MLC': 'mercadolibre.cl',     // 智利
    'MCO': 'mercadolibre.com.co', // 哥伦比亚
  };

  const domain = siteMap[site] || siteMap['MLM'];
  const searchUrl = `https://${domain}/jm/search?q=${encodeURIComponent(keyword)}`;

  try {
    // 使用 ScraperAPI 抓取（美客多需要 premium 模式）
    // 搜索URL格式: https://listado.mercadolibre.com.mx/关键词
    const listUrl = `https://listado.${domain}/${encodeURIComponent(keyword.replace(/\s+/g, '-'))}`;
    const scraperUrl = `http://api.scraperapi.com?api_key=${env.SCRAPER_API_KEY}&url=${encodeURIComponent(listUrl)}&premium=true`;

    const response = await fetch(scraperUrl, {
      cf: { cacheTtl: 3600 } // Cloudflare 缓存1小时
    });

    if (!response.ok) {
      throw new Error(`ScraperAPI error: ${response.status}`);
    }

    const html = await response.text();

    // 解析HTML提取数据
    return parseSearchResults(html);
  } catch (error) {
    console.error('Fetch Meli error:', error);
    // 返回模拟数据用于测试
    return getMockMeliData(keyword);
  }
}

/**
 * 解析美客多搜索结果
 */
function parseSearchResults(html) {
  // 简化版解析，实际需要更复杂的DOM解析
  const prices = [];
  const priceRegex = /\$[\d,]+(?:\.\d{2})?/g;
  const matches = html.match(priceRegex) || [];

  matches.slice(0, 50).forEach(p => {
    const num = parseFloat(p.replace(/[$,]/g, ''));
    if (num > 0 && num < 100000) prices.push(num);
  });

  // 计算统计数据
  const sorted = prices.sort((a, b) => a - b);
  const total = sorted.length;

  return {
    total_results: total * 20, // 估算总数
    price_min: sorted[0] || 0,
    price_max: sorted[total - 1] || 0,
    price_median: sorted[Math.floor(total / 2)] || 0,
    price_avg: total > 0 ? Math.round(sorted.reduce((a, b) => a + b, 0) / total) : 0,
    sample_size: total,
  };
}

/**
 * 模拟美客多数据（测试用）
 */
function getMockMeliData(keyword) {
  return {
    total_results: Math.floor(Math.random() * 50000) + 1000,
    price_min: Math.floor(Math.random() * 50) + 10,
    price_max: Math.floor(Math.random() * 500) + 200,
    price_median: Math.floor(Math.random() * 150) + 50,
    price_avg: Math.floor(Math.random() * 120) + 60,
    sample_size: 50,
    is_mock: true,
  };
}

/**
 * 智谱AI分析
 */
async function analyzeWithAI(keyword, marketData, env) {
  const prompt = `你是一个跨境电商选品专家，请分析以下美客多商品数据：

品类关键词：${keyword}
商品总数：${marketData.total_results}
价格区间：$${marketData.price_min} - $${marketData.price_max}
中位价格：$${marketData.price_median}
平均价格：$${marketData.price_avg}

请输出JSON格式的分析结果：
{
  "competition_score": 1-10的竞争激烈度评分,
  "competition_level": "低/中/高",
  "profit_potential": "高/中/低",
  "recommendation": "推荐/观望/避开",
  "reason": "50字以内的理由",
  "sub_niches": ["细分蓝海词1", "细分蓝海词2", "细分蓝海词3"],
  "differentiation_tips": ["差异化建议1", "差异化建议2"]
}

只输出JSON，不要其他内容。`;

  try {
    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.ZHIPU_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'glm-4-flash',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
      }),
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    // 提取JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    throw new Error('Invalid AI response');
  } catch (error) {
    console.error('AI analysis error:', error);
    // 返回默认分析
    return {
      competition_score: 5,
      competition_level: '中',
      profit_potential: '中',
      recommendation: '观望',
      reason: 'AI分析暂时不可用，请稍后重试',
      sub_niches: [],
      differentiation_tips: [],
    };
  }
}

/**
 * 获取1688货源数据
 */
async function fetch1688Data(keyword) {
  // TODO: 接入真实1688 API
  // 目前返回模拟数据
  return [
    {
      title: `${keyword} 热销款 厂家直销`,
      price: (Math.random() * 20 + 5).toFixed(2),
      min_order: Math.floor(Math.random() * 50) + 10,
      supplier: '义乌小商品城',
      rating: (Math.random() * 1 + 4).toFixed(1),
      url: 'https://detail.1688.com/offer/xxx.html',
    },
    {
      title: `${keyword} 新款 一件代发`,
      price: (Math.random() * 15 + 3).toFixed(2),
      min_order: 1,
      supplier: '广州源头工厂',
      rating: (Math.random() * 1 + 4).toFixed(1),
      url: 'https://detail.1688.com/offer/yyy.html',
    },
    {
      title: `${keyword} 爆款 跨境专供`,
      price: (Math.random() * 25 + 8).toFixed(2),
      min_order: Math.floor(Math.random() * 20) + 5,
      supplier: '深圳电子城',
      rating: (Math.random() * 1 + 4).toFixed(1),
      url: 'https://detail.1688.com/offer/zzz.html',
    },
  ];
}

/**
 * JSON 响应工具函数
 */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}
