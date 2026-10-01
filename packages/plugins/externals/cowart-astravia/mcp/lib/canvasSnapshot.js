import { createTLStore } from 'tldraw'

/** Document-scoped records only. Session records (camera/instance/pointer/…) are
 * recreated by tldraw; persisting them across versions causes put() failures. */
const DOCUMENT_TYPE_NAMES = new Set(['document', 'page', 'shape', 'asset', 'binding'])

/** Fields some snapshots add that current tldraw validators reject. */
const STRIP_RECORD_KEYS = new Set(['createdAt', 'modifiedAt', 'updatedAt'])

export function isCanvasSnapshot(value) {
  return value && typeof value === 'object' && value.store && value.schema
}

export function firstErrorLine(error) {
  return error instanceof Error ? error.message.split('\n')[0] : String(error).split('\n')[0]
}

export function describeSkippedRecord(record, reason) {
  return {
    id: typeof record?.id === 'string' ? record.id : '(missing id)',
    typeName: typeof record?.typeName === 'string' ? record.typeName : '(missing typeName)',
    type: typeof record?.type === 'string' ? record.type : null,
    reason: firstErrorLine(reason)
  }
}

function getRecordDependencies(record) {
  const dependencies = []
  if (record?.typeName === 'shape') {
    if (typeof record.parentId === 'string') dependencies.push(record.parentId)
    if (record.type === 'image' && typeof record.props?.assetId === 'string') {
      dependencies.push(record.props.assetId)
    }
  }
  if (record?.typeName === 'binding') {
    const fromId = record.fromId ?? record.props?.fromId
    const toId = record.toId ?? record.props?.toId
    if (typeof fromId === 'string') dependencies.push(fromId)
    if (typeof toId === 'string') dependencies.push(toId)
  }
  return dependencies
}

function pruneRecordsWithMissingDependencies(store, skippedRecords) {
  const prunedStore = { ...store }
  let changed = true

  while (changed) {
    changed = false
    for (const record of Object.values(prunedStore)) {
      if (!record?.id) continue
      const missingDependency = getRecordDependencies(record).find((id) => !prunedStore[id])
      if (!missingDependency) continue

      delete prunedStore[record.id]
      skippedRecords.push(
        describeSkippedRecord(record, `Missing dependent record: ${missingDependency}`)
      )
      changed = true
    }
  }

  return prunedStore
}

function asPositiveNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function stripUnknownRecordFields(record) {
  if (!record || typeof record !== 'object') return record
  const next = {}
  for (const [key, value] of Object.entries(record)) {
    if (STRIP_RECORD_KEYS.has(key)) continue
    next[key] = value
  }
  return next
}

function normalizeImageAssetRecord(record, originalRecord) {
  if (record?.typeName !== 'asset' || record.type !== 'image' || !record.props) {
    return record
  }

  const originalProps =
    originalRecord?.props && typeof originalRecord.props === 'object' ? originalRecord.props : {}
  const props = { ...record.props }

  props.name = typeof props.name === 'string' ? props.name : String(originalProps.name ?? 'image')
  props.src = typeof props.src === 'string' ? props.src : String(originalProps.src ?? '')
  props.mimeType =
    typeof props.mimeType === 'string' && props.mimeType
      ? props.mimeType
      : String(originalProps.mimeType ?? 'image/png')
  props.isAnimated = Boolean(props.isAnimated ?? originalProps.isAnimated ?? false)
  props.w = asPositiveNumber(props.w, asPositiveNumber(originalProps.w, 512))
  props.h = asPositiveNumber(props.h, asPositiveNumber(originalProps.h, 512))

  const fileSize = Number(props.fileSize ?? originalProps.fileSize)
  if (Number.isFinite(fileSize) && fileSize >= 0) {
    props.fileSize = fileSize
  } else {
    delete props.fileSize
  }

  return { ...record, props }
}

