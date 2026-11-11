## Roba un Brainrot 3D

Juego web 3D para Boxity.io construido con Three.js. Incluye ocho bases en dos filas de cuatro, una pasarela central con cinta transportadora y Brainrots con etiquetas flotantes de rareza, costo e ingresos. También incluye bots, robo, combate, escudos, tienda, Rebirth y controles táctiles.

### Controles

- `WASD` / flechas: movimiento relativo a la cámara.
- Ratón: cámara en tercera persona.
- Espacio: salto.
- Clic izquierdo: golpear.
- `E`: comprar o robar.
- `R`: panel Rebirth.
- `X`: escudo de base.

### Desarrollo local

```bash
python3 -m http.server 8080
```

Abrir `http://localhost:8080`.

### Despliegue en Boxity

Mantener `index.html` como punto de entrada y conservar `game.js`, `brainrots.js` y `style.css`.
