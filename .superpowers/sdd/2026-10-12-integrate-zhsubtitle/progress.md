# SDD ledger — plan: docs/superpowers/plans/2026-10-12-integrate-zhsubtitle.md

Pre-flight: scan clean, interfaces matched with spec.
Task 1: complete (dependencies installed: cheerio, adm-zip, iconv-lite; types.ts created; tests/subtitles/types.test.ts 2/2 pass)
Task 2: complete (ZimukuBmpSolver implemented; tests/subtitles/solver.test.ts 2/2 pass)
Task 3: complete (SubtitleCleaner implemented; tests/subtitles/cleaner.test.ts 3/3 pass)
Task 4: complete (SubtitleExtractor implemented; tests/subtitles/extractor.test.ts 2/2 pass)
Task 5: complete (CinemetaClient implemented; tests/subtitles/cinemeta.test.ts 2/2 pass)
Task 6: complete (SubtitleScorer implemented; tests/subtitles/scorer.test.ts 2/2 pass)
Task 7: complete (BaseProvider, ZimukuProvider, SubhdProvider implemented; tests/subtitles/providers.test.ts 5/5 pass)
Task 8: complete (CacheManager implemented; tests/subtitles/cache.test.ts 3/3 pass)
Task 9: complete (Harbor newline middleware, subtitles routes, manifest updated; tests/subtitles/routes.test.ts 3/3 pass)
Task 10: complete (AppConfig subtitle options, configure.html card & inputs, .env.example documented; tests/subtitles/config.test.ts 2/2 pass, tests/routes.test.ts 5/5 pass)
Task 11: complete (End-to-end integration tests/subtitles/e2e.test.ts 5/5 pass; all 17 suites / 56 tests pass; npm run build successful; pack.ps1 validated)
