const ENGINE_URL = chrome.runtime.getURL('vendor/stockfish/stockfish.js');

export class StockfishEngine {
  constructor() {
    this.worker = new Worker(ENGINE_URL);
    this.currentSearch = null;
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.worker.onmessage = event => this.onMessage(String(event.data));
    this.worker.onerror = event => {
      const error = new Error(event.message || 'Stockfish motoru başlatılamadı.');
      this.rejectReady?.(error);
      this.currentSearch?.resolveDone?.();
      this.currentSearch?.reject(error);
      this.currentSearch = null;
    };
    this.worker.postMessage('uci');
  }

  onMessage(line) {
    if (line === 'uciok') {
      this.worker.postMessage('setoption name Threads value 1');
      this.worker.postMessage('setoption name Hash value 32');
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
}

let engineInstance;
export function getStockfish() {
  if (!engineInstance) engineInstance = new StockfishEngine();
  return engineInstance;
}
export function stopStockfish() {
  engineInstance?.stop();
}