function normalizeImageShapeRecord(record) {
  if (record?.typeName !== 'shape' || record.type !== 'image' || !record.props) {
    return record
  }

  const props = { ...record.props }
  props.url ??= ''
  props.crop ??= null
  props.flipX ??= false
  props.flipY ??= false
  props.altText ??= ''
  props.playing ??= true
  props.w = asPositiveNumber(props.w, 512)
  props.h = asPositiveNumber(props.h, 512)

  return { ...record, props }
}

/**
 * Prefer document-scoped records; strip cross-version junk fields; restore image
 * asset dimensions after migrations that drop them.
 */
export function prepareDocumentScopedStore(store, originalById = store) {
  const next = {}
  for (const record of Object.values(store ?? {})) {
    if (!record || typeof record !== 'object' || typeof record.id !== 'string') continue
    if (!DOCUMENT_TYPE_NAMES.has(record.typeName)) continue

    let cleaned = stripUnknownRecordFields(record)
    if (cleaned.typeName === 'asset' && cleaned.type === 'image') {
      cleaned = normalizeImageAssetRecord(cleaned, originalById[cleaned.id])
    } else if (cleaned.typeName === 'shape' && cleaned.type === 'image') {
      cleaned = normalizeImageShapeRecord(cleaned)
    }
    next[cleaned.id] = cleaned
  }
  return next
}

/**
 * Empty sequences {} makes tldraw re-run migrations from version 0 and drop
 * image asset dimensions. Prefer the current store schema when sequences are
 * missing or incomplete.
 */
export function ensureCanvasSnapshotSchema(snapshot, currentSchema) {
  if (!isCanvasSnapshot(snapshot)) return snapshot
  const sequences = snapshot.schema?.sequences
  const hasSequences =
    sequences && typeof sequences === 'object' && Object.keys(sequences).length > 0
  if (hasSequences) return snapshot
  return {
    ...snapshot,
    schema: currentSchema ?? snapshot.schema
  }
}

export function sanitizeCanvasSnapshotForTldraw(snapshot) {
  if (!isCanvasSnapshot(snapshot)) {
    return { snapshot: null, skippedRecords: [] }
  }

  const validationStore = createTLStore()
  const currentSchema = validationStore.getStoreSnapshot().schema
  const prepared = ensureCanvasSnapshotSchema(snapshot, currentSchema)
  const originalById = prepared.store
  const skippedRecords = []

  let migratedSnapshot
  try {
    migratedSnapshot = validationStore.migrateSnapshot(prepared)
  } catch (error) {
    return {
      snapshot: null,
      skippedRecords: [
        {
          id: '(snapshot)',
          typeName: 'snapshot',
          type: null,
          reason: firstErrorLine(error)
        }
      ]
    }
  }

  const documentStore = prepareDocumentScopedStore(migratedSnapshot.store, originalById)

  // Prefer bulk load (preserves shape/asset relations) over per-record put.
  try {
    const loadStore = createTLStore()
    loadStore.loadStoreSnapshot({
      schema: migratedSnapshot.schema,
      store: documentStore
    })
    const loaded = loadStore.getStoreSnapshot()
    // Drop session/user records loadStoreSnapshot may inject; keep document only.
    const store = prepareDocumentScopedStore(loaded.store, originalById)
    return {
      snapshot: {
        schema: loaded.schema,
        store: pruneRecordsWithMissingDependencies(store, skippedRecords)
      },
      skippedRecords
    }
  } catch (bulkError) {
    // Fall back to per-record put for partial recovery.
    const validStore = {}
    for (const record of Object.values(documentStore)) {
      try {
        validationStore.put([record], 'initialize')
        const stored = validationStore.get(record.id)
        if (stored) validStore[record.id] = stored
      } catch (error) {
        skippedRecords.push(describeSkippedRecord(record, error))
      }
    }
    if (Object.keys(validStore).length === 0) {
      skippedRecords.push({
        id: '(snapshot)',
        typeName: 'snapshot',
        type: null,
        reason: firstErrorLine(bulkError)
      })
    }
    return {
      snapshot: {
        schema: migratedSnapshot.schema,
        store: pruneRecordsWithMissingDependencies(validStore, skippedRecords)
      },
      skippedRecords
    }
  }
}
