/**
 * Web游戏Playwright客户端
 * 
 * 该模块提供了一个基于Playwright的Web游戏自动化测试客户端。
 * 主要功能包括：
 * - 启动浏览器并加载游戏页面
 * - 执行预定义的游戏操作序列（按键、鼠标点击等）
 * - 捕获游戏画布截图
 * - 记录游戏状态和控制台错误
 * 
 * @module web_game_playwright_client
 * @author purpose168@outlook.com
 */

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

/**
 * 解析命令行参数
 * 
 * 从进程参数数组中提取配置选项，支持以下参数：
 * --url: 游戏页面的URL地址（必需）
 * --iterations: 操作迭代次数，默认为3
 * --pause-ms: 每次迭代之间的暂停时间（毫秒），默认为250
 * --headless: 是否使用无头模式，默认为true
 * --screenshot-dir: 截图保存目录，默认为"output/web-game"
 * --actions-file: 操作序列JSON文件路径
 * --actions-json: 操作序列JSON字符串
 * --click: 直接指定点击坐标（格式：x,y）
 * --click-selector: 点击元素的CSS选择器
 * 
 * @param {string[]} argv - 命令行参数数组（通常为process.argv）
 * @returns {Object} 解析后的参数对象
 * @throws {Error} 如果缺少必需的--url参数则抛出错误
 */
function parseArgs(argv) {
  // 初始化默认参数配置
  const args = {
    url: null,                    // 游戏页面URL
    iterations: 3,                // 迭代次数
    pauseMs: 250,                 // 暂停时间（毫秒）
    headless: true,               // 无头模式标志
    screenshotDir: "output/web-game", // 截图输出目录
    actionsFile: null,            // 操作文件路径
    actionsJson: null,            // 操作JSON字符串
    click: null,                  // 点击坐标
    clickSelector: null,          // 点击选择器
  };
  
  // 遍历命令行参数并解析
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    
    if (arg === "--url" && next) {
      args.url = next;
      i++;
    } else if (arg === "--iterations" && next) {
      args.iterations = parseInt(next, 10);
      i++;
    } else if (arg === "--pause-ms" && next) {
      args.pauseMs = parseInt(next, 10);
      i++;
    } else if (arg === "--headless" && next) {
      // 将字符串参数转换为布尔值，"0"和"false"表示false
      args.headless = next !== "0" && next !== "false";
      i++;
    } else if (arg === "--screenshot-dir" && next) {
      args.screenshotDir = next;
      i++;
    } else if (arg === "--actions-file" && next) {
      args.actionsFile = next;
      i++;
    } else if (arg === "--actions-json" && next) {
      args.actionsJson = next;
      i++;
    } else if (arg === "--click" && next) {
      // 解析点击坐标，格式为"x,y"
      const parts = next.split(",").map((v) => parseFloat(v.trim()));
      if (parts.length === 2 && parts.every((v) => Number.isFinite(v))) {
        args.click = { x: parts[0], y: parts[1] };
      }
      i++;
    } else if (arg === "--click-selector" && next) {
      args.clickSelector = next;
      i++;
    }
  }
  
  // 验证必需参数
  if (!args.url) {
    throw new Error("--url 参数是必需的");
  }
  return args;
}

/**
 * 游戏按钮名称到键盘按键代码的映射表
 * 
 * 将游戏中的通用按钮名称映射到标准的键盘事件代码
 */
const buttonNameToKey = {
  up: "ArrowUp",        // 上方向键
  down: "ArrowDown",    // 下方向键
  left: "ArrowLeft",    // 左方向键
  right: "ArrowRight",  // 右方向键
  enter: "Enter",       // 回车键
  space: "Space",       // 空格键
  a: "KeyA",            // A键
  b: "KeyB",            // B键
};

/**
 * 异步延迟函数
 * 
 * 返回一个在指定毫秒数后解决的Promise，用于实现异步等待
 * 
 * @param {number} ms - 延迟时间（毫秒）
 * @returns {Promise<void>} 在指定时间后解决的Promise
 */
async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 确保目录存在
 * 
 * 如果目录不存在则递归创建，包括所有必要的父目录
 * 
 * @param {string} p - 目录路径
 */
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

/**
 * 创建虚拟时间垫片脚本
 * 
 * 生成一段注入到页面中的JavaScript代码，用于：
 * 1. 跟踪所有待处理的定时器和动画帧请求
 * 2. 提供advanceTime函数来推进虚拟时间
 * 3. 允许外部代码查询待处理任务数量
 * 
 * 这个垫片对于控制游戏循环的时间推进非常重要，
 * 使得测试可以在不等待真实时间的情况下执行游戏逻辑。
 * 
 * @returns {string} 要注入页面的JavaScript代码字符串
 */
