// functions/[[path]].js
export async function onRequest(context) {
  const { request, params } = context;
  // params.path 包含了捕获到的请求路径，例如访问 /dns-query 则 params.path 为 "dns-query"

  // 1. 定义你想要反向代理的目标 DoH 服务器基础地址
  // 例如，如果你想代理到 Cloudflare 的 DoH 服务，并保留路径
  const UPSTREAM_DOH_BASE = 'https://dns.alidns.com';
  // 或者，如果你想代理到 Google 的 DoH，但将所有请求都固定发送到 /dns-query 端点
  // const UPSTREAM_DOH_FIXED_ENDPOINT = 'https://dns.google/dns-query';

  const url = new URL(request.url);
  const upstreamUrl = new URL(UPSTREAM_DOH_BASE);

  // 2. 关键步骤：决定如何构建上游请求的 URL
  // 方案A（推荐-路径透传）：将客户端请求的路径原样附加到上游基础地址后。
  // 例如，客户端请求 /dns-query，则代理到 https://cloudflare-dns.com/dns-query
  // 客户端请求 /resolve?name=example.com&type=A，则代理到 https://cloudflare-dns.com/resolve?name=...
  upstreamUrl.pathname = '/' + (params.path || ''); // 保留原始路径
  upstreamUrl.search = url.search; // 保留所有查询参数（对于 GET 请求的 `?dns=...` 至关重要）

  // 方案B（路径重写）：忽略客户端请求的路径，将所有请求都固定发送到上游的某一个端点（如 /dns-query）。
  // upstreamUrl.pathname = '/dns-query'; // 强制所有请求都去 /dns-query
  // upstreamUrl.search = url.search;

  // 3. 只允许 GET 和 POST 方法（标准 DoH 方法）
  if (request.method !== 'GET' && request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: { 'Allow': 'GET, POST' } });
  }

  let dnsMessageBody = null;
  const contentType = 'application/dns-message';

  // 4. 处理 GET 和 POST 请求的 DNS 数据（与之前逻辑相同）
  if (request.method === 'POST') {
    if (!request.headers.get('content-type')?.includes(contentType)) {
      // 有些客户端可能用 application/dns-udpwireformat，这里放宽检查
      if (request.headers.get('content-type') !== 'application/dns-udpwireformat') {
        return new Response('Unsupported Media Type', { status: 415 });
      }
    }
    dnsMessageBody = request.body;
  } else { // GET 请求
    const dnsParam = url.searchParams.get('dns');
    if (!dnsParam) {
      // 如果不是 DoH 的 GET 请求，可能是 JSON 查询（如 /resolve?name=...），直接转发，不处理body
      dnsMessageBody = null;
    } else {
      // 处理 DoH 标准 GET 请求的 Base64Url 参数
      try {
        let base64 = dnsParam.replace(/-/g, '+').replace(/_/g, '/');
        const padLength = (4 - (base64.length % 4)) % 4;
        base64 = base64.padEnd(base64.length + padLength, '=');
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        dnsMessageBody = bytes.buffer;
      } catch (error) {
        return new Response('Invalid DNS Parameter', { status: 400 });
      }
    }
  }

  // 5. 构造转发到上游的请求头
  const forwardHeaders = new Headers();
  // 设置接受和内容类型
  forwardHeaders.set('Accept', `${contentType}, application/dns-json`);
  if (request.method === 'POST' && dnsMessageBody) {
    forwardHeaders.set('Content-Type', contentType);
  }
  // 修改 Host 头，这对于很多上游服务器是必需的校验
  forwardHeaders.set('Host', upstreamUrl.host);
  // 透传一些可能有用的客户端头
  const acceptLang = request.headers.get('Accept-Language');
  if (acceptLang) forwardHeaders.set('Accept-Language', acceptLang);

  // 6. 发起代理请求
  try {
    const upstreamRequest = new Request(upstreamUrl.toString(), {
      method: request.method, // 保持与客户端相同的 GET/POST 方法
      headers: forwardHeaders,
      body: dnsMessageBody, // 对于 GET 且无 dns 参数的情况，body 为 null
    });

    const upstreamResponse = await fetch(upstreamRequest);

    // 7. 将上游响应返回给客户端
    const responseHeaders = new Headers(upstreamResponse.headers);
    // 强烈建议设置无缓存，因为 DNS 响应是动态的
    responseHeaders.set('Cache-Control', 'no-store, max-age=0');
    // 确保内容类型正确
    if (!responseHeaders.has('Content-Type')) {
      responseHeaders.set('Content-Type', upstreamResponse.headers.get('content-type') || 'application/dns-message');
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error(`DoH Proxy Error for ${upstreamUrl}:`, error);
    return new Response('Bad Gateway', { status: 502 });
  }
}
