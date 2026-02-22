import { CONFIG_KEYS } from '../config';
import { localStore } from './store';

// 导出密钥的字节长度（32字节 = 256位）
const EXPORT_KEY_BYTES = 32;
// AES-GCM 模式的初始化向量（IV）字节长度（12字节）
const AES_GCM_IV_BYTES = 12;

// 缓存的加密密钥
let cachedKey: CryptoKey | null = null;
// 缓存的密钥 Promise，用于避免重复创建
let cachedKeyPromise: Promise<CryptoKey> | null = null;

/**
 * 加密数据载荷接口
 * 包含加密后的数据和初始化向量
 */
export interface EncryptedPayload {
  encrypted: string;  // Base64 编码的加密数据
  iv: string;         // Base64 编码的初始化向量
}

/**
 * 将字节数组转换为 Base64 字符串
 * @param bytes - 要转换的字节数组
 * @returns Base64 编码的字符串
 */
const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

/**
 * 将 Base64 字符串转换为字节数组
 * @param value - Base64 编码的字符串
 * @returns 解码后的字节数组
 */
const base64ToBytes = (value: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

/**
 * 获取本地存储对象
 * @returns Storage 对象或 null（如果不可用）
 */
const getLocalStorage = (): Storage | null => {
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
      return globalThis.localStorage;
    }
  } catch (error) {
    return null;
  }
  return null;
};

/**
 * 从存储的原始数据中读取导出密钥
 * 支持多种格式：字符串、Uint8Array、ArrayBuffer、数字数组
 * @param stored - 存储的密钥数据
 * @returns 解析后的字节数组或 null（如果解析失败）
 */
const readRawExportKey = (stored: unknown): Uint8Array<ArrayBuffer> | null => {
  if (!stored) {
    return null;
  }
  // 尝试从 Base64 字符串解析
  if (typeof stored === 'string') {
    try {
      return base64ToBytes(stored);
    } catch (error) {
      return null;
    }
  }
  // Uint8Array 格式
  if (stored instanceof Uint8Array) {
    return new Uint8Array(stored);
  }
  // ArrayBuffer 格式
  if (stored instanceof ArrayBuffer) {
    return new Uint8Array(stored);
  }
  // 数字数组格式
  if (Array.isArray(stored) && stored.every((value) => typeof value === 'number')) {
    return new Uint8Array(stored);
  }
  // 对象格式（包含 data 属性）
  if (typeof stored === 'object' && stored !== null && Array.isArray((stored as { data?: unknown }).data)) {
    const data = (stored as { data: unknown[] }).data;
    if (data.every((value) => typeof value === 'number')) {
      return new Uint8Array(data);
    }
  }
  return null;
};

/**
 * 从本地存储中读取导出密钥
 * @returns 导出密钥的字节数组或 null（如果不存在）
 */
const readExportKeyFromLocalStorage = (): Uint8Array<ArrayBuffer> | null => {
  const storage = getLocalStorage();
  if (!storage) {
    return null;
  }
  const stored = storage.getItem(CONFIG_KEYS.PROVIDERS_EXPORT_KEY);
  if (!stored) {
    return null;
  }
  try {
    return base64ToBytes(stored);
  } catch (error) {
    return null;
  }
};

/**
 * 将导出密钥写入本地存储
 * @param raw - 要存储的密钥字节数组
 */
const writeExportKeyToLocalStorage = (raw: Uint8Array) => {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(CONFIG_KEYS.PROVIDERS_EXPORT_KEY, bytesToBase64(raw));
  } catch (error) {
    return;
  }
};

/**
 * 获取存储的导出密钥
 * 优先从 localStore 读取，如果失败则从 localStorage 读取
 * @returns 导出密钥的字节数组或 null（如果不存在）
 */
const getStoredExportKey = async (): Promise<Uint8Array<ArrayBuffer> | null> => {
  const stored = await localStore.getItem<unknown>(CONFIG_KEYS.PROVIDERS_EXPORT_KEY);
  const parsed = readRawExportKey(stored);
  if (parsed) {
    writeExportKeyToLocalStorage(parsed);
    return parsed;
  }
  return readExportKeyFromLocalStorage();
};

/**
 * 持久化导出密钥
 * 同时保存到 localStore 和 localStorage
 * @param raw - 要持久化的密钥字节数组
 */
const persistExportKey = async (raw: Uint8Array): Promise<void> => {
  await localStore.setItem(CONFIG_KEYS.PROVIDERS_EXPORT_KEY, bytesToBase64(raw));
  writeExportKeyToLocalStorage(raw);
};

