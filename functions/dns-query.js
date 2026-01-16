// functions/dns-query.js
export async function onRequest(context) {
  // 1. 定义你想要反向代理的目标 DoH 服务器
  // 例如：使用 Google DoH，则为 'https://dns.google/dns-query'
  // 注意：Cloudflare Pages 默认不支持代理到 853 (DoT) 端口
  const TARGET_DOH_SERVER = 'https://dns.alidns.com/dns-query'; // 请修改为你的目标地址

  const request = context.request;

  // 2. 只处理 POST 请求（标准 DoH 请求方法）
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    // 3. 从原始请求中克隆必要的头部信息
    const forwardHeaders = new Headers(request.headers);

    // 可选：修改 Host 头，以匹配目标服务器（有些 DoH 服务会校验）
    forwardHeaders.set('Host', new URL(TARGET_DOH_SERVER).host);

    // 4. 构造转发到目标 DoH 服务器的请求
    const dohRequest = new Request(TARGET_DOH_SERVER, {
      method: 'POST',
      headers: forwardHeaders,
      body: request.body, // 直接转发 DNS 查询的二进制body
    });

    // 5. 发起请求并获取响应
    const dohResponse = await fetch(dohRequest);

    // 6. 将目标服务器的响应返回给客户端
    const responseHeaders = new Headers(dohResponse.headers);
    // 确保返回正确的 Content-Type
    responseHeaders.set('Content-Type', 'application/dns-message');

    return new Response(dohResponse.body, {
      status: dohResponse.status,
      headers: responseHeaders,
    });
  } catch (error) {
    // 7. 错误处理
    console.error('DoH Proxy Error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}
