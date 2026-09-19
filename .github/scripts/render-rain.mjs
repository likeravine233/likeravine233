// 雨量观测纸 · 真实 commit 数据版(GitHub 主页头图生成器)
// 一根柱 = 一天的公开 commit 数;雨峰顶端出现一线虹,整图唯一彩色。
//
// 用法:
//   node render-rain.mjs --demo        合成一场暴雨,写 repo/assets/(初始静态版/本地预览)
//   node render-rain.mjs --local       本地用 GIST_TOKEN(可传 `gh auth token`)拉真数据,写 repo/assets/
//   node render-rain.mjs --gh          本地用 gh CLI 拉 viewer 真实数据,写 repo/assets/
//   node render-rain.mjs               Action 内:用 GIST_TOKEN 拉 GraphQL 真数据,更新 Gist
//                                      (GIST_ID 未设时自动创建 Gist 并在日志输出 id)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const LOGIN = 'likeravine233';
const DAYS = 120;
const W = 1600, H = 400, M = 56, TOP = 148, BASE = 348;
// 观测站所在城市(顶部预报栏的数据源);换城市改这一行即可
const CITY = { name: 'NANJING', lat: 32.06, lon: 118.8, tz: 'Asia/Shanghai' };

// 自适应观测窗:从最近一次活动往前的完整记录期;下限 30 天,上限 DAYS,活动期后留 7天空窗
function viewWindow(days) {
  const first = days.findIndex((d) => d.count > 0);
  if (first < 0) return days.slice(-30);
  const span = Math.min(days.length, Math.max(30, days.length - first + 7));
  return days.slice(-span);
}

// ---------- 数据 ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const iso = (d) => d.toISOString().slice(0, 10);
const shift = (days) => iso(new Date(Date.now() - days * 864e5));

// 合成一场暴雨(前峰两阵 + 主峰 + 长尾),日期对齐到最近 DAYS 天;演示天气覆盖雨/云/雷三种图标
const DEMO_WX = [
  { wday: 'FRI', code: 61, hi: 26, lo: 18 },
  { wday: 'SAT', code: 2, hi: 24, lo: 17 },
  { wday: 'SUN', code: 95, hi: 22, lo: 16 },
];
function demoData() {
  const rnd = mulberry32(97);
  const gauss = (x, mu, sig) => Math.exp(-((x - mu) ** 2) / (2 * sig * sig));
  const days = [];
  for (let i = 0; i < DAYS; i++) {
    let v = rnd() * 2;
    v += 3 * gauss(i, 26, 3) + 2 * gauss(i, 48, 2.6) + 19 * gauss(i, 78, 5) + 3.5 * gauss(i, 97, 4);
    days.push({ date: shift(DAYS - 1 - i), count: Math.round(v) });
  }
  return days;
}

// 真实数据:viewer 的 contributionsCollection(公开贡献,任意有 gist 权限的 token 可读)
async function realData() {
  const from = shift(DAYS - 1), to = shift(0);
  const query = `query{viewer{contributionsCollection(from:"${from}T00:00:00Z",to:"${to}T23:59:59Z"){contributionCalendar{weeks{contributionDays{date contributionCount}}}}}}`;
  let calendar;
  if (process.argv.includes('--gh')) { // 本地预览:借 gh CLI 的登录态
    const r = spawnSync('gh', ['api', 'graphql', '-f', `query=${query}`], { encoding: 'utf8' });
    if (r.error) throw new Error('gh 无法启动:' + r.error.message);
    if (r.status !== 0) throw new Error('gh api 失败:' + ((r.stderr || r.stdout || '无输出') + '').slice(0, 300));
    calendar = JSON.parse(r.stdout).data.viewer.contributionsCollection.contributionCalendar;
  } else { // Action / --local:GIST_TOKEN
    const token = process.env.GIST_TOKEN;
    if (!token) throw new Error('缺少 GIST_TOKEN(本地可用 `gh auth token` 提供)');
    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'rainywatch-rain-gauge' },
      body: JSON.stringify({ query }),
    });
    const j = await res.json();
    if (j.errors || !j.data) throw new Error('GraphQL 失败:' + JSON.stringify(j.errors || j.message).slice(0, 300));
    calendar = j.data.viewer.contributionsCollection.contributionCalendar;
  }
  const flat = calendar.weeks.flatMap((w) => w.contributionDays).slice(-DAYS);
  if (flat.length < DAYS - 7) throw new Error(`贡献数据不足:仅 ${flat.length} 天`);
  return flat.map((d) => ({ date: d.date, count: d.contributionCount }));
}

