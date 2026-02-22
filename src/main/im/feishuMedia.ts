/**
 * Feishu Media Upload Utilities
 * 飞书媒体上传工具函数
 */
import { Readable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';

// 类型定义
export type FeishuFileType = 'opus' | 'mp4' | 'pdf' | 'doc' | 'xls' | 'ppt' | 'stream';

export interface FeishuImageUploadResult {
  success: boolean;
  imageKey?: string;
  error?: string;
}

export interface FeishuFileUploadResult {
  success: boolean;
  fileKey?: string;
  error?: string;
}

// 常量定义
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.ico', '.tiff'];
const MAX_FILE_SIZE = 30 * 1024 * 1024; // 飞书文件大小限制：30MB

/**
 * 上传图片到飞书
 * @param client - 飞书 REST 客户端
 * @param image - Buffer 缓冲区或文件路径
 * @param imageType - 'message' 表示聊天图片，'avatar' 表示头像图片
 */
export async function uploadImageToFeishu(
  client: any,
  image: Buffer | string,
  imageType: 'message' | 'avatar' = 'message'
): Promise<FeishuImageUploadResult> {
  try {
    // 如果提供的是文件路径，验证文件大小
    if (typeof image === 'string') {
      const stats = fs.statSync(image);
      if (stats.size > MAX_FILE_SIZE) {
        return {
          success: false,
          error: `图片过大：${(stats.size / 1024 / 1024).toFixed(1)}MB（限制 30MB）`
        };
      }
    } else if (image.length > MAX_FILE_SIZE) {
      return {
        success: false,
        error: `图片过大：${(image.length / 1024 / 1024).toFixed(1)}MB（限制 30MB）`
      };
    }

    // SDK 需要一个可读流（Readable stream）
    const imageStream = typeof image === 'string'
      ? fs.createReadStream(image)
      : Readable.from(image);

    const response = await client.im.image.create({
      data: {
        image_type: imageType,
        image: imageStream as any,
      },
    });

    const responseAny = response as any;
    if (responseAny.code !== undefined && responseAny.code !== 0) {
      return {
        success: false,
        error: `飞书错误：${responseAny.msg || `错误码 ${responseAny.code}`}`
      };
    }

    // SDK v1.30+ 可能以不同格式返回数据
    const imageKey = responseAny.image_key ?? responseAny.data?.image_key;
    if (!imageKey) {
      return { success: false, error: '未返回 image_key' };
    }

    return { success: true, imageKey };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * 上传文件到飞书
 * @param client - 飞书 REST 客户端
 * @param file - Buffer 缓冲区或文件路径
 * @param fileName - 文件名称
 * @param fileType - 飞书文件类型
 * @param duration - 时长（毫秒），用于音频/视频文件
 */
export async function uploadFileToFeishu(
  client: any,
  file: Buffer | string,
  fileName: string,
  fileType: FeishuFileType,
  duration?: number
): Promise<FeishuFileUploadResult> {
  try {
    // 验证文件大小
    if (typeof file === 'string') {
      const stats = fs.statSync(file);
      if (stats.size > MAX_FILE_SIZE) {
        return {
          success: false,
          error: `文件过大：${(stats.size / 1024 / 1024).toFixed(1)}MB（限制 30MB）`
        };
      }
    } else if (file.length > MAX_FILE_SIZE) {
      return {
        success: false,
        error: `缓冲区过大：${(file.length / 1024 / 1024).toFixed(1)}MB（限制 30MB）`
      };
    }

    // SDK 需要一个可读流（Readable stream）
    const fileStream = typeof file === 'string'
      ? fs.createReadStream(file)
      : Readable.from(file);

    const response = await client.im.file.create({
      data: {
        file_type: fileType,
        file_name: fileName,
        file: fileStream as any,
        ...(duration !== undefined && { duration }),
      },
    });

    const responseAny = response as any;
    if (responseAny.code !== undefined && responseAny.code !== 0) {
      return {
        success: false,
        error: `飞书错误：${responseAny.msg || `错误码 ${responseAny.code}`}`
      };
    }

    const fileKey = responseAny.file_key ?? responseAny.data?.file_key;
    if (!fileKey) {
      return { success: false, error: '未返回 file_key' };
    }

    return { success: true, fileKey };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * 根据文件扩展名检测飞书文件类型
 */
export function detectFeishuFileType(fileName: string): FeishuFileType {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case '.opus':
    case '.ogg':
      return 'opus';
    case '.mp4':
    case '.mov':
    case '.avi':
      return 'mp4';
    case '.pdf':
      return 'pdf';
    case '.doc':
    case '.docx':
      return 'doc';
    case '.xls':
    case '.xlsx':
      return 'xls';
    case '.ppt':
    case '.pptx':
      return 'ppt';
    default:
      return 'stream';
  }
}

/**
 * 检查文件路径是否指向图片文件
 */
export function isFeishuImagePath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

/**
 * 检查文件路径是否指向音频文件
 */
export function isFeishuAudioPath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ['.opus', '.ogg', '.mp3', '.wav', '.m4a', '.aac', '.amr'].includes(ext);
}

/**
 * 解析文件路径（处理 file:// 协议和 ~ 主目录符号）
 */
export function resolveFeishuMediaPath(rawPath: string): string {
  let resolved = rawPath;

  // 处理 file:// 协议
  if (resolved.startsWith('file:///')) {
    resolved = decodeURIComponent(resolved.replace('file://', ''));
  }

  // 处理 ~ 主目录符号
  if (resolved.startsWith('~')) {
    resolved = resolved.replace('~', process.env.HOME || '');
  }

  return resolved;
}
