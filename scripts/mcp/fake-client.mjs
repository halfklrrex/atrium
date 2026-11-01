// An in-memory stand-in for `createFirestoreRest`, for tests. It checks the same commit
// preconditions and field-path semantics the real client sends, so the tests see what Firestore would do.

function clone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value.toMillis === 'function') return new Date(value.toMillis());
  if (Array.isArray(value)) return value.map(clone);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, clone(v)]),
  );
}

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

export function createFakeClient(initial = {}) {
  const docs = new Map();
  let clock = 1;
  const stamp = () => `2026-11-01T00:00:${String(clock++).padStart(2, '0')}.000000Z`;
  for (const [path, data] of Object.entries(initial)) {
    docs.set(path, { data: clone(data), updateTime: stamp() });
  }
  const commits = [];

  const direct = (collection) => {
    const prefix = `${collection}/`;
    return [...docs.entries()].filter(
      ([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'),
    );
  };

  function setDotted(target, dotted, value) {
    const segments = dotted.split('.');
    let level = target;
    for (const segment of segments.slice(0, -1)) {
      if (typeof level[segment] !== 'object' || level[segment] === null) level[segment] = {};
      level = level[segment];
    }
    level[segments.at(-1)] = value;
  }
  function removeDotted(target, dotted) {
    const segments = dotted.split('.');
    let level = target;
    for (const segment of segments.slice(0, -1)) {
      level = level?.[segment];
      if (!level) return;
    }
    delete level[segments.at(-1)];
  }

  return {
    describe: 'in-memory fake',
    docs,
    commits,
    async getDoc(path) {
      const found = docs.get(path);
      return found ? clone(found.data) : null;
    },
    async getDocMeta(path) {
      const found = docs.get(path);
      return found ? { data: clone(found.data), updateTime: found.updateTime } : null;
    },
    async listAllDocs(collectionPath) {
      return direct(collectionPath).map(([path, v]) => ({
        id: path.split('/').at(-1),
        data: clone(v.data),
        updateTime: v.updateTime,
      }));
    },
    async runQuery(collectionId, where = {}) {
      return direct(collectionId)
        .filter(([, v]) => Object.entries(where).every(([k, want]) => v.data[k] === want))
        .map(([path, v]) => ({
          id: path.split('/').at(-1),
          data: clone(v.data),
          updateTime: v.updateTime,
        }));
    },
    async commit(writes) {
      // Check everything first: a commit is atomic.
      for (const w of writes) {
        const found = docs.get(w.path);
        const pre = w.precondition;
        if (pre && 'exists' in pre && Boolean(found) !== pre.exists) {
          throw fail(409, `precondition exists=${pre.exists} failed for ${w.path}`);
        }
        if (pre && 'updateTime' in pre && found?.updateTime !== pre.updateTime) {
          throw fail(409, `updateTime precondition failed for ${w.path}`);
        }
        if ((w.op === 'patch' || w.op === 'update') && !found && !(pre && pre.exists === false)) {
          throw fail(404, `${w.path} does not exist`);
        }
      }
      commits.push(writes.map((w) => ({ ...w })));
      for (const w of writes) {
        if (w.op === 'delete') docs.delete(w.path);
        else if (w.op === 'set') docs.set(w.path, { data: clone(w.data), updateTime: stamp() });
        else if (w.op === 'patch') {
          const found = docs.get(w.path);
          Object.assign(found.data, clone(w.data));
          found.updateTime = stamp();
        } else if (w.op === 'update') {
          const found = docs.get(w.path);
          for (const [p, v] of Object.entries(w.set ?? {})) setDotted(found.data, p, clone(v));
          for (const p of w.remove ?? []) removeDotted(found.data, p);
          for (const [p, by] of Object.entries(w.increment ?? {})) {
            found.data[p] = (found.data[p] ?? 0) + by;
          }
          found.updateTime = stamp();
        } else throw new Error(`unknown op ${w.op}`);
      }
    },
  };
}
