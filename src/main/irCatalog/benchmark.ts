/**
 * Phase 1 stress-test harness — standalone, no Electron, no UI.
 * docs/ir-lab-manager-build-plan.md section 12, Phase 1: measure insert throughput, FTS5 cost,
 * on-disk catalog size, paginated/faceted query latency, and resumability against a real
 * large library.
 *
 * The library path is never hardcoded here (CLAUDE.md's guard against real local paths in
 * tracked files) — pass it as an argument or via IR_LIBRARY_PATH:
 *
 *   npx tsx src/main/irCatalog/benchmark.ts "<path>"
 *   IR_LIBRARY_PATH="<path>" npx tsx src/main/irCatalog/benchmark.ts
 */
import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { createCoreSchema, finalizeIndexes } from './schema'
import { importLibrary } from './importLibrary'
import { queryPage, searchItems } from './queryLibrary'

async function main(): Promise<void> {
  const rootPath = process.argv[2] ?? process.env.IR_LIBRARY_PATH
  if (!rootPath) {
    console.error('Usage: npx tsx src/main/irCatalog/benchmark.ts "<path-to-IR-library>"')
    console.error('   or: IR_LIBRARY_PATH="<path>" npx tsx src/main/irCatalog/benchmark.ts')
    process.exit(1)
  }

  const stat = await fs.promises.stat(rootPath).catch(() => null)
  if (!stat || !stat.isDirectory()) {
    console.error(`Not a directory: ${rootPath}`)
    process.exit(1)
  }

  const dbPath = join(os.tmpdir(), `ir-catalog-benchmark-${Date.now()}.db`)
  console.log(`catalog.db -> ${dbPath}`)

  const db = new DatabaseSync(dbPath)
  createCoreSchema(db)

  console.log(`Importing ${rootPath} ...`)
  const stats = await importLibrary(db, rootPath, 'benchmark-root', {
    onProgress: (p) => {
      process.stdout.write(
        `\r  ${p.filesSeen} files, ${p.foldersSeen} folders, ${(p.elapsedMs / 1000).toFixed(1)}s`
      )
    }
  })
  process.stdout.write('\n')

  console.log('\n--- Import ---')
  console.log(`  library_root_id : ${stats.libraryRootId}`)
  console.log(`  folders         : ${stats.foldersInserted}`)
  console.log(`  items           : ${stats.itemsInserted}`)
  console.log(`  elapsed         : ${(stats.elapsedMs / 1000).toFixed(1)}s`)
  if (stats.itemsInserted > 0) {
    console.log(`  throughput      : ${(stats.itemsInserted / (stats.elapsedMs / 1000)).toFixed(0)} items/s`)
  }

  console.log('\n--- Finalize indexes + FTS5 (post-import, one bulk pass) ---')
  const finalizeStart = performance.now()
  finalizeIndexes(db)
  console.log(`  elapsed: ${((performance.now() - finalizeStart) / 1000).toFixed(1)}s`)

  const dbSize = fs.statSync(dbPath).size
  const walPath = `${dbPath}-wal`
  const walSize = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0
  console.log(`  catalog.db size : ${(dbSize / 1024 / 1024).toFixed(1)} MB (+ ${(walSize / 1024 / 1024).toFixed(1)} MB WAL)`)

  console.log('\n--- Query latency ---')
  {
    const t0 = performance.now()
    const page = queryPage(db, stats.libraryRootId, 0, 200)
    console.log(`  paginated browse (first 200): ${(performance.now() - t0).toFixed(1)}ms, ${page.length} rows`)
  }
  {
    const t0 = performance.now()
    const results = searchItems(db, 'v30', 200)
    console.log(`  FTS5 search "v30": ${(performance.now() - t0).toFixed(1)}ms, ${results.length} rows`)
  }

  console.log('\n--- Resumability ---')
  const t0 = performance.now()
  const resumeStats = await importLibrary(db, rootPath, 'benchmark-root')
  finalizeIndexes(db) // required after every importLibrary() call, not just the first — see schema.ts
  console.log(
    `  re-run against same root: ${(performance.now() - t0).toFixed(0)}ms, ` +
      `${resumeStats.itemsInserted} item rows upserted, no duplicates expected ` +
      `(UNIQUE(library_root_id, relative_path) enforces this)`
  )
  const countRow = db.prepare('SELECT COUNT(*) as c FROM item').get() as { c: number }
  const searchCountRow = db.prepare('SELECT COUNT(*) as c FROM item_search').get() as { c: number }
  console.log(`  item rows: ${countRow.c}, item_search rows: ${searchCountRow.c} (should match)`)

  db.close()
  console.log(`\nDone. catalog.db left at ${dbPath} for inspection.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
