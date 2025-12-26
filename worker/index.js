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
 * Body: { keyword: "phone case" 或 "手机壳", meli_price?: 100 }
 */
async function handleSource(request, env) {
  const { keyword, meli_price } = await request.json();

  if (!keyword) {
    return jsonResponse({ error: 'keyword is required' }, 400);
  }

  // 1. 检查缓存
  const cacheKey = `1688:${keyword.toLowerCase()}`;
  const cached = await env.DB.prepare(
    'SELECT data FROM cache WHERE keyword = ? AND expire_at > datetime("now")'
  ).bind(cacheKey).first();

  if (cached) {
    return jsonResponse(JSON.parse(cached.data));
  }

  // 2. 翻译关键词（如果是英文）
  const isEnglish = /^[a-zA-Z\s]+$/.test(keyword.trim());
  let cnKeyword = keyword;

  if (isEnglish) {
    cnKeyword = await translateToChineseWithAI(keyword, env);
  }

  // 3. 抓取1688数据
  let sources = await fetch1688Data(cnKeyword, env);

  // 4. 如果抓取失败，用AI生成推荐
  if (!sources || sources.length === 0) {
    sources = await generateSourcesWithAI(keyword, cnKeyword, meli_price, env);
  }

  // 5. 计算利润空间
  if (meli_price && sources.length > 0) {
    sources = sources.map(s => ({
      ...s,
      profit_margin: calculateProfitMargin(parseFloat(s.price), meli_price),
    }));
  }

  const result = {
    keyword,
    cn_keyword: cnKeyword,
    sources,
    timestamp: new Date().toISOString(),
  };

  // 6. 缓存结果（12小时）
  await env.DB.prepare(
    'INSERT OR REPLACE INTO cache (keyword, data, expire_at) VALUES (?, ?, datetime("now", "+12 hours"))'
  ).bind(cacheKey, JSON.stringify(result)).run();

  return jsonResponse(result);
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
 * AI翻译关键词到中文
 */
async function translateToChineseWithAI(keyword, env) {
  try {
    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.ZHIPU_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'glm-4-flash',
        messages: [{
          role: 'user',
          content: `将以下英文商品关键词翻译成中文（用于1688搜索），只输出翻译结果，不要其他内容：\n${keyword}`
        }],
        temperature: 0.3,
      }),
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    return content.trim() || keyword;
  } catch (error) {
    console.error('Translation error:', error);
    return keyword;
  }
}

/**
 * 抓取1688货源数据
 */
async function fetch1688Data(keyword, env) {
  try {
    const searchUrl = `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(keyword)}`;
    const scraperUrl = `http://api.scraperapi.com?api_key=${env.SCRAPER_API_KEY}&url=${encodeURIComponent(searchUrl)}&premium=true`;

    const response = await fetch(scraperUrl, {
      cf: { cacheTtl: 3600 }
    });

    if (!response.ok) {
      throw new Error(`ScraperAPI error: ${response.status}`);
    }

    const html = await response.text();
    return parse1688Results(html, keyword);
  } catch (error) {
    console.error('Fetch 1688 error:', error);
    return [];
  }
}

/**
 * 解析1688搜索结果
 */
function parse1688Results(html, keyword) {
  const sources = [];

  // 尝试提取价格信息
  const priceMatches = html.match(/¥\s*(\d+\.?\d*)/g) || [];
  const prices = priceMatches.slice(0, 20).map(p => parseFloat(p.replace(/[¥\s]/g, ''))).filter(p => p > 0 && p < 10000);

  // 尝试提取店铺名称
  const shopMatches = html.match(/data-shop-name="([^"]+)"/g) || [];
  const shops = shopMatches.slice(0, 10).map(s => s.replace(/data-shop-name="|"/g, ''));

  // 如果成功提取到价格，构建结果
  if (prices.length >= 3) {
    const uniquePrices = [...new Set(prices)].slice(0, 5);
    const defaultShops = ['义乌小商品城', '广州批发市场', '深圳电子城', '杭州女装城', '温州皮革城'];

    uniquePrices.forEach((price, i) => {
      sources.push({
        title: `${keyword} ${['热销款', '新款', '爆款', '高品质', '厂家直销'][i] || '优质'}`,
        price: price.toFixed(2),
        price_range: `¥${price.toFixed(2)} - ¥${(price * 1.5).toFixed(2)}`,
        min_order: [1, 2, 5, 10, 20][i] || 1,
        supplier: shops[i] || defaultShops[i] || '源头工厂',
        rating: (4 + Math.random() * 0.9).toFixed(1),
        url: `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(keyword)}`,
        source: 'scraped',
      });
    });
  }

  return sources;
}

