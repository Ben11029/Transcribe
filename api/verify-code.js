// Vercel Serverless Function
// 这个函数会在 Node.js 环境中运行

export default function handler(request, response) {
  // 1. 确保我们只处理 POST 请求
  if (request.method !== 'POST') {
    // 如果是 GET 或其他请求，返回 405 Method Not Allowed
    return response.status(405).json({ message: 'Only POST requests allowed' });
  }

  // 2. 从 Vercel 的环境变量中获取真实的访问码
  //    这个 'CODE' 就是您在 Vercel 控制面板里设置的那个变量名
  const correctCode = process.env.CODE;

  // 3. 从前端发来的请求体 (request body) 中获取用户输入的访问码
  const { accessCode } = request.body;

  // 4. 安全地比较两个访问码
  if (accessCode && accessCode === correctCode) {
    // 如果匹配，返回成功的 JSON 响应
    response.status(200).json({ success: true });
  } else {
    // 如果不匹配，返回失败的 JSON 响应和 401 Unauthorized 状态码
    response.status(401).json({ success: false, message: 'Invalid access code' });
  }
}