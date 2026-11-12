// Attack-source identity registry.
// Source ids are allocated monotonically and are never reused, even after the
// originating actor has been despawned and re-spawned. Repeated generation of
// the same actor therefore cannot alias an earlier attack's contact report.

export function createSourceRegistry() {
  let nextSerial = 1;
  const byActor = new Map();
  const issued = new Map();

  function spawn(actorTag) {
    const sourceId = `atk-${nextSerial}`;
    nextSerial += 1;
    if (!byActor.has(actorTag)) byActor.set(actorTag, []);
    byActor.get(actorTag).push(sourceId);
    issued.set(sourceId, { sourceId, actorTag, alive: true });
    return sourceId;
  }

  function despawn(actorTag) {
    const list = byActor.get(actorTag);
    if (!list) return [];
    const affected = [];
    for (const sourceId of list) {
      const record = issued.get(sourceId);
      if (record && record.alive) {
        record.alive = false;
        affected.push(sourceId);
      }
    }
    byActor.delete(actorTag);
    return affected;
  }

  function get(sourceId) {
    return issued.get(sourceId) || null;
  }

  function isAlive(sourceId) {
    const record = issued.get(sourceId);
    return Boolean(record && record.alive);
  }

  function currentForActor(actorTag) {
    const list = byActor.get(actorTag);
    if (!list || list.length === 0) return null;
    return list[list.length - 1];
  }

  function snapshot() {
    return {
      nextSerial,
      byActor: [...byActor.entries()].map(([tag, ids]) => [tag, [...ids]]),
      issued: [...issued.values()].map((record) => ({ ...record })),
    };
  }

  return { spawn, despawn, get, isAlive, currentForActor, snapshot };
}
