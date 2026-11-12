// electron/tts-endpoint.js —— 自定义 TTS 服务地址校验（纯函数，无 Electron / DOM 依赖）
//
// 为什么需要它：主进程会把 safeStorage 解密后的 API Key 作为 Authorization 头附在
// 请求上，而服务地址来自渲染层。如果渲染层被注入脚本，它就能把 Key 指向任意主机。
// 这里把「可信目的地」收敛成一条明确的规则，供主进程与测试共用：
//   - 只接受 http(s)，拒绝 URL 内嵌账号密码
//   - http 只允许本机回环（本地跑 GPT-SoVITS / LM Studio 等兼容服务）
//   - https 默认拒绝私网 / 链路本地 / .local 地址（防内网探测与云元数据端点）；
//     确有需要时用 WASTELAND_ALLOW_PRIVATE_TTS=1 显式放开
const PUBLIC_SUFFIX = '/audio/speech';

function stripBrackets(host) {
  const h = String(host || '').toLowerCase();
  return h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h;
}

export function isLoopbackHost(host) {
  const h = stripBrackets(host);
  if (h === 'localhost' || h === '::1') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

export function isPrivateHost(host) {
  const h = stripBrackets(host);
  if (isLoopbackHost(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;          // 链路本地（含 169.254.169.254 元数据端点）
  if (h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '0.0.0.0' || h === '::') return true;
  if (/^(fc|fd)[0-9a-f]{2}:/.test(h)) return true;  // IPv6 唯一本地地址
  if (/^fe[89ab][0-9a-f]:/.test(h)) return true;    // IPv6 链路本地
  return false;
}

/**
 * 校验并规范化自定义 TTS 服务地址。
 * @param {string} raw 渲染层传入的 Base URL
 * @param {{allowPrivate?: boolean}} [opts] 测试或显式放行私网时使用
 * @returns {{ok: true, url: string, origin: string} | {ok: false, error: string}}
 */
export function normalizeTtsBaseUrl(raw, opts = {}) {
  const allowPrivate = opts.allowPrivate != null
    ? !!opts.allowPrivate
    : process.env.WASTELAND_ALLOW_PRIVATE_TTS === '1';
  const text = String(raw || '').trim();
  if (!text) return { ok: false, error: '缺少自定义 TTS 服务地址（Base URL）' };

  let u;
  try { u = new URL(text); } catch (_) { return { ok: false, error: '服务地址格式无效' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { ok: false, error: '服务地址只支持 http(s)' };
  }
  if (u.username || u.password) return { ok: false, error: '服务地址不能包含账号密码' };

  const host = stripBrackets(u.hostname);
  if (!host) return { ok: false, error: '服务地址缺少主机名' };

  if (u.protocol === 'http:' && !isLoopbackHost(host) && !allowPrivate) {
    return { ok: false, error: 'http 只允许本机地址；远程服务请使用 https' };
  }
  if (u.protocol === 'https:' && isPrivateHost(host) && !allowPrivate) {
    return { ok: false, error: '出于安全考虑，默认禁止把 API Key 发往内网/链路本地地址' };
  }

  const pathPart = u.pathname.replace(/\/+$/, '');
  const full = u.origin + pathPart;
  const url = /\/audio\/speech$/i.test(full) ? full : full + PUBLIC_SUFFIX;
  return { ok: true, url, origin: u.origin };
}

/** 两个地址是否同源（用于「Key 绑定到保存时的服务地址」）。 */
export function sameOrigin(a, b) {
  try { return new URL(String(a)).origin === new URL(String(b)).origin; }
  catch (_) { return false; }
}
