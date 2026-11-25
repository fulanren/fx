
// src/utils/deps.js
// ============ 依赖守卫：联网模式，第三方库走 CDN(cdnjs/unpkg) ============
// 设计原则：
//  1) 所有第三方库走 CDN 在线加载（不再依赖本地 ./vendor/）；
//  2) 库缺失时给出明确中文提示（而不是静默空白页）；
//  3) 路径基于 document.baseURI 解析，子目录部署（如 http://host/fx/）同样有效。

/** 把 vendor 相对路径解析成绝对 URL（与调用文件所在层级无关） */
export function vendorUrl(rel) {
  const base = document.baseURI || location.href;
  return new URL(rel.replace(/^\/+/, ''), base).href;
}

const PDF_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const PDF_MAIN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';

let __pdfLoadPromise = null;   // 幂等：并发调用只加载一次

/** 内部：动态补载本地 pdf.min.js（index.html 那行 script 没生效时的兜底） */
function loadPdfMain() {
  if (__pdfLoadPromise) return __pdfLoadPromise;
  __pdfLoadPromise = new Promise((resolve) => {
    if (window.pdfjsLib) return resolve(true);
    const s = document.createElement('script');
    s.src = PDF_MAIN;
    s.async = false;
    s.onload = () => resolve(!!window.pdfjsLib);
    s.onerror = () => resolve(false);
    (document.head || document.documentElement).appendChild(s);
  });
  return __pdfLoadPromise;
}

/**
 * 同步守卫：pdf.js 已加载时把 worker 指向本地 vendor，返回是否可用。
 * 所有 getDocument 之前调它；返回 false 时调用方必须中止并提示（不要继续渲染）。
 * 注意：这里绝不能调用自己（那是无限递归，栈溢出）。
 */
export function ensurePdfJs() {
  if (!window.pdfjsLib) return false;
  try {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
  } catch (e) {
    console.warn('[deps] 设置 pdf workerSrc 失败', e);
    return false;
  }
  return true;
}

/**
 * 异步守卫：库没加载就先动态补载，再设 worker。
 * 只在 index.html 里的 <script src="./vendor/pdfjs/pdf.min.js"> 缺失/被拦时才真需要；
 * 用它就必须 await，调用侧写法见 2.4。
 */
export async function ensurePdfJsAsync() {
  if (!window.pdfjsLib) {
    const ok = await loadPdfMain();
    if (!ok) return false;
  }
  return ensurePdfJs();
}

/**
 * 需要 pdf.js 的场景统一入口：不可用时抛中文错误（被上层 catch 显示成提示）
 */
export function requirePdfJs() {
  if (!ensurePdfJs()) {
    throw new Error('PDF 引擎未加载：请检查网络，pdf.js 需从 CDN(cdnjs) 加载');
  }
  return window.pdfjsLib;
}

/** 其它库守卫：window 全局名 + 中文名 + 期望路径 */
const LIBS = {
  pdfjsLib: ['PDF 引擎', 'CDN'],
  PDFLib: ['PDF 编辑引擎', 'CDN'],
  JSZip: ['打包组件', 'CDN'],
  Tesseract: ['OCR 识别引擎', 'CDN'],
  mammoth: ['Word 解析器', 'CDN'],
  html2canvas: ['截图组件', 'CDN'],
  html2pdf: ['PDF 导出组件', 'CDN'],
  htmlDocx: ['Word 导出组件', 'CDN'],
  katex: ['公式渲染', 'CDN'],
};

/** 返回 {ok, name, cn, path}；ok=false 时调用方应 toast 出 hint */
export function checkLib(winName) {
  const meta = LIBS[winName] || [winName, 'CDN'];
  const ok = !!window[winName];
  return {
    ok, cn: meta[0], path: meta[1],
    hint: ok ? '' : `${meta[0]}未加载（请检查网络，库需从 CDN 加载）`
  };
}

/** 断网 / 依赖缺失的统一提示文案 */
export function missingLibMsg(winName) {
  return checkLib(winName).hint || '依赖缺失';
}

// ============ OCR 离线包装 ============
// tesseract.js v5 的 recognize 第二/三参不传路径时会去 CDN 取 worker 与语言包，
// 离线必挂。所有 OCR 调用统一改走 ocrRecognize()。
export async function ocrRecognize(input, langs = 'chi_sim+eng', extraOptions = {}) {
  const c = checkLib('Tesseract');
  if (!c.ok) throw new Error(c.hint);
  return window.Tesseract.recognize(input, langs, {
    ...extraOptions,             // logger 等原参数照旧透传
  });
}