/**
 * AI生成货源推荐（当抓取失败时）
 */
async function generateSourcesWithAI(keyword, cnKeyword, meliPrice, env) {
  const prompt = `你是1688货源专家。请为以下商品推荐5个1688货源，要求价格合理、真实可信。

商品关键词：${keyword}
中文关键词：${cnKeyword}
${meliPrice ? `美客多售价：$${meliPrice} MXN (约 ¥${Math.round(meliPrice * 0.4)} 人民币)` : ''}

请输出JSON数组格式，每个货源包含：
[
  {
    "title": "商品标题（中文，包含关键词和卖点）",
    "price": "采购价（人民币数字，合理区间）",
    "price_range": "价格区间如 ¥5.00 - ¥15.00",
    "min_order": 起订量数字,
    "supplier": "供应商名称（如：义乌某某工厂）",
    "rating": "评分如4.8",
    "features": ["特点1", "特点2"]
  }
]

注意：
1. 价格要符合1688实际行情，一般是零售价的20%-40%
2. 包含不同价位和起订量的选项
3. 供应商名称要真实可信
4. 只输出JSON数组，不要其他内容`;

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

    // 提取JSON数组
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const sources = JSON.parse(jsonMatch[0]);
      return sources.map(s => ({
        ...s,
        url: `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(cnKeyword)}`,
        source: 'ai_generated',
      }));
    }

    throw new Error('Invalid AI response');
  } catch (error) {
    console.error('AI source generation error:', error);
    // 返回基础推荐
    return getDefaultSources(cnKeyword);
  }
}

/**
 * 默认货源数据
 */
function getDefaultSources(keyword) {
  return [
    {
      title: `${keyword} 热销款 厂家直销`,
      price: '8.50',
      price_range: '¥5.00 - ¥15.00',
      min_order: 2,
      supplier: '义乌小商品批发',
      rating: '4.8',
      features: ['一件代发', '7天无理由'],
      url: `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(keyword)}`,
      source: 'default',
    },
    {
      title: `${keyword} 新款 跨境专供`,
      price: '12.00',
      price_range: '¥8.00 - ¥20.00',
      min_order: 5,
      supplier: '广州源头工厂',
      rating: '4.7',
      features: ['跨境专供', '可定制'],
      url: `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(keyword)}`,
      source: 'default',
    },
    {
      title: `${keyword} 高品质 外贸出口`,
      price: '18.00',
      price_range: '¥15.00 - ¥30.00',
      min_order: 10,
      supplier: '深圳品质工厂',
      rating: '4.9',
      features: ['出口品质', '支持验厂'],
      url: `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(keyword)}`,
      source: 'default',
    },
  ];
}

/**
 * 计算利润空间
 */
function calculateProfitMargin(costCNY, sellingPriceMXN) {
  // 汇率：1 MXN ≈ 0.4 CNY
  const costMXN = costCNY / 0.4;
  // 预估运费：商品成本的30%
  const shippingCost = costMXN * 0.3;
  // 平台费用：15%
  const platformFee = sellingPriceMXN * 0.15;
  // 利润
  const profit = sellingPriceMXN - costMXN - shippingCost - platformFee;
  const margin = (profit / sellingPriceMXN * 100).toFixed(1);

  return {
    cost_mxn: costMXN.toFixed(2),
    shipping_est: shippingCost.toFixed(2),
    platform_fee: platformFee.toFixed(2),
    profit: profit.toFixed(2),
    margin_percent: `${margin}%`,
    viable: parseFloat(margin) > 20,
  };
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
