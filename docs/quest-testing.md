# Pruebas manuales en un Quest real

Todo está probado en el emulador IWER. Esto es lo que **solo** se puede validar
con un visor. Haz primero las de la sección 1: si fallan, invalidan el resto.

Depura desde el PC conectando el visor por USB con
`chrome://inspect` y abriendo la consola de la pestaña.

## 1. Lo que puede romperlo todo

- [ ] La URL de Pages abre en el navegador del Quest y **Entrar en orbly** inicia la sesión.
- [ ] Se ve la habitación real (passthrough) y no un fondo negro.
- [ ] **El sonido suena nada más entrar.** Si no, pellizca una vez: debería desbloquearlo.
- [ ] Las manos se detectan sin tocar los mandos.
- [ ] Pellizcar crea un orbe a la primera, sin insistir.

## 2. Manos

Si el pellizco falla o salta solo, ajusta `PINCH_ON_DISTANCE` y
`PINCH_OFF_DISTANCE` en `src/interaction/gestures.ts`. Están calibrados con las
manos del emulador, y el Quest puede dar distancias algo mayores con los dedos
juntos: es el ajuste con más probabilidades de hacer falta.

- [ ] Pellizco: 10 de 10 aciertos, sentado, con buena luz.
- [ ] Con las manos en reposo en el regazo no aparecen orbes.
- [ ] Arrastrar no suelta el orbe a mitad de camino.
- [ ] Lanzar borra el orbe, y soltar con calma no (`THROW_SPEED` en `src/interaction/grab.ts`).
- [ ] Oyes cambiar el tono al subir un orbe.
- [ ] La palma izquierda abre el menú al primer intento y no se abre sola al colocar orbes.
- [ ] El menú no tiembla y los botones se aciertan con el índice derecho.
- [ ] Rozar el menú de lado no pulsa nada.
- [ ] Con poca luz, o con una mano tapando la otra, el orbe agarrado se suelta bien.

## 3. Comodidad sentado

- [ ] Llegas a todos los orbes sin levantarte.
- [ ] El botón **Girar** trae delante la parte de atrás del bucle.
- [ ] El haz nunca pasa por delante de los ojos.
- [ ] El anillo se ve en el suelo al mirar hacia abajo.
- [ ] Una silla baja y una alta dan una rejilla cómoda en ambos casos.

## 4. Sonido (no se ha escuchado nunca)

La programación de notas está verificada, pero **nadie ha oído todavía la mezcla**.

- [ ] Los tres instrumentos se distinguen y están equilibrados.
- [ ] El bajo se oye en los altavoces del visor (`BAND_ROOT_MIDI` en `src/audio/scale.ts`).
- [ ] Un acorde de 5 notas no satura.
- [ ] Al girar la cabeza, los orbes suenan en su sitio (HRTF).
- [ ] Los orbes destellan a la vez que suenan, sin retraso visible.

## 5. Rendimiento en Quest 3S

Medido solo en el Mac: 0,12 ms de CPU por frame, 30 draw calls y 49 mil
triángulos en el peor caso. Falta el dato real.

- [ ] 72 fps estables con 32 orbes y el menú abierto (`ovrgpuprofiler` u OVR Metrics Tool).
- [ ] Sin clics ni cortes de audio con 32 orbes; es lo que más preocupa, por los 32 panners HRTF.
- [ ] Sin tirones al recibir los planos ni al abrir el menú por primera vez.
- [ ] 10 minutos seguidos sin que baje el rendimiento ni se caliente en exceso.

## 6. Mezcla con la habitación

- [ ] El brillo de los orbes se ve bien con una sala muy iluminada y con poca luz.
- [ ] Si concedes el permiso de espacio, las paredes y la mesa reciben los pulsos de color.
- [ ] Si lo deniegas, todo sigue funcionando solo con el anillo.
- [ ] El modo estrellas tapa la habitación y vuelve al instante.

## 7. Pausa y reanudación

- [ ] El menú del sistema pausa el sonido y el haz.
- [ ] Al volver, todo sigue donde estaba, sin ráfagas de notas.
- [ ] Quitarte el visor y ponértelo otra vez reanuda bien.
- [ ] Salir y volver a entrar conserva el bucle.
- [ ] Cerrar el navegador y reabrirlo muestra los guardados en Inicio.

## 8. Primera experiencia

Dásela a alguien que no la conozca y no le expliques nada.

- [ ] En menos de 30 s está haciendo música.
- [ ] Entiende la mano fantasma sin ayuda.
- [ ] **Saltar** funciona y la segunda vez no vuelve a salir el tutorial.
- [ ] El reto del día se entiende y celebra al cumplirlo.