/**
 * 获取或创建原始导出密钥
 * 如果密钥已存在则返回，否则创建新密钥并持久化
 * @returns 导出密钥的字节数组
 */
const getOrCreateRawExportKey = async (): Promise<Uint8Array<ArrayBuffer>> => {
  const stored = await getStoredExportKey();
  if (stored) {
    return stored;
  }
  const raw = crypto.getRandomValues(new Uint8Array(EXPORT_KEY_BYTES));
  await persistExportKey(raw);
  return raw;
};

/**
 * 获取导出密钥（CryptoKey 对象）
 * 使用缓存机制避免重复导入密钥
 * @returns CryptoKey 对象
 */
const getExportKey = async (): Promise<CryptoKey> => {
  if (cachedKey) {
    return cachedKey;
  }
  if (!cachedKeyPromise) {
    cachedKeyPromise = (async () => {
      if (!crypto?.subtle) {
        throw new Error('加密 API 不可用');
      }
      const raw = await getOrCreateRawExportKey();
      return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    })();
  }
  cachedKey = await cachedKeyPromise;
  return cachedKey;
};

/**
 * 加密敏感数据
 * 使用 AES-GCM 算法加密字符串
 * @param value - 要加密的字符串
 * @returns 包含加密数据和初始化向量的载荷对象
 */
export const encryptSecret = async (value: string): Promise<EncryptedPayload> => {
  const key = await getExportKey();
  const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
  const encoded = new TextEncoder().encode(value);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return {
    encrypted: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv),
  };
};

/**
 * 解密敏感数据
 * 使用 AES-GCM 算法解密之前加密的数据
 * @param payload - 包含加密数据和初始化向量的载荷对象
 * @returns 解密后的原始字符串
 */
export const decryptSecret = async (payload: EncryptedPayload): Promise<string> => {
  if (!payload?.encrypted || !payload?.iv) {
    throw new Error('无效的加密数据载荷');
  }
  const key = await getExportKey();
  const iv = base64ToBytes(payload.iv);
  const encrypted = base64ToBytes(payload.encrypted);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted);
  return new TextDecoder().decode(decrypted);
};

// 基于密码的加密/解密功能，用于可移植的导出/导入操作
// PBKDF2 迭代次数（用于密钥派生）
const PBKDF2_ITERATIONS = 100000;
// PBKDF2 盐值的字节长度（16字节）
const PBKDF2_SALT_BYTES = 16;

/**
 * 密码加密数据载荷接口
 * 包含加密数据、初始化向量和盐值
 */
export interface PasswordEncryptedPayload {
  encrypted: string;  // Base64 编码的加密数据
  iv: string;         // Base64 编码的初始化向量
  salt: string;       // Base64 编码的盐值
}

/**
 * 从密码派生加密密钥
 * 使用 PBKDF2 算法从密码和盐值派生 AES-GCM 密钥
 * @param password - 用户密码
 * @param salt - 盐值字节数组
 * @returns 派生的 CryptoKey 对象
 */
const deriveKeyFromPassword = async (password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> => {
  if (!crypto?.subtle) {
    throw new Error('加密 API 不可用');
  }
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
};

/**
 * 使用密码加密数据
 * 使用 PBKDF2 派生密钥，然后用 AES-GCM 加密
 * @param value - 要加密的字符串
 * @param password - 加密密码
 * @returns 包含加密数据、初始化向量和盐值的载荷对象
 */
export const encryptWithPassword = async (value: string, password: string): Promise<PasswordEncryptedPayload> => {
  const salt = crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES));
  const key = await deriveKeyFromPassword(password, salt);
  const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
  const encoded = new TextEncoder().encode(value);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return {
    encrypted: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt),
  };
};

/**
 * 使用密码解密数据
 * 使用 PBKDF2 派生密钥，然后用 AES-GCM 解密
 * @param payload - 包含加密数据、初始化向量和盐值的载荷对象
 * @param password - 解密密码
 * @returns 解密后的原始字符串
 */
export const decryptWithPassword = async (payload: PasswordEncryptedPayload, password: string): Promise<string> => {
  if (!payload?.encrypted || !payload?.iv || !payload?.salt) {
    throw new Error('无效的加密数据载荷');
  }
  const salt = base64ToBytes(payload.salt);
  const key = await deriveKeyFromPassword(password, salt);
  const iv = base64ToBytes(payload.iv);
  const encrypted = base64ToBytes(payload.encrypted);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted);
  return new TextDecoder().decode(decrypted);
};