// 天气:Open-Meteo 三日预报(免 key);失败重试一次后整栏省略,不影响主图
async function fetchWeather() {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${CITY.lat}&longitude=${CITY.lon}` +
    `&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=${encodeURIComponent(CITY.tz)}&forecast_days=3`;
  for (let t = 0; t < 2; t++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'rainywatch-rain-gauge' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const d = (await res.json()).daily;
      const WD = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
      return d.time.map((date, i) => ({
        wday: WD[new Date(date + 'T12:00:00Z').getUTCDay()],
        code: d.weathercode[i],
        hi: Math.round(d.temperature_2m_max[i]),
        lo: Math.round(d.temperature_2m_min[i]),
      }));
    } catch (e) {
      if (t === 1) { console.log('weather: 预报栏省略(' + e.message + ')'); return null; }
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

// ---------- 绘制 ----------
const palettes = {
  dark: {
    bg1: '#0C1322', bg2: '#0F1830', gridMinor: '#16223A', gridMajor: '#1E2E4C',
    bars: '#6E97C9', trace: '#7FA8D9', anno: '#5C7192', ink: '#C7D6EC', seal: '#C95050',
  },
  light: {
    bg1: '#FBFCFE', bg2: '#F2F6FA', gridMinor: '#EAEFF5', gridMajor: '#DCE5EF',
    bars: '#4A77AC', trace: '#33639F', anno: '#8DA0B8', ink: '#223550', seal: '#B54343',
  },
};
const mmdd = (date) => date.slice(5).replace('-', '/');

// WMO 天气码 → 线描图标类别
function wmoKind(code) {
  if (code <= 1) return 'sun';
  if (code === 2) return 'suncloud';
  if (code === 3 || code === 45 || code === 48) return 'cloud';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'cloud';
}

// 天气线描图标(与四角裁切标记同一笔触,24×24 局部坐标,不引入第二彩色)
function weatherGlyph(kind, color) {
  const st = `stroke="${color}" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"`;
  const cloud = 'M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z';
  const raised = `transform="translate(1.8 -1.2) scale(.85)"`;
  const rays = (cx, cy, r1, r2) => Array.from({ length: 8 }, (_, k) => {
    const a = (k * Math.PI) / 4, c = Math.cos(a), s = Math.sin(a);
    return `<line x1="${(cx + c * r1).toFixed(1)}" y1="${(cy + s * r1).toFixed(1)}" x2="${(cx + c * r2).toFixed(1)}" y2="${(cy + s * r2).toFixed(1)}"/>`;
  }).join('');
  const sun = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>${rays(cx, cy, r + 1.8, r + 3.4)}`;
  let inner = `<path d="${cloud}" transform="translate(1.8 .8) scale(.85)"/>`;
  if (kind === 'sun') inner = sun(12, 12, 4.2);
  else if (kind === 'suncloud') inner = sun(7.5, 7, 2.8) + `<path d="${cloud}" transform="translate(4.6 4.2) scale(.78)"/>`;
  else if (kind === 'rain') inner = `<path d="${cloud}" ${raised}/><path d="M8.6 17.8l-1.5 3.2M12.6 17.8l-1.5 3.2M16.6 17.8l-1.5 3.2"/>`;
  else if (kind === 'drizzle') inner = `<path d="${cloud}" ${raised}/><path d="M8.8 18.2h1.9M12.8 18.2h1.9M10.8 20.8h1.9"/>`;
  else if (kind === 'snow') inner = `<path d="${cloud}" ${raised}/><g fill="${color}" stroke="none"><circle cx="8.4" cy="18.6" r="1"/><circle cx="12.4" cy="18.6" r="1"/><circle cx="16.4" cy="18.6" r="1"/></g>`;
  else if (kind === 'storm') inner = `<path d="${cloud}" ${raised}/><path d="M12.9 15.6l-2.4 4h3l-2.4 4"/>`;
  else if (kind === 'fog') inner = `<path d="${cloud}" ${raised}/><path d="M6.5 19.6h11M8.5 22h7"/>`;
  return `<g ${st}>${inner}</g>`;
}

function svg(days, p, wx) {
  const mono = "'SF Mono','Cascadia Mono','JetBrains Mono',Consolas,Menlo,monospace";
  const cjk = "'PingFang SC','Microsoft YaHei','Noto Sans SC',sans-serif";
  const SLOT = (W - 2 * M) / days.length;
  const cMax = Math.max(...days.map((d) => d.count), 1);
  const hOf = (c) => 2.5 + Math.pow(c / cMax, 0.75) * 176; // 幂次曲线:小雨也有可见柱
  const peakI = days.reduce((b, d, i) => (d.count > days[b].count ? i : b), 0);
  const total = days.reduce((s, d) => s + d.count, 0);

  let s = '';
  // 方格纸:横线每 20px(主格每 100px = 10MM)+ 竖线每 100px
  for (let y = TOP; y <= BASE; y += 20) {
    const major = (BASE - y) % 100 === 0;
    s += `<line x1="${M}" y1="${y}" x2="${W - M}" y2="${y}" stroke="${major ? p.gridMajor : p.gridMinor}" stroke-width="${major ? 1.2 : 1}"/>\n`;
  }
  for (let x = M; x < W - M; x += 100) {
    s += `<line x1="${x}" y1="${TOP}" x2="${x}" y2="${BASE}" stroke="${p.gridMinor}" stroke-width="1"/>\n`;
  }

  // 雨量柱 + 迹线包络
  let bars = '', pts = [];
  const barW = Math.min(SLOT - 3.6, 18);
  days.forEach((d, i) => {
    const x = M + i * SLOT + (SLOT - barW) / 2;
    const h = hOf(d.count);
    bars += `<rect x="${x.toFixed(1)}" y="${(BASE - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${p.bars}" opacity=".72"/>\n`;
    if (i === peakI) {
      bars += `<rect x="${(x - 2).toFixed(1)}" y="${(BASE - h - 5).toFixed(1)}" width="${(barW + 4).toFixed(1)}" height="2.6" fill="url(#bow)"/>\n`;
    }
    pts.push(`${(x + barW / 2).toFixed(1)},${(BASE - h + (i === peakI ? 3.9 : 0)).toFixed(1)}`);
  });
  s += `<g>\n${bars}</g>\n`;
  s += `<polyline points="${pts.join(' ')}" fill="none" stroke="${p.trace}" stroke-width="1.5" opacity=".95"/>\n`;

  // 基线 + 日期刻度(首/末 + 均匀三档)
  s += `<line x1="${M}" y1="${BASE}" x2="${W - M}" y2="${BASE}" stroke="${p.trace}" stroke-width="1.6"/>\n`;
  const n = days.length;
  for (const i of [0, Math.round(n * 0.25), Math.round(n * 0.5), Math.round(n * 0.75), n - 1]) {
    const x = M + i * SLOT + SLOT / 2;
    s += `<line x1="${x}" y1="${BASE}" x2="${x}" y2="${BASE + 7}" stroke="${p.trace}" stroke-width="1.4"/>\n`;
    s += `<text x="${x.toFixed(1)}" y="${BASE + 24}" font-family="${mono}" font-size="15" fill="${p.anno}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}" letter-spacing="1">${mmdd(days[i].date)}</text>\n`;
  }
  // 图例置于图纸右下(日期轴下方,给顶部预报栏让位)
  s += `<text x="${W - M}" y="391" font-family="${mono}" font-size="13.5" fill="${p.anno}" text-anchor="end" letter-spacing="2">PRECIPITATION: COMMITS · 1 BAR = 1 DAY</text>\n`;
  // 旱季标注:最长连续零提交段 ≥10 天时,在基线上方标出
  let streak = 0, dry = { len: 0, end: 0 };
  days.forEach((d, i) => {
    streak = d.count === 0 ? streak + 1 : 0;
    if (streak > dry.len) dry = { len: streak, end: i };
  });
  if (dry.len >= 10) {
    const x1 = M + (dry.end - dry.len + 1) * SLOT + 2;
    const x2 = M + (dry.end + 1) * SLOT - 2;
    const y = BASE - 12;
    s += `<path d="M${x1.toFixed(1)} ${y + 5} V${y} H${x2.toFixed(1)} V${y + 5}" stroke="${p.anno}" stroke-width="1" fill="none" opacity=".8"/>\n`;
    s += `<text x="${((x1 + x2) / 2).toFixed(1)}" y="${y - 8}" font-family="${mono}" font-size="15" fill="${p.anno}" text-anchor="middle" letter-spacing="2">DRY SPELL · ${dry.len}D</text>\n`;
  }
  // 纵轴刻度值(每 100px = 10 MM)
  for (const [i, lbl] of [[0, '0'], [1, '10'], [2, '20 MM']]) {
    const y = BASE - i * 100;
    s += `<text x="${M - 8}" y="${y + 4.5}" font-family="${mono}" font-size="13.5" fill="${p.anno}" text-anchor="end" letter-spacing=".5">${lbl}</text>\n`;
  }

  // 左上:站名报头(大字站名 + 附属行,信头双线收底)
  s += `<text x="${M}" y="70" font-family="${mono}" font-size="46" font-weight="700" fill="${p.ink}" letter-spacing="8">RAINYWATCH<tspan dx="20" font-size="19" font-weight="400" fill="${p.anno}" letter-spacing="4.5">· METEOROLOGICAL STATION</tspan></text>\n`;
  s += `<text x="${M}" y="100" font-family="${mono}" font-size="17" fill="${p.anno}" letter-spacing="3">OBSERVER @${LOGIN.toUpperCase()} — ${total} COMMITS ON RECORD</text>\n`;
  s += `<line x1="${M}" y1="114" x2="${W - M}" y2="114" stroke="${p.ink}" stroke-width="2" opacity=".85"/>\n`;
  s += `<line x1="${M}" y1="119" x2="${W - M}" y2="119" stroke="${p.anno}" stroke-width=".75" opacity=".8"/>\n`;

  // 右上:图纸编号(每天一张新观测纸)
  s += `<text x="${W - M}" y="60" font-family="${mono}" font-size="19" fill="${p.ink}" text-anchor="end" letter-spacing="3">SHEET NO. ${mmdd(shift(0))}</text>\n`;

  // 顶部空白带:本市三日展望(生成时从 Open-Meteo 烘焙;无数据则整栏省略)
  if (wx && wx.length === 3) {
    const x0 = 880, segW = 118, gap = 16;
    s += `<text x="${x0}" y="54" font-family="${mono}" font-size="11.5" fill="${p.anno}" letter-spacing="2">OUTLOOK · ${CITY.name}</text>\n`;
    wx.forEach((w, i) => {
      const sx = x0 + i * (segW + gap);
      s += `<text x="${sx}" y="78" font-family="${mono}" font-size="12.5" fill="${p.ink}" letter-spacing="1.5">${w.wday}</text>\n`;
      s += `<g transform="translate(${sx + 34} 59) scale(.82)">${weatherGlyph(wmoKind(w.code), p.anno)}</g>\n`;
      s += `<text x="${sx + 58}" y="78" font-family="${mono}" font-size="13" fill="${p.anno}" letter-spacing=".5">${w.hi}°/${w.lo}°</text>\n`;
    });
  }

  // 峰顶虹的观测标注:固定行于信头线与图纸之间,按峰位与文字宽度自动选侧
  const px = M + peakI * SLOT + SLOT / 2;
  const pyTop = BASE - hOf(days[peakI].count) - 5;
  const annoText = `RAINBOW, OBSERVED — ${days[peakI].count} COMMITS ON ${mmdd(days[peakI].date)}`;
  const lane = 132, annoW = annoText.length * 11.9;
  const dir = px + 100 + annoW <= W - M ? 1 : -1;
  s += `<path d="M${(px + dir * 5).toFixed(1)} ${(pyTop - 8).toFixed(1)} L${(px + dir * 44).toFixed(1)} ${lane} H${(px + dir * 58).toFixed(1)}" stroke="${p.anno}" stroke-width="1.2" fill="none"/>\n`;
  if (dir === 1) {
    s += `<rect x="${(px + 62).toFixed(1)}" y="${lane - 1.5}" width="34" height="3" fill="url(#bow)"/>\n`;
    s += `<text x="${(px + 104).toFixed(1)}" y="${lane + 6}" font-family="${mono}" font-size="15.5" fill="${p.ink}" letter-spacing="2.5">${annoText}</text>\n`;
  } else {
    s += `<rect x="${(px - 96).toFixed(1)}" y="${lane - 1.5}" width="34" height="3" fill="url(#bow)"/>\n`;
    s += `<text x="${(px - 104).toFixed(1)}" y="${lane + 6}" font-family="${mono}" font-size="15.5" fill="${p.ink}" text-anchor="end" letter-spacing="2.5">${annoText}</text>\n`;
  }

  // 「小暴雨」印章:盖在雨峰对侧的空白处,微旋转
  const sealRight = peakI <= n * 0.6;
  const sx = sealRight ? 1442 : 62, rot = sealRight ? -4 : 3, scx = sealRight ? 1488 : 108;
  s += `<g transform="rotate(${rot} ${scx} 278)" opacity=".92">
    <rect x="${sx}" y="236" width="92" height="84" rx="8" stroke="${p.seal}" stroke-width="3" fill="none"/>
    <text x="${scx}" y="289" font-family="${cjk}" font-size="29" font-weight="600" fill="${p.seal}" text-anchor="middle" letter-spacing="1.5">小暴雨</text>
  </g>\n`;

  // 四角裁切标记
  const crop = (x, y, sx, sy) =>
    `<path d="M${x + 16 * sx} ${y} H${x} V${y + 16 * sy}" stroke="${p.anno}" stroke-width="1.2" fill="none" opacity=".55"/>\n`;
  s += crop(26, 26, 1, 1) + crop(W - 26, 26, -1, 1) + crop(26, H - 26, 1, -1) + crop(W - 26, H - 26, -1, -1);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" fill="none">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${p.bg1}"/><stop offset="1" stop-color="${p.bg2}"/>
    </linearGradient>
    <linearGradient id="bow" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#f87171"/><stop offset=".2" stop-color="#fbbf24"/>
      <stop offset=".4" stop-color="#a3e635"/><stop offset=".6" stop-color="#34d399"/>
      <stop offset=".8" stop-color="#38bdf8"/><stop offset="1" stop-color="#a78bfa"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  ${s}</svg>
`;
}

