// Vercel Serverless Function: api/transcribe-gemini.js
// 用于通过 Gemini Files API 和 Interactions API 处理音频转录

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(request, response) {
  // 设置 CORS 标头以支持跨域访问
  response.setHeader('Access-Control-Allow-Credentials', 'true');
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  response.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  if (request.method !== 'POST') {
    return response.status(405).json({ message: 'Only POST requests allowed' });
  }

  const {
    audioBase64,
    mimeType = 'audio/webm',
    apiKey,
    mode = 'smart',
    languageCodes = [],
    customVocabulary = []
  } = request.body || {};

  if (!apiKey) {
    return response.status(400).json({ message: 'Missing Gemini API key (缺少 Gemini API 密钥)' });
  }

  if (!audioBase64) {
    return response.status(400).json({ message: 'Missing audioBase64 data (缺少音频数据)' });
  }

  let fileName = null;

  try {
    const buffer = Buffer.from(audioBase64, 'base64');
    const cleanMimeType = mimeType.split(';')[0].trim() || 'audio/webm';

    // 1. 初始化 Files API Resumable 上传
    const initResponse = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': buffer.length.toString(),
        'X-Goog-Upload-Header-Content-Type': cleanMimeType,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        file: {
          display_name: `segment_${Date.now()}`
        }
      })
    });

    if (!initResponse.ok) {
      const errText = await initResponse.text();
      return response.status(initResponse.status).json({
        message: `Gemini Files API 初始化上传失败: ${initResponse.status} ${errText}`
      });
    }

    const uploadUrl = initResponse.headers.get('x-goog-upload-url');
    if (!uploadUrl) {
      return response.status(500).json({
        message: '未能从 Gemini Files API 获取上传地址 (x-goog-upload-url header missing)'
      });
    }

    // 2. 上传音频二进制数据
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Length': buffer.length.toString(),
        'X-Goog-Upload-Offset': '0',
        'X-Goog-Upload-Command': 'upload, finalize'
      },
      body: buffer
    });

    if (!uploadResponse.ok) {
      const errText = await uploadResponse.text();
      return response.status(uploadResponse.status).json({
        message: `音频文件上传至 Gemini 失败: ${uploadResponse.status} ${errText}`
      });
    }

    const fileInfo = await uploadResponse.json();
    const fileUri = fileInfo.file?.uri;
    fileName = fileInfo.file?.name;

    if (!fileUri) {
      return response.status(500).json({
        message: 'Gemini Files API 返回中缺少 file.uri'
      });
    }

    // 3. 构建 Interactions API 请求配置
    const transcriptionConfig = {
      mode: mode === 'smart' ? 'smart' : { type: 'verbatim' }
    };

    if (Array.isArray(languageCodes) && languageCodes.length > 0) {
      transcriptionConfig.language_codes = languageCodes;
    }

    if (Array.isArray(customVocabulary) && customVocabulary.length > 0) {
      transcriptionConfig.custom_vocabulary = customVocabulary;
    }

    const interactionPayload = {
      model: 'gemini-3.5-transcribe',
      input: [
        {
          type: 'audio',
          uri: fileUri,
          mime_type: cleanMimeType
        }
      ],
      generation_config: {
        transcription_config: transcriptionConfig
      }
    };

    // 4. 调用 Interactions API 进行转录
    const interactionResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/interactions?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(interactionPayload)
    });

    if (!interactionResponse.ok) {
      const errText = await interactionResponse.text();
      return response.status(interactionResponse.status).json({
        message: `Gemini Interactions API 转录失败: ${interactionResponse.status} ${errText}`
      });
    }

    const interaction = await interactionResponse.json();

    // 5. 提取转录文本
    let text = interaction.output_text || '';
    if (!text && interaction.steps && Array.isArray(interaction.steps)) {
      for (const step of interaction.steps) {
        if (step.content && Array.isArray(step.content)) {
          for (const item of step.content) {
            if (item.text) {
              text += (text ? '\n' : '') + item.text;
            }
          }
        }
      }
    }

    return response.status(200).json({
      success: true,
      text: text.trim()
    });
  } catch (error) {
    console.error('Gemini 转录处理异常:', error);
    return response.status(500).json({
      message: error.message || '转录处理异常'
    });
  } finally {
    // 异步清理上传的临时文件，释放 Google 存储配额
    if (fileName && apiKey) {
      fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${apiKey}`, {
        method: 'DELETE'
      }).catch(err => console.warn('清理临时文件失败:', err));
    }
  }
}
