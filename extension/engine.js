const FULL_ENGINE_URL = chrome.runtime.getURL('vendor/stockfish/stockfish-full.js');
const FULL_WASM_URL = chrome.runtime.getURL('vendor/stockfish/stockfish-full.wasm');
const LITE_ENGINE_URL = chrome.runtime.getURL('vendor/stockfish/stockfish.js');
const LITE_WASM_URL = chrome.runtime.getURL('vendor/stockfish/stockfish.wasm');

function workerErrorMessage(workerError, event) {
  let detail = workerError?.message || (typeof workerError === 'string' ? workerError : '') || '';
  if (!detail && workerError && typeof workerError === 'object') {
    try { detail = JSON.stringify(workerError); } catch { /* Use the browser event message. */ }
  }
  detail ||= event?.message;
  return detail && detail !== '[object Object]'
    ? `Stockfish worker hatası: ${detail}`
    : 'Stockfish worker hata verdi. Uzantıyı chrome://extensions sayfasından yenileyin.';
}

export class StockfishEngine {
  constructor(engineUrl, wasmUrl, threads = 1, hash = 32) {
    // The WASM URL is supplied explicitly so extension worker path resolution is reliable.
    this.worker = new Worker(`${engineUrl}#${encodeURIComponent(wasmUrl)}`);
    this.failed = false;
    this.currentSearch = null;
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.worker.onmessage = event => this.onMessage(String(event.data));
    this.worker.onerror = event => {
      event.preventDefault?.();
      this.failed = true;
      const error = new Error(workerErrorMessage(event.error, event));
      if (event.error?.stack) error.stack = event.error.stack;
      this.rejectReady?.(error);
      this.currentSearch?.resolveDone?.();
      this.currentSearch?.reject(error);
      this.currentSearch = null;
    };
    this.worker.onmessageerror = () => {
      this.failed = true;
      const error = new Error('Stockfish worker mesajı okunamadı. Uzantıyı chrome://extensions sayfasından yenileyin.');
      this.rejectReady?.(error);
      this.currentSearch?.resolveDone?.();
      this.currentSearch?.reject(error);
      this.currentSearch = null;
    };
    this.worker.postMessage('uci');
    this.threads = threads;
    this.hash = hash;
  }

  onMessage(line) {
    if (line === 'uciok') {
      this.worker.postMessage(`setoption name Threads value ${this.threads}`);
      this.worker.postMessage(`setoption name Hash value ${this.hash}`);
      this.worker.postMessage('isready');
      return;
    }
    if (line === 'readyok' && this.resolveReady) {
      this.resolveReady();
      this.resolveReady = null;
      this.rejectReady = null;
      return;
    }
    const current = this.currentSearch;
    if (!current) return;
    if (line.startsWith('info ')) {
      const depth = Number(line.match(/\bdepth (\d+)/)?.[1] || 0);
      const cp = line.match(/\bscore cp (-?\d+)/);
      const mate = line.match(/\bscore mate (-?\d+)/);
      const pv = line.match(/\bpv (.+)$/)?.[1]?.trim().split(/\s+/) || [];
      if (depth && (cp || mate)) {
        current.info = { depth, cp: cp ? Number(cp[1]) : null, mate: mate ? Number(mate[1]) : null, pv };
        current.onInfo?.(current.info);
      }
      return;
    }
    if (line.startsWith('bestmove ')) {
      const uci = line.split(/\s+/)[1];
      this.currentSearch = null;
      current.resolveDone?.();
      current.resolve({ uci: uci === '(none)' ? null : uci, info: current.info });
    }
  }

  async search(fen, depth, onInfo) {
    await this.ready;
    if (this.currentSearch) {
      const previous = this.currentSearch;
      this.worker.postMessage('stop');
      await previous.done;
    }
    return new Promise((resolve, reject) => {
      let resolveDone;
      const done = new Promise(resolveFinished => { resolveDone = resolveFinished; });
      this.currentSearch = { resolve, reject, onInfo, info: null, done, resolveDone };
      this.worker.postMessage(`position fen ${fen}`);
      this.worker.postMessage(`go depth ${depth}`);
    });
  }

  stop() {
    if (this.currentSearch) this.worker.postMessage('stop');
  }

  terminate() {
    this.worker.terminate();
  }
}

class EngineManager {
  constructor() {
    // Full Stockfish 19 is much stronger and uses up to four cores. If Chrome or
    // the device cannot start its threaded WASM worker, fall back to the lite build.
    this.threads = Math.max(1, Math.min(4, navigator.hardwareConcurrency || 2));
    this.engine = new StockfishEngine(FULL_ENGINE_URL, FULL_WASM_URL, this.threads, 128);
    this.usingLite = false;
  }

  async search(fen, depth, onInfo) {
    try {
      return await this.engine.search(fen, depth, onInfo);
    } catch (error) {
      if (this.usingLite || !this.engine.failed) throw error;
      this.engine.terminate();
      this.engine = new StockfishEngine(LITE_ENGINE_URL, LITE_WASM_URL, 1, 32);
      this.usingLite = true;
      return this.engine.search(fen, depth, onInfo);
    }
  }

  stop() {
    this.engine?.stop();
  }
}

let engineInstance;
export function getStockfish() {
  if (!engineInstance) engineInstance = new EngineManager();
  return engineInstance;
}
export function stopStockfish() {
  engineInstance?.stop();
}
