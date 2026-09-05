/**
 * DashClaw SDK v2 (Stable Runtime API)
 * CommonJS compatibility bridge.
 *
 * ESM: import { DashClaw } from 'dashclaw'
 * CJS: const { DashClaw } = require('dashclaw')
 */

// Minimal CommonJS shim for the v2 SDK
// We use a simplified bridge that forwards calls to the async ESM import
let _module;

async function loadModule() {
  if (!_module) {
    _module = await import('./dashclaw.js');
  }
  return _module;
}

// Lazy error class factory: constructs a placeholder class that delegates
// instanceof checks to the real ESM class once the module loads, matching
// the Symbol.hasInstance pattern from legacy/index-v1.cjs so that
// catch(e) { if (e instanceof ApprovalDeniedError) } works across the
// ESM/CJS boundary.
function makeLazyErrorClass(name) {
  const Placeholder = class extends Error {
    constructor(...args) {
      super(...args);
      this.name = name;
    }
  };
  Object.defineProperty(Placeholder, 'name', { value: name });
  loadModule().then(m => {
    if (m[name]) {
      Object.defineProperty(Placeholder, Symbol.hasInstance, {
        value: (instance) => instance && (instance.name === name || instance instanceof m[name])
      });
    }
  });
  return Placeholder;
}

function scrubActText(text) {
  if (typeof text !== 'string' || !text) return text;
  return text
    .replace(/oc_live_[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, '[REDACTED]')
    .replace(/ghp_[A-Za-z0-9]{20,}/g, '[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/(password|token|secret)\s*=\s*[^\s&"']+/gi, (_match, key) => `${key}=[REDACTED]`);
}

function scrubAct(act) {
  if (!act || typeof act !== 'object') return act;
  const clone = JSON.parse(JSON.stringify(act));
  if (typeof clone.command === 'string') clone.command = scrubActText(clone.command);
  if (typeof clone.statement === 'string') clone.statement = scrubActText(clone.statement);
  if (clone.request && typeof clone.request === 'object') {
    if (typeof clone.request.body_excerpt === 'string') {
      clone.request.body_excerpt = scrubActText(clone.request.body_excerpt);
    }
    if (clone.request.headers && typeof clone.request.headers === 'object') {
      clone.request.headers = Object.fromEntries(
        Object.entries(clone.request.headers).filter(([key]) =>
          !['authorization', 'cookie', 'x-api-key'].includes(key.toLowerCase())),
      );
    }
  }
  if (clone.file && typeof clone.file === 'object' && typeof clone.file.content_excerpt === 'string') {
    clone.file.content_excerpt = scrubActText(clone.file.content_excerpt);
  }
  return clone;
}

// Recursive deferred proxy. Each property access records the access path and
// returns another callable proxy; invoking the leaf awaits the async ESM import,
// walks the path on the resolved instance, and calls the real method. This makes
// both flat methods (client.guard(...)) and nested namespaces
// (client.execution.capabilities.list(...)) work across the CJS bridge, where the
// ESM instance only exists after an async import.
function makeDeferred(target, path) {
  return new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then' || typeof prop === 'symbol') return undefined;
      return makeDeferred(target, path.concat(String(prop)));
    },
    apply(_t, _thisArg, args) {
      return target._ready.then(() => {
        let parent = target._instance;
        for (let i = 0; i < path.length - 1; i++) parent = parent[path[i]];
        const leaf = parent && parent[path[path.length - 1]];
        if (typeof leaf !== 'function') {
          throw new Error(`Method ${path.join('.')} does not exist on DashClaw v2`);
        }
        return leaf.apply(parent, args);
      });
    },
  });
}

module.exports = {
  // Sync wrapper that returns a proxy for the DashClaw class
  DashClaw: class DashClawProxy {
    constructor(opts) {
      this._opts = opts;
      this._ready = loadModule().then(m => {
        this._instance = new m.DashClaw(opts);
      });

      return new Proxy(this, {
        get(target, prop) {
          if (prop in target) return target[prop];
          if (prop === 'then' || typeof prop === 'symbol') return undefined;
          // Defer to the async ESM instance; supports flat methods and
          // nested namespaces (e.g. client.execution.capabilities.list(...)).
          return makeDeferred(target, [String(prop)]);
        }
      });
    }

    static async create(opts) {
      const mod = await loadModule();
      return new mod.DashClaw(opts);
    }
  },

  // Errors from v2 — lazy re-exports that resolve instanceof across the
  // ESM/CJS boundary once the module has loaded.
  ApprovalDeniedError: makeLazyErrorClass('ApprovalDeniedError'),
  ApprovalPendingError: makeLazyErrorClass('ApprovalPendingError'),
  GuardBlockedError: makeLazyErrorClass('GuardBlockedError'),
  ExecutionClaimError: makeLazyErrorClass('ExecutionClaimError'),
  OutcomeConfirmationError: makeLazyErrorClass('OutcomeConfirmationError'),
  scrubAct,
};