// ---------- 输出 ----------
const outDir = path.join(import.meta.dirname, '..', '..', 'assets');

async function main() {
  const files = {};
  if (process.argv.includes('--demo')) {
    const days = demoData();
    for (const [name, p] of Object.entries(palettes)) {
      const f = `header-${name}.svg`;
      fs.writeFileSync(path.join(outDir, f), svg(days, p, DEMO_WX));
      files[`header-${name}.svg`] = { content: svg(days, p, DEMO_WX) };
    }
    console.log('wrote repo/assets/header-*.svg(合成暴雨)');
    return;
  }
  const days = viewWindow(await realData());
  const wx = await fetchWeather();
  const peak = days.reduce((b, d) => (d.count > b.count ? d : b), days[0]);
  console.log(`数据:近 ${days.length} 天,共 ${days.reduce((s, d) => s + d.count, 0)} commits,峰值 ${peak.count}(${peak.date})`);
  if (wx) console.log(`weather: ${CITY.name} ` + wx.map((w) => `${w.wday} ${w.hi}°/${w.lo}°`).join(', '));
  for (const [name, p] of Object.entries(palettes)) {
    files[`header-${name}.svg`] = { content: svg(days, p, wx) };
  }
  if (process.argv.includes('--gh') || process.argv.includes('--local')) { // 本地预览真实数据
    for (const [name, payload] of Object.entries(files)) {
      fs.writeFileSync(path.join(outDir, name), payload.content);
    }
    console.log('wrote repo/assets/header-*.svg(真实数据预览)');
    return;
  }
  // Action 模式:写入 Gist
  const token = process.env.GIST_TOKEN;
  if (!token) throw new Error('缺少 GIST_TOKEN secret');
  const gistId = process.env.GIST_ID || '';
  const res = await fetch(`https://api.github.com/gists${gistId ? '/' + gistId : ''}`, {
    method: gistId ? 'PATCH' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'rainywatch-rain-gauge', Accept: 'application/vnd.github+json' },
    body: JSON.stringify({
      description: `RainyWatch rain-gauge banner — ${shift(0)}`,
      files,
      ...(gistId ? {} : { public: false }),
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Gist 更新失败: ${res.status} ${JSON.stringify(j.message)}`);
  console.log(`GIST_ID=${j.id}`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `gist_id=${j.id}\n`);
  }
  console.log('raw: https://gist.githubusercontent.com/' + LOGIN + '/' + j.id + '/raw/header-dark.svg');
}
main().catch((e) => { console.error(e.message); process.exit(1); });
