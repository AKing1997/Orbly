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

## Antes de empezar

Prueba en **al menos tres habitaciones distintas**: los jueces evalúan si
aguanta "in rooms the developer never tested". Si el Quest no tiene la sala
escaneada no habrá planos, y los orbes flotarán en la cúpula. No llames a
`initiateRoomCapture`: IWSDK lo tiene desactivado porque borra anclajes.

## 2. Manos

Si el pellizco falla o salta solo, ajusta `PINCH_ON_DISTANCE` y
`PINCH_OFF_DISTANCE` en `src/interaction/gestures.ts`. Están calibrados con las
manos del emulador, y el Quest puede dar distancias algo mayores con los dedos
juntos: es el ajuste con más probabilidades de hacer falta.

- [ ] Pellizco: 10 de 10 aciertos, sentado, con buena luz.
- [ ] Con las manos en reposo en el regazo no aparecen orbes.
- [ ] Arrastrar no suelta el orbe a mitad de camino.
- [ ] Lanzar pega el orbe a la superficie, y soltar con calma no lo lanza (`THROW_SPEED` en `src/interaction/grab.ts`).
- [ ] El orbe cae donde apuntabas. Si no, ajusta `AIM_ASSIST` en `src/room/throw.ts`.
- [ ] Un lanzamiento corto, sentado, llega a la pared (`SPEED_BOOST` en el mismo archivo).
- [ ] Apuntar a un orbe lejano muestra el hilo de luz y pellizcar lo trae a la mano.
- [ ] Pellizcar en el aire mirando un orbe lejano crea uno nuevo, sin traerlo (`AIM_DWELL` en `src/interaction/gestures.ts`).
- [ ] Bajar un orbe al regazo lo apaga y soltarlo ahí lo borra; deshacer lo recupera.
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
- [ ] Si concedes el permiso de espacio, el haz barre las paredes y los impactos dejan ondas de color.
- [ ] Mesa, suelo, pared y sofá suenan distinto y se identifican bien.
- [ ] Los orbes quedan sobre la superficie real, sin flotar ni hundirse.
- [ ] Si deniegas el permiso, los orbes flotan en la cúpula y todo sigue funcionando.
- [ ] Un bucle guardado en una habitación se abre bien en otra.
- [ ] El modo estrellas tapa la habitación y vuelve al instante.

## 7. Tu habitación recuerda tu canción

Probado en el emulador entre visitas. Lo que falta es lo que solo un Quest puede
decir: si reconoce la habitación de verdad, y cuánto tarda.

- [ ] Lanza orbes, sal del todo, vuelve a entrar: la canción se abre sola en las paredes.
- [ ] Los orbes vuelven al mismo punto real, sin desplazarse.
- [ ] Sentado en otra silla de la misma sala, los orbes siguen en sus paredes.
- [ ] Mide cuánto tarda en reconocer la sala. Si pasa de 6 s, sube `ROOM_SEARCH_SECONDS` en `src/app/app.ts`.
- [ ] Reinicia el visor y repite.
- [ ] En otra habitación no se abre sola, y al abrirla a mano cae en esas superficies.
- [ ] Un orbe lanzado allí fija la canción a esa habitación.
- [ ] Sin permiso de espacio, o en navegación privada, todo funciona sin memoria.

## 8. Pausa y reanudación

- [ ] El menú del sistema pausa el sonido y el haz.
- [ ] Al volver, todo sigue donde estaba, sin ráfagas de notas.
- [ ] Quitarte el visor y ponértelo otra vez reanuda bien.
- [ ] Salir y volver a entrar conserva el bucle.
- [ ] Cerrar el navegador y reabrirlo muestra los guardados en Inicio.

## 9. Primera experiencia

Dásela a alguien que no la conozca y no le expliques nada.

- [ ] En menos de 30 s está haciendo música.
- [ ] Entiende la mano fantasma sin ayuda, también al lanzar.
- [ ] **Saltar** funciona y la segunda vez no vuelve a salir el tutorial.
- [ ] El reto del día se entiende y celebra al cumplirlo.
