---
clientDir: "."
buildCommand: "npm run build"
distDir: "dist"
entryFile: "index.html"
gameScript: "game.js"
catalogScript: "brainrots.js"
styleSheet: "style.css"
sdkScript: "https://sdk.bloxity.io/v1/legion-sdk.min.js"
canDie: false
hasScore: true
rewards: true
store: false
notApplicable:
  - feature: death-screen
    reason: "El jugador no muere; los golpes solo aturden y al caer fuera del mapa vuelve a su base."
  - feature: server-stats
    reason: "El juego no tiene servidor propio ni estado de jugador autoritativo para reportar estadísticas."
  - feature: party-play
    reason: "El juego no crea salas de red; su sincronización local usa BroadcastChannel."
---
