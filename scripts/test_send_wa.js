import { sendEvolutionWhatsapp } from './whatsapp.js';

async function main() {
  console.log('Disparando teste de WhatsApp...');
  await sendEvolutionWhatsapp('LINK_DOWN', 1, '🧪 *TRACERT+ TESTE DE NOTIFICACAO*\n\nConexao com Evolution API normalizada com sucesso!');
  console.log('Teste concluido!');
}

main();
