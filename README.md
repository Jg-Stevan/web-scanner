# web-scanner

Escáner de documentos PWA (app `apps/scanner-lab`) + motor headless
`@jg-stevan/scanner-core` (`packages/scanner-core`, publicado en npm).

Demo: https://jg-stevan.github.io/web-scanner/
Proyecto hermano: https://github.com/Jg-Stevan/digielect14 (consume la librería desde npm)
Historia/archivo del monorepo original: https://github.com/Jg-Stevan/web-scanner-monorepo-viejo

## Desarrollo

    bun install
    bun run dev          # app en :3000
    bun run core:check   # tipos del core
    bun run app:check    # tipos de la app
    bun run lint

## Motor como librería

    cd packages/scanner-core
    bun run publish:stage   # build + staging en .publish/
    cd .publish && bun publish --access public

Versión actual publicada: 0.1.0 (tag `core-v0.1.0`).
La saga de calidad del encuadre está EN PAUSA — protocolo en `docs/RETOMA-saga-encuadre.md`.