function makeVirtualTimeShim() {
  return `(() => {
    // 存储所有待处理的任务
    const pending = new Set();
    
    // 保存原始的定时器函数
    const origSetTimeout = window.setTimeout.bind(window);
    const origSetInterval = window.setInterval.bind(window);
    const origRequestAnimationFrame = window.requestAnimationFrame.bind(window);

    // 将待处理任务集合暴露给外部访问
    window.__vt_pending = pending;

    // 重写setTimeout，在任务开始和结束时更新待处理集合
    window.setTimeout = (fn, t, ...rest) => {
      const task = {};
      pending.add(task);
      return origSetTimeout(() => {
        pending.delete(task);
        fn(...rest);
      }, t);
    };

    // 重写setInterval，持续跟踪任务
    window.setInterval = (fn, t, ...rest) => {
      const task = {};
      pending.add(task);
      return origSetInterval(() => {
        fn(...rest);
      }, t);
    };

    // 重写requestAnimationFrame，跟踪动画帧请求
    window.requestAnimationFrame = (fn) => {
      const task = {};
      pending.add(task);
      return origRequestAnimationFrame((ts) => {
        pending.delete(task);
        fn(ts);
      });
    };

    // 提供推进虚拟时间的函数
    // 通过连续请求动画帧来模拟时间流逝
    window.advanceTime = (ms) => {
      return new Promise((resolve) => {
        const start = performance.now();
        function step(now) {
          if (now - start >= ms) return resolve();
          origRequestAnimationFrame(step);
        }
        origRequestAnimationFrame(step);
      });
    };

    // 提供查询待处理任务数量的函数
    window.__drainVirtualTimePending = () => pending.size;
  })();`;
}

/**
 * 获取页面上最大的画布元素句柄
 * 
 * 在页面中查找所有canvas元素，并返回面积最大的那个。
 * 这通常用于找到游戏的主画布。
 * 
 * @param {Page} page - Playwright页面对象
 * @returns {Promise<ElementHandle|null>} 画布元素的句柄，如果没有找到则返回null
 */
async function getCanvasHandle(page) {
  const handle = await page.evaluateHandle(() => {
    let best = null;
    let bestArea = 0;
    
    // 遍历所有canvas元素，找到面积最大的
    for (const canvas of document.querySelectorAll("canvas")) {
      const area = (canvas.width || canvas.clientWidth || 0) * (canvas.height || canvas.clientHeight || 0);
      if (area > bestArea) {
        bestArea = area;
        best = canvas;
      }
    }
    return best;
  });
  return handle.asElement();
}

/**
 * 捕获画布内容为PNG格式的Base64编码字符串
 * 
 * 使用canvas的toDataURL方法获取图像数据，
 * 并提取其中的Base64编码部分
 * 
 * @param {ElementHandle} canvas - 画布元素句柄
 * @returns {Promise<string>} Base64编码的PNG图像数据，失败时返回空字符串
 */
async function captureCanvasPngBase64(canvas) {
  return canvas.evaluate((c) => {
    if (!c || typeof c.toDataURL !== "function") return "";
    const data = c.toDataURL("image/png");
    const idx = data.indexOf(",");
    return idx === -1 ? "" : data.slice(idx + 1);
  });
}

/**
 * 检查画布是否完全透明
 * 
 * 通过采样画布内容来检测是否存在非透明像素。
 * 为了性能考虑，只检查一个小尺寸的采样区域。
 * 
 * @param {ElementHandle} canvas - 画布元素句柄
 * @returns {Promise<boolean>} 如果画布完全透明或无法读取则返回true，否则返回false
 */
