// functions/dns-query.js
export async function onRequest(context) {
  // 1. 定义你想要反向代理的目标 DoH 服务器
  const TARGET_DOH_SERVER = 'https://cloudflare-dns.com/dns-query'; // 示例：可改为任何支持 GET/POST 的 DoH 服务

  const request = context.request;
  const url = new URL(request.url);

  // 2. 只允许 GET 和 POST 方法
  if (request.method !== 'GET' && request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: { 'Allow': 'GET, POST' } });
  }

  let dnsMessageBody = null;
  let contentType = 'application/dns-message';

  // 3. 根据请求方法，提取 DNS 查询消息体
  if (request.method === 'POST') {
    // POST 请求：直接从请求主体读取二进制数据
    if (request.headers.get('content-type') !== contentType) {
      return new Response('Unsupported Media Type', { status: 415 });
    }
    dnsMessageBody = request.body; // 这是一个 ReadableStream
  } else { // GET 请求
    // 从 URL 的 `dns` 查询参数中获取 Base64Url 编码的字符串
    const dnsParam = url.searchParams.get('dns');
    if (!dnsParam) {
      return new Response('Missing DNS Parameter', { status: 400 });
    }
    try {
      // 3.1 将 Base64Url 编码转换为标准的 Base64，然后解码为二进制数组
      let base64 = dnsParam.replace(/-/g, '+').replace(/_/g, '/');
      // 补足可能的 Base64 填充字符
      const padLength = (4 - (base64.length % 4)) % 4;
      base64 = base64.padEnd(base64.length + padLength, '=');

      const binaryString = atob(base64); // 解码为二进制字符串
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      dnsMessageBody = bytes.buffer; // 转换为 ArrayBuffer
    } catch (error) {
      console.error('Base64 Decoding Error:', error);
      return new Response('Invalid DNS Parameter', { status: 400 });
    }
  }

  try {
    // 4. 准备转发到目标服务器的请求头
    const forwardHeaders = new Headers();
    // 设置必要的 DoH 头部
    forwardHeaders.set('Accept', contentType);
    forwardHeaders.set('Content-Type', contentType);
    // 修改 Host 头以匹配目标服务器（重要）
    forwardHeaders.set('Host', new URL(TARGET_DOH_SERVER).host);
    // 可选：传递原始客户端的一些头部（如 Accept-Language）
    const acceptLang = request.headers.get('Accept-Language');
    if (acceptLang) forwardHeaders.set('Accept-Language', acceptLang);

    // 5. 构造并发送请求到目标 DoH 服务器
    const dohRequest = new Request(TARGET_DOH_SERVER, {
      method: 'POST', // 注意：上游请求统一使用 POST
      headers: forwardHeaders,
      body: dnsMessageBody, // 无论原始请求是 GET 还是 POST，body 都是二进制 DNS 消息
    });

    const dohResponse = await fetch(dohRequest);

    // 6. 将响应返回给客户端
    const responseHeaders = new Headers(dohResponse.headers);
    responseHeaders.set('Content-Type', contentType);
    // 强烈建议阻止中间缓存，因为 DNS 响应具有实时性
    responseHeaders.set('Cache-Control', 'no-store, max-age=0');

    return new Response(dohResponse.body, {
      status: dohResponse.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('DoH Proxy Error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}
