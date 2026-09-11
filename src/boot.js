/**
 * Entry point de produção do ChatPlays.
 *
 * Instala correções de execução que precisam envolver o controlador de
 * teclado antes de qualquer outro módulo importar/usar esse controlador.
 */

const teclado = require('./controllers/keyboard');
const saveGuard = require('./controllers/save-guard');

saveGuard.instalar(teclado);

require('./index');