async function isCanvasTransparent(canvas) {
  if (!canvas) return true;
  return canvas.evaluate((c) => {
    try {
      const w = c.width || c.clientWidth || 0;
      const h = c.height || c.clientHeight || 0;
      if (!w || !h) return true;
      
      // 采样尺寸，最大16像素
      const size = Math.max(1, Math.min(16, w, h));
      
      // 创建探测用的临时画布
      const probe = document.createElement("canvas");
      probe.width = size;
      probe.height = size;
      const ctx = probe.getContext("2d");
      if (!ctx) return true;
      
      // 将原画布内容绘制到探测画布
      ctx.drawImage(c, 0, 0, size, size);
      
      // 获取像素数据并检查alpha通道
      const data = ctx.getImageData(0, 0, size, size).data;
      for (let i = 3; i < data.length; i += 4) {
        // alpha通道值不为0表示存在非透明像素
        if (data[i] !== 0) return false;
      }
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * 捕获屏幕截图并保存到文件
 * 
 * 按以下优先级尝试捕获图像：
 * 1. 从画布获取PNG Base64数据
 * 2. 如果画布不透明，使用画布的截图方法
 * 3. 如果画布透明或无法获取，截取画布区域
 * 4. 如果以上都失败，截取整个页面
 * 
 * @param {Page} page - Playwright页面对象
 * @param {ElementHandle|null} canvas - 画布元素句柄，可以为null
 * @param {string} outPath - 输出文件路径
 */
async function captureScreenshot(page, canvas, outPath) {
  let buffer = null;
  
  // 首先尝试从画布获取Base64数据
  let base64 = canvas ? await captureCanvasPngBase64(canvas) : "";
  if (base64) {
    buffer = Buffer.from(base64, "base64");
    // 检查画布是否透明，透明的画布可能表示游戏尚未渲染
    const transparent = canvas ? await isCanvasTransparent(canvas) : false;
    if (transparent) buffer = null;
  }
  
  // 如果Base64方法失败或画布透明，尝试使用Playwright截图
  if (!buffer && canvas) {
    try {
      buffer = await canvas.screenshot({ type: "png" });
    } catch {
      buffer = null;
    }
  }
  
  // 如果仍然没有获取到图像，尝试截取页面区域
  if (!buffer) {
    const bbox = canvas ? await canvas.boundingBox() : null;
    if (bbox) {
      // 截取画布区域
      buffer = await page.screenshot({
        type: "png",
        omitBackground: false,
        clip: bbox,
      });
    } else {
      // 截取整个页面
      buffer = await page.screenshot({ type: "png", omitBackground: false });
    }
  }
  
  // 将图像数据写入文件
  fs.writeFileSync(outPath, buffer);
}

/**
 * 控制台错误跟踪器
 * 
 * 用于收集和去重页面中发生的错误信息，
 * 包括console.error和未捕获的异常
 */
class ConsoleErrorTracker {
  /**
   * 构造函数
   * 初始化已见错误集合和错误队列
   */
  constructor() {
    this._seen = new Set();   // 用于去重的已见错误集合
    this._errors = [];        // 错误队列
  }

  /**
   * 添加错误到跟踪器
   * 
   * 如果错误之前未出现过，则添加到错误队列
   * 
   * @param {Object} err - 错误对象，包含type和text属性
   */
  ingest(err) {
    const key = JSON.stringify(err);
    if (this._seen.has(key)) return;  // 跳过重复错误
    this._seen.add(key);
    this._errors.push(err);
  }

  /**
   * 取出并清空错误队列
   * 
   * 返回当前队列中的所有错误，并清空队列
   * 
   * @returns {Object[]} 错误对象数组
   */
  drain() {
    const next = [...this._errors];
    this._errors = [];
    return next;
  }
}

/**
 * 执行游戏操作序列
 * 
 * 根据预定义的步骤序列执行游戏操作，包括：
 * - 键盘按键（方向键、空格等）
 * - 鼠标点击（左键、右键）
 * - 帧推进（通过虚拟时间垫片）
 * 
 * 每个步骤可以包含多个同时按下的按钮，
 * 并可以指定持续的帧数。
 * 
 * @param {Page} page - Playwright页面对象
 * @param {ElementHandle|null} canvas - 画布元素句柄
 * @param {Object[]} steps - 操作步骤数组
 * @param {string[]} steps[].buttons - 要按下的按钮名称数组
 * @param {number} [steps[].frames=1] - 持续帧数
 * @param {number} [steps[].mouse_x] - 鼠标X坐标（相对画布）
 * @param {number} [steps[].mouse_y] - 鼠标Y坐标（相对画布）
 */
async function doChoreography(page, canvas, steps) {
  for (const step of steps) {
    const buttons = new Set(step.buttons || []);
    
    // 按下所有指定的按钮
    for (const button of buttons) {
      if (button === "left_mouse_button" || button === "right_mouse_button") {
        // 处理鼠标按钮
        const bbox = canvas ? await canvas.boundingBox() : null;
        if (!bbox) continue;
        
        // 计算点击位置，默认为画布中心
        const x = typeof step.mouse_x === "number" ? step.mouse_x : bbox.width / 2;
        const y = typeof step.mouse_y === "number" ? step.mouse_y : bbox.height / 2;
        
        // 移动鼠标并按下按钮
        await page.mouse.move(bbox.x + x, bbox.y + y);
        await page.mouse.down({ button: button === "left_mouse_button" ? "left" : "right" });
      } else if (buttonNameToKey[button]) {
        // 处理键盘按键
        await page.keyboard.down(buttonNameToKey[button]);
      }
    }

    // 推进指定的帧数
    // 每帧约16.67ms（60fps）
    const frames = step.frames || 1;
    for (let i = 0; i < frames; i++) {
      await page.evaluate(async () => {
        if (typeof window.advanceTime === "function") {
          await window.advanceTime(1000 / 60);
        }
      });
    }

    // 释放所有按钮
    for (const button of buttons) {
      if (button === "left_mouse_button" || button === "right_mouse_button") {
        // 释放鼠标按钮
        await page.mouse.up({ button: button === "left_mouse_button" ? "left" : "right" });
      } else if (buttonNameToKey[button]) {
        // 释放键盘按键
        await page.keyboard.up(buttonNameToKey[button]);
      }
    }
  }
}

/**
 * 主函数
 * 
 * 执行Web游戏自动化测试的主要流程：
 * 1. 解析命令行参数
 * 2. 创建输出目录
 * 3. 启动浏览器并加载游戏页面
 * 4. 注入虚拟时间垫片
 * 5. 执行操作序列
 * 6. 捕获截图和游戏状态
 * 7. 记录错误信息
 * 
 * @async
 * @throws {Error} 如果缺少操作参数或发生运行时错误
 */
async function main() {
  // 解析命令行参数
  const args = parseArgs(process.argv);
  
  // 确保截图输出目录存在
  ensureDir(args.screenshotDir);

  // 启动Chromium浏览器
  // 使用ANGLE和SwiftShader进行软件渲染，确保在无头模式下也能正常渲染
  const browser = await chromium.launch({
    headless: args.headless,
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
  });
  
  // 创建新页面
  const page = await browser.newPage();
  
  // 初始化错误跟踪器
  const consoleErrors = new ConsoleErrorTracker();

  // 监听控制台消息，捕获错误
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    consoleErrors.ingest({ type: "console.error", text: msg.text() });
  });
  
  // 监听页面错误（未捕获的异常）
  page.on("pageerror", (err) => {
    consoleErrors.ingest({ type: "pageerror", text: String(err) });
  });

  // 注入虚拟时间垫片脚本
  await page.addInitScript({ content: makeVirtualTimeShim() });
  
  // 导航到游戏页面
  await page.goto(args.url, { waitUntil: "domcontentloaded" });
  
  // 等待页面初始化
  await page.waitForTimeout(500);
  
  // 触发窗口resize事件，确保游戏正确响应窗口大小
  await page.evaluate(() => {
    window.dispatchEvent(new Event("resize"));
  });

  // 获取游戏画布
  let canvas = await getCanvasHandle(page);

  // 如果指定了点击选择器，先执行点击操作
  // 这通常用于点击"开始游戏"按钮等
  if (args.clickSelector) {
    try {
      await page.click(args.clickSelector, { timeout: 5000 });
      await page.waitForTimeout(250);
    } catch (err) {
      console.warn("点击选择器失败", args.clickSelector, err);
    }
  }
  
  // 加载操作序列
  let steps = null;
  if (args.actionsFile) {
    // 从文件加载操作序列
    const raw = fs.readFileSync(args.actionsFile, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) steps = parsed;
    if (parsed && Array.isArray(parsed.steps)) steps = parsed.steps;
  } else if (args.actionsJson) {
    // 从JSON字符串加载操作序列
    const parsed = JSON.parse(args.actionsJson);
    if (Array.isArray(parsed)) steps = parsed;
    if (parsed && Array.isArray(parsed.steps)) steps = parsed.steps;
  } else if (args.click) {
    // 如果只指定了点击坐标，创建简单的点击操作序列
    steps = [
      {
        buttons: ["left_mouse_button"],
        frames: 2,
        mouse_x: args.click.x,
        mouse_y: args.click.y,
      },
    ];
  }
  
  // 验证操作序列是否存在
  if (!steps) {
    throw new Error("操作序列是必需的。请使用 --actions-file、--actions-json 或 --click 参数。");
  }

  // 执行迭代测试
  for (let i = 0; i < args.iterations; i++) {
    // 确保画布句柄有效
    if (!canvas) canvas = await getCanvasHandle(page);
    
    // 执行操作序列
    await doChoreography(page, canvas, steps);
    
    // 暂停指定时间
    await sleep(args.pauseMs);

    // 捕获截图
    const shotPath = path.join(args.screenshotDir, `shot-${i}.png`);
    await captureScreenshot(page, canvas, shotPath);

    // 尝试获取游戏的文本状态表示
    // 如果游戏提供了render_game_to_text函数，可以获取结构化的游戏状态
    const text = await page.evaluate(() => {
      if (typeof window.render_game_to_text === "function") {
        return window.render_game_to_text();
      }
      return null;
    });
    
    // 保存游戏状态
    if (text) {
      fs.writeFileSync(path.join(args.screenshotDir, `state-${i}.json`), text);
    }

    // 检查是否有新的错误发生
    const freshErrors = consoleErrors.drain();
    if (freshErrors.length) {
      // 如果发现错误，保存错误信息并终止测试
      fs.writeFileSync(
        path.join(args.screenshotDir, `errors-${i}.json`),
        JSON.stringify(freshErrors, null, 2)
      );
      break;
    }
  }

  // 关闭浏览器
  await browser.close();
}

// 执行主函数并处理错误
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